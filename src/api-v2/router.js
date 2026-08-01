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
import { generateIPs, pickPort, resolveIPSource } from '../net/ip-pool.js';

export function createApiRouter({ users, sessions }) {
  const userService = createUserService(users);
  const governance = createGovernanceService;
  return async function handle(request, env) {
    try {
      const url = new URL(request.url);
      const auth = createAuthService(users, sessions, createLoginAttemptService(env));
      const current = await auth.resolve(request);
      if (url.pathname === '/api/auth/login' && request.method === 'POST') {
        const body = await readBody(request);
        const result = await auth.login(body.username, body.password, loginFingerprint(request, body.username));
        return jsonResponse({ ok: true, user: publicUser(result.user) }, 200, { 'set-cookie': result.session.cookie });
      }
      if (url.pathname === '/api/auth/logout' && request.method === 'POST') return jsonResponse({ ok: true }, 200, { 'set-cookie': await auth.logout(request) });
      if (url.pathname === '/api/auth/me' && request.method === 'GET') return jsonResponse({ ok: true, user: publicUser(requireUser(current)) });
      if (url.pathname === '/api/admin/users' && request.method === 'GET') { requireAdmin(current); return jsonResponse({ ok: true, users: await userService.list() }); }
      if (url.pathname === '/api/admin/users' && request.method === 'POST') { requireAdmin(current); return jsonResponse({ ok: true, user: await userService.create(await readBody(request)) }, 201); }
      const match = url.pathname.match(/^\/api\/admin\/users\/([0-9a-f-]+)$/i);
      if (match && request.method === 'PATCH') { requireAdmin(current); return jsonResponse({ ok: true, user: await userService.update(match[1], await readBody(request), current) }); }
      if (match && request.method === 'DELETE') { requireAdmin(current); await userService.delete(match[1], current); return jsonResponse({ ok: true }); }
      const banMatch = url.pathname.match(/^\/api\/admin\/users\/([0-9a-f-]+)\/ban$/i);
      if (banMatch && request.method === 'POST') { requireAdmin(current); validateBanTarget(await users.getByID(banMatch[1])); return jsonResponse({ ok: true, ban: await governance(env).ban(banMatch[1], await readBody(request)) }); }
      if (banMatch && request.method === 'DELETE') { requireAdmin(current); await governance(env).unban(banMatch[1]); return jsonResponse({ ok: true }); }
      if (url.pathname === '/api/admin/config' && request.method === 'GET') { requireAdmin(current); return jsonResponse({ ok: true, config: normalizeGlobalConfig(await getGlobalConfig(env)) }); }
      if (url.pathname === '/api/admin/config' && request.method === 'PATCH') { requireAdmin(current); const config = normalizeGlobalConfig(await readBody(request), await getGlobalConfig(env)); await putGlobalConfig(env, config); return jsonResponse({ ok: true, config }); }
      if (url.pathname === '/api/users/me/subscription' && request.method === 'GET') return textResponse(await buildSubscription(env, requireUser(current), request));
      throw new AppError('NOT_FOUND', 404);
    } catch (error) { const appError = asAppError(error); return jsonResponse({ ok: false, error: appError.code, message: appError.message }, appError.status); }
  };
}

async function readBody(request) { if (!request.headers.get('content-type')?.includes('application/json')) throw new AppError('JSON_REQUIRED', 415); try { return await request.json(); } catch { throw new AppError('INVALID_JSON', 400); } }

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

  const optIP = config.节点参数?.优选IP;
  if (optIP?.启用) {
    const ips = await resolveOptimizedIPs(optIP, request);
    if (ips && ips.length > 0) {
      nodes = nodes.map((node) => {
        const ip = ips[Math.floor(Math.random() * ips.length)];
        return { ...node, address: ip.split(':')[0], port: Number(ip.split(':')[1]) };
      });
    }
  }

  return generateSubscription(nodes);
}

async function resolveOptimizedIPs(optIP, request) {
  if (optIP.自定义IP源) {
    const ips = await resolveIPSource(optIP.自定义IP源);
    if (ips) return ips;
  }

  const operator = identifyOperator(request.cf);
  const cidrs = await getCIDRList(operator);
  if (!cidrs || cidrs.length === 0) return null;

  const ports = optIP.随机端口 ? undefined : [443];
  return generateIPs(cidrs, 16, { ports });

function randomPathSegment() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function loginFingerprint(request, username) {
  const address = request.headers.get('cf-connecting-ip') || 'unknown';
  const normalized = String(username || '').trim().toLowerCase();
  return `${address}:${normalized}`;
}
