import { createAuthService } from '../auth/service.js';
import { createLoginAttemptService } from '../auth/login-attempts.js';
import { requireAdmin, requireUser } from '../auth/guards.js';
import { normalizeGlobalConfig } from '../config/schema.js';
import { getGlobalConfig, putGlobalConfig } from '../config/loader.js';
import { AppError, asAppError } from '../core/errors.js';
import { generateNodeInputs, generateSubscription } from '../subscription/generator.js';
import { normalizeNodeParams } from '../subscription/params.js';
import { withECH } from '../subscription/ech.js';
import { publicUser } from '../users/repository.js';
import { createUserService } from '../users/service.js';
import { createGovernanceService, validateBanTarget } from '../users/governance.js';
import { jsonResponse, textResponse } from '../utils/http.js';
import { identifyOperator } from '../net/operator.js';
import { getCIDRList } from '../net/cidr.js';
import { generateIPs, parseCustomIPs, fetchCustomIPs, pickPort, generateNodeName } from '../net/ip-pool.js';
import { getTurnstileSiteKey } from '../utils/turnstile.js';

export function createApiRouter({ users, sessions }) {
  const governance = createGovernanceService;
  return async function handle(request, env) {
    try {
      const userService = createUserService(users, env);
      const url = new URL(request.url);
      const auth = createAuthService(users, sessions, createLoginAttemptService(env));
      const current = await auth.resolve(request);
      if (url.pathname === '/api/auth/login' && request.method === 'POST') {
        const body = await readBody(request);
        const turnstileToken = body.turnstileToken || request.headers.get('x-turnstile-token') || '';
        const result = await auth.login(body.username, body.password, loginFingerprint(request, body.username), turnstileToken, request);
        return jsonResponse({ ok: true, user: publicUser(result.user) }, 200, { 'set-cookie': result.session.cookie });
      }
      if (url.pathname === '/api/auth/register' && request.method === 'POST') {
        const body = await readBody(request);
        const ip = request.headers.get('cf-connecting-ip') || '';
        const turnstileToken = body.turnstileToken || request.headers.get('x-turnstile-token') || '';
        const loginAttempts = createLoginAttemptService(env);
        await loginAttempts.checkRegister(ip, turnstileToken, request);
        const user = await userService.create({ ...body, role: 'user' });
        await loginAttempts.recordRegister(ip);
        return jsonResponse({ ok: true, user: publicUser(user) }, 201);
      }
      if (url.pathname === '/api/auth/logout' && request.method === 'POST') return jsonResponse({ ok: true }, 200, { 'set-cookie': await auth.logout(request) });
      if (url.pathname === '/api/auth/me' && request.method === 'GET') {
        const u = requireUser(current);
        const usage = await fetchUsage(env, u.userID);
        return jsonResponse({ ok: true, user: { ...publicUser(u), usage } });
      }
      if (url.pathname === '/api/admin/users' && request.method === 'GET') { requireAdmin(current); return jsonResponse({ ok: true, users: await userService.listWithUsage() }); }
      if (url.pathname === '/api/admin/users' && request.method === 'POST') { requireAdmin(current); return jsonResponse({ ok: true, user: await userService.create(await readBody(request)) }, 201); }
      const match = url.pathname.match(/^\/api\/admin\/users\/([0-9a-f-]+)$/i);
      if (match && request.method === 'PATCH') { requireAdmin(current); return jsonResponse({ ok: true, user: await userService.update(match[1], await readBody(request), current) }); }
      if (match && request.method === 'DELETE') { requireAdmin(current); await userService.delete(match[1], current); return jsonResponse({ ok: true }); }
      const banMatch = url.pathname.match(/^\/api\/admin\/users\/([0-9a-f-]+)\/ban$/i);
      if (banMatch && request.method === 'POST') { requireAdmin(current); validateBanTarget(await users.getByID(banMatch[1])); return jsonResponse({ ok: true, ban: await governance(env).ban(banMatch[1], await readBody(request)) }); }
      if (banMatch && request.method === 'DELETE') { requireAdmin(current); await governance(env).unban(banMatch[1]); return jsonResponse({ ok: true }); }
      if (url.pathname === '/api/admin/config' && request.method === 'GET') { requireAdmin(current); return jsonResponse({ ok: true, config: normalizeGlobalConfig(await getGlobalConfig(env)) }); }
      if (url.pathname === '/api/admin/config' && request.method === 'PATCH') { requireAdmin(current); const body = await readBody(request); await validateProxyConfig(body, request); const config = normalizeGlobalConfig(body, await getGlobalConfig(env)); await putGlobalConfig(env, config); return jsonResponse({ ok: true, config }); }
      if (url.pathname === '/api/users/me/subscription' && request.method === 'GET') return textResponse(await buildSubscription(env, requireUser(current), request));
      throw new AppError('NOT_FOUND', 404);
    } catch (error) {
      const appError = asAppError(error);
      const response = { ok: false, error: appError.code, message: appError.message, ...(appError.details ? { details: appError.details } : {}) };
      if (appError.code === 'REQUIRE_CAPTCHA') {
        response.turnstileSiteKey = getTurnstileSiteKey(env);
      }
      return jsonResponse(response, appError.status);
    }
  };
}

async function readBody(request) { if (!request.headers.get('content-type')?.includes('application/json')) throw new AppError('JSON_REQUIRED', 415); try { return await request.json(); } catch { throw new AppError('INVALID_JSON', 400); } }

// 从 D1 查询用量（流量每 5MB 上报一次，可能有最多 5MB 的延迟）
async function fetchUsage(env, userID) {
  const row = await env.DB?.prepare('SELECT upload,download,total FROM usage WHERE user_id = ?').bind(userID).first();
  const quotaRow = await env.DB?.prepare('SELECT quota_bytes FROM users WHERE user_id = ?').bind(userID).first();
  const quotaBytes = Number(quotaRow?.quota_bytes || 0);
  const total = Number(row?.total || 0);
  return {
    upload: Number(row?.upload || 0),
    download: Number(row?.download || 0),
    total,
    quota: quotaBytes,
    remaining: quotaBytes > 0 ? Math.max(0, quotaBytes - total) : 0,
  };
}

async function buildSubscription(env, user, request) {
  const url = new URL(request.url);
  const config = normalizeGlobalConfig(await getGlobalConfig(env));
  const protocols = config.protocols.map((protocol) => protocol === 'vless' ? { protocol, uuid: user.userID } : { protocol, password: user.trojanSecret });
  const transports = config.transports.map((transport) => ({
    transport,
    ...(transport === 'xhttp' ? { mode: 'stream-one' } : {}),
  }));
  let nodes = generateNodeInputs({ protocols, transports, hosts: config.HOSTS, address: url.hostname, port: 443 });
  nodes = nodes.map((node) => {
    const prefix = node.transport === 'websocket' ? 'ws' : node.transport;
    const params = normalizeNodeParams({ ...config.节点参数, path: `/${prefix}/${user.userID}/${node.protocol}` }, {
      randomPath: (path) => `${path}/${randomPathSegment()}`,
    });
    return { ...node, path: params.path, query: params.query };
  });
  if (config.ECH) nodes = nodes.map((node) => withECH(node, { enabled: true, ...config.ECHConfig }));

  const nodeCount = config.节点参数?.节点数量 || 16;
  const optIP = config.节点参数?.优选IP;
  if (optIP?.模式) {
    const replacements = await resolveIPReplacements(optIP, request, nodeCount);
    if (replacements && replacements.length > 0) {
      nodes = nodes.map((node, i) => {
        const rep = replacements[i % replacements.length];
        return { ...node, address: rep.address, port: rep.port };
      });
    }
  }

  let sub = generateSubscription(nodes);

  // 订阅转换：如果有 target 参数，走云端 SUBAPI
  const target = url.searchParams.get('target');
  if (target && config.订阅转换?.SUBAPI) {
    const rawURL = `${url.protocol}//${url.host}${url.pathname}?${url.searchParams.toString()}`;
    const convertURL = `${config.订阅转换.SUBAPI}/sub?target=${encodeURIComponent(target)}&url=${encodeURIComponent(rawURL)}`;
    try {
      const res = await fetch(convertURL);
      if (res.ok) sub = await res.text();
    } catch {
      // 转换失败，返回原始订阅
    }
  }

  return sub;
}

async function resolveIPReplacements(optIP, request, nodeCount = 16) {
  const operator = identifyOperator(request.cf);
  const randomPort = optIP.随机端口;

  // custom 模式：尝试自定义源，失败则降级到全频段随机
  if (optIP.模式 === 'custom') {
    let entries;
    if (optIP.优选网站URL) {
      entries = await fetchCustomIPs(optIP.优选网站URL);
    } else if (optIP.自定义IP源) {
      entries = /^https?:\/\//i.test(optIP.自定义IP源)
        ? await fetchCustomIPs(optIP.自定义IP源)
        : parseCustomIPs(optIP.自定义IP源);
    }

    if (entries) {
      return entries.map((entry, i) => ({
        address: entry.address,
        port: entry.port ?? pickPort(randomPort),
        name: generateNodeName(entry.name, operator, i + 1),
      }));
    }

    // 自定义源不可用，降级到全频段随机
    const fallback = await getCIDRList('cf');
    if (!fallback || fallback.length === 0) return null;
    const ips = generateIPs(fallback, nodeCount, { ports: randomPort ? undefined : [443] });
    return ips.map((ip, i) => {
      const [address, port] = ip.split(':');
      return { address, port: Number(port), name: `Ip获取失败${i + 1}` };
    });
  }

  // optimized 或 random 模式
  const cidrs = optIP.模式 === 'optimized'
    ? await getCIDRList(operator)
    : await getCIDRList('cf');

  if (!cidrs || cidrs.length === 0) return null;
  const ips = generateIPs(cidrs, nodeCount, { ports: randomPort ? undefined : [443] });
  return ips.map((ip, i) => {
    const [address, port] = ip.split(':');
    return { address, port: Number(port), name: generateNodeName(undefined, operator, i + 1) };
  });
}

function randomPathSegment() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function loginFingerprint(request, username) {
  const ip = request.headers.get('cf-connecting-ip') || '';
  const normalized = String(username || '').trim().toLowerCase();
  return { ip, username: normalized };
}

async function validateProxyConfig(body, request) {
  const proxy = body?.反代;
  if (!proxy?.模式) return;

  const socks = proxy.SOCKS5;
  if (proxy.模式 === 'socks5' && socks?.全局) {
    if (!socks.账号) throw new AppError('PROXY_CONFIG_INVALID', 400, '全局代理模式必须填写代理账号');
  }
}


