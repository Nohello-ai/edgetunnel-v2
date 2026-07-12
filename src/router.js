// router.js — 核心路由分发器
// 设计：按优先级分层，每层有明确的函数插槽

import { VERSION, PAGES_STATIC, FINGERPRINT_DICT } from './context.js';
import { md5md5, splitToArray, detectISP, log } from './utils.js';
import { generateUserID } from './uuid.js';

// ---- 代理传输层（已实现） ----
import { handleWS } from './transport/ws.js';
import { handleGRPC } from './transport/grpc.js';
import { handleXHTTP } from './transport/xhttp.js';

// ---- 代理配置（已实现） ----
import { parseProxyConfig } from './proxy/proxy-config.js';

// ---- 管理面板辅助函数 ----

// ---- 订阅（已实现） ----
import { handleSubscription } from './subscription/subscription.js';

// ---- 伪装页（已实现） ----
import { nginx, html1101 } from './nginx.js';

// ---- 新增：管理面板/订阅缺失功能 ----
import { getCloudflareUsage } from './admin/cloudflare.js';
import { proxyCheck } from './admin/proxy-check.js';
import { saveTgConfig } from './admin/telegram.js';
import { requestPreferredAPI, generateRandomIP } from './subscription/preferred-ip.js';

// ============================================================
// 主路由入口
// ============================================================
export async function routeRequest(request, env, ctx, url, ctx_) {
  // ---- 第 0 层：初始化上下文（原版行 30-51） ----
  await initContext(request, env, url, ctx_);

  const { path, casePath, userID, adminPwd, secretKey, host, UA, ip } = ctx_;
  const upgrade = (request.headers.get('Upgrade') || '').toLowerCase();
  const contentType = (request.headers.get('content-type') || '').toLowerCase();

  // ---- 第 1 层：/version 端点（原版行 52-64） ----
  if (path === 'version') {
    return await handleVersion(url, userID);
  }

  // ---- 第 2 层：代理通道（原版行 65-78） ----
  if (adminPwd && upgrade === 'websocket') {
    await parseProxyConfig(url, userID, env, ctx_);
    log(ctx_.debugLog, `[WebSocket] ${url.pathname}${url.search}`);
    return await handleWS(request, userID, url);
  }

  if (adminPwd && !path.startsWith('admin/') && path !== 'login' && request.method === 'POST') {
    await parseProxyConfig(url, userID, env, ctx_);
    const referer = request.headers.get('Referer') || '';
    const xhit = referer.includes('x_padding', 14) || referer.includes('x_padding=');
    if (!xhit && contentType.startsWith('application/grpc')) {
      log(ctx_.debugLog, `[gRPC] ${url.pathname}${url.search}`);
      return await handleGRPC(request, userID);
    }
    log(ctx_.debugLog, `[XHTTP] ${url.pathname}${url.search}`);
    return await handleXHTTP(request, userID);
  }

  // ---- 第 3 层：HTTP → HTTPS 重定向（原版行 80） ----
  if (url.protocol === 'http:') {
    return Response.redirect(url.href.replace(`http://${url.hostname}`, `https://${url.hostname}`), 301);
  }

  // ---- 第 4 层：无密码 / 无 KV 错误页（原版行 81-82） ----
  if (!adminPwd) {
    return fetch(PAGES_STATIC + '/noADMIN').then(r => {
      const h = new Headers(r.headers);
      h.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      h.set('Pragma', 'no-cache'); h.set('Expires', '0');
      return new Response(r.body, { status: 404, headers: h });
    });
  }
  if (!env.KV || typeof env.KV.get !== 'function') {
    return fetch(PAGES_STATIC + '/noKV').then(r => {
      const h = new Headers(r.headers);
      h.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      h.set('Pragma', 'no-cache'); h.set('Expires', '0');
      return new Response(r.body, { status: 404, headers: h });
    });
  }

  // ---- 第 5 层：KV 路由（原版行 82-296） ----

  // 5.1 快速订阅（原版行 84-87）
  if (casePath === secretKey && secretKey !== '勿动此默认密钥，有需求请自行通过添加变量KEY进行修改') {
    const params = new URLSearchParams(url.search);
    params.set('token', await md5md5(host + userID));
    return new Response('重定向中...', { status: 302, headers: { 'Location': `/sub?${params.toString()}` } });
  }

  // 5.2 登录/登出（原版行 88-103, 297-300）
  if (path === 'login') {
    return await handleLogin(request, env, url, ctx_, userID, adminPwd, secretKey, UA);
  }
  if (path === 'logout' || /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(path)) {
    const res = new Response('重定向中...', { status: 302, headers: { 'Location': '/login' } });
    res.headers.set('Set-Cookie', 'auth=; Path=/; Max-Age=0; HttpOnly');
    return res;
  }

  // 5.3 管理面板（原版行 104-296）
  if (path === 'admin' || path.startsWith('admin/')) {
    return await routeAdmin(request, env, ctx, url, ctx_, userID, adminPwd, secretKey, UA, ip, host);
  }

  // 5.4 订阅（原版行 301-）  → 见 subscription/subscription.js
  if (path === 'sub') {
    return await handleSubscription(request, env, ctx, ctx_, host, UA);
  }

  // ---- 第 6 层：robots.txt（原版无，补充） ----
  if (path === 'robots.txt') {
    return new Response('User-agent: *\nDisallow: /', { status: 200, headers: { 'Content-Type': 'text/plain; charset=UTF-8' } });
  }

  // ---- 第 7 层：伪装页（原版行 末尾） ----
  let fakeURL = env.URL || 'nginx';
  if (fakeURL && fakeURL !== 'nginx' && fakeURL !== '1101') {
    fakeURL = fakeURL.trim().replace(/\/$/, '');
    if (!fakeURL.match(/^https?:\/\//i)) fakeURL = 'https://' + fakeURL;
    try {
      const fu = new URL(fakeURL);
      const nh = new Headers(request.headers);
      nh.set('Host', fu.host);
      const fresp = await fetch(fu.origin + url.pathname + url.search, { method: request.method, headers: nh, body: request.body });
      const ct = fresp.headers.get('content-type') || '';
      if (/text|javascript|json|xml/.test(ct)) {
        const text = (await fresp.text()).replaceAll(fu.host, url.host);
        return new Response(text, { status: fresp.status, headers: { ...Object.fromEntries(fresp.headers), 'Cache-Control': 'no-store' } });
      }
      return fresp;
    } catch (_) {}
  }
  if (fakeURL === '1101') {
    return new Response(html1101(url.host, ip), { status: 200, headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
  }
  return new Response(nginx(), { status: 200, headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
}

// ============================================================
// 第 0 层：初始化上下文（原版行 30-51）
// ============================================================
async function initContext(request, env, url, ctx_) {
  ctx_.adminPwd = env.ADMIN || env.admin || env.PASSWORD || env.password || env.pswd || env.TOKEN || env.KEY || env.UUID || env.uuid;
  ctx_.secretKey = env.KEY || '勿动此默认密钥，有需求请自行通过添加变量KEY进行修改';
  ctx_.userID = await generateUserID(env, ctx_.adminPwd, ctx_.secretKey);
  ctx_.hosts = env.HOST
    ? (await splitToArray(env.HOST)).map(h => h.toLowerCase().replace(/^https?:\/\//, '').split('/')[0].split(':')[0])
    : [url.hostname];
  ctx_.host = ctx_.hosts[0];
  ctx_.debugLog = ['1', 'true'].includes(env.DEBUG);
  ctx_.preloadRaceDial = ['1', 'true'].includes(env.PRELOAD_RACE_DIAL);
  if (ctx_.tcpConcurrentDial !== 1 && detectISP(request) === 'cmcc') ctx_.tcpConcurrentDial = 1;

  if (env.PROXYIP) {
    const ips = await splitToArray(env.PROXYIP);
    ctx_.proxyIP = ips[Math.floor(Math.random() * ips.length)];
    ctx_.enableProxyFallback = false;
  } else {
    ctx_.proxyIP = `${request.cf.colo}.${FINGERPRINT_DICT[0]}.${FINGERPRINT_DICT[1]}SsSs.nEt`.toLowerCase();
  }

  // SOCKS5 白名单（原版行 48-51）
}

// ============================================================
// 第 1 层：/version 端点（原版行 52-64）
// ============================================================
async function handleVersion(url, userID) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const reqUUID = (url.searchParams.get('uuid') || '').toLowerCase();
  if (uuidRegex.test(reqUUID)) {
    const targetUUID = String(userID).toLowerCase();
    let reqSum = 0, targetSum = 0;
    for (let i = 0; i < 8; i++) {
      reqSum += reqUUID.charCodeAt(i) <= 57 ? reqUUID.charCodeAt(i) - 48 : reqUUID.charCodeAt(i) - 87;
      targetSum += targetUUID.charCodeAt(i) <= 57 ? targetUUID.charCodeAt(i) - 48 : targetUUID.charCodeAt(i) - 87;
    }
    if (reqSum === targetSum && reqUUID.slice(-12) === targetUUID.slice(-12)) {
      return new Response(JSON.stringify({ Version: Number(String(VERSION).replace(/\D+/g, '')) }), {
        status: 200, headers: { 'Content-Type': 'application/json;charset=utf-8' }
      });
    }
  }
  // 不匹配：降级到伪装页
  return null;
}

// ============================================================
// 第 5.2 层：登录处理（原版行 88-103）
// ============================================================
async function handleLogin(request, env, url, ctx_, userID, adminPwd, secretKey, UA) {
  const cookies = request.headers.get('Cookie') || '';
  const authCookie = cookies.split(';').find(c => c.trim().startsWith('auth='))?.split('=')[1];
  if (authCookie == await md5md5(UA + secretKey + adminPwd)) {
    return new Response('重定向中...', { status: 302, headers: { 'Location': '/admin' } });
  }
  if (request.method === 'POST') {
    const formData = await request.text();
    const params = new URLSearchParams(formData);
    const inputPwd = params.get('password');
    if (inputPwd === (typeof adminPwd === 'string' ? adminPwd.replace(/[\r\n]/g, '') : adminPwd)) {
      const res = new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json;charset=utf-8' } });
      res.headers.set('Set-Cookie', `auth=${await md5md5(UA + secretKey + adminPwd)}; Path=/; Max-Age=86400; HttpOnly; Secure; SameSite=Strict`);
      return res;
    }
  }
  return fetch(PAGES_STATIC + '/login');
}

// ============================================================
// 第 5.3 层：管理面板路由
// ============================================================
async function routeAdmin(request, env, ctx, url, ctx_, userID, adminPwd, secretKey, UA, ip, host) {
  const { path, casePath } = ctx_;

  // 验证 cookie（原版行 104-108）
  const cookies = request.headers.get('Cookie') || '';
  const authCookie = cookies.split(';').find(c => c.trim().startsWith('auth='))?.split('=')[1];
  if (!authCookie || authCookie !== await md5md5(UA + secretKey + adminPwd)) {
    return new Response('重定向中...', { status: 302, headers: { 'Location': '/login' } });
  }

  // ---- 管理面板 API 路由（需在 GET config_JSON 之前处理的） ----

  // admin/log.json（原版行 109-111）
  if (path === 'admin/log.json') {
    const content = await env.KV.get('log.json') || '[]';
    return new Response(content, { status: 200, headers: { 'Content-Type': 'application/json;charset=utf-8' } });
  }

  // admin/getCloudflareUsage（原版行 112-119）
  if (casePath === 'admin/getCloudflareUsage') {
    return await handleGetCloudflareUsage(url);
  }

  // admin/getADDAPI（原版行 120-134）
  if (casePath === 'admin/getADDAPI') {
    return await handleGetADDAPI(url);
  }

  // admin/check（原版行 135-202）
  if (path === 'admin/check') {
    return await handleAdminCheck(request, url);
  }

  // ---- 需要读取 config_JSON 的 API ----

  const config = await readConfigKV(env, host, userID, UA);

  // admin/init（原版行 207-216）
  if (path === 'admin/init') {
    try {
      const newConfig = await readConfigKV(env, host, userID, UA, true);
      ctx.waitUntil(logRequest(env, request, ip, 'Init_Config', newConfig));
      newConfig.init = '配置已重置为默认值';
      return new Response(JSON.stringify(newConfig, null, 2), { status: 200, headers: { 'Content-Type': 'application/json;charset=utf-8' } });
    } catch (err) {
      return new Response(JSON.stringify({ msg: '配置重置失败，失败原因：' + err.message, error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json;charset=utf-8' } });
    }
  }

  // POST 保存（原版行 217-284）
  if (request.method === 'POST') {
    return await handleAdminPost(request, env, ctx, url, ctx_, config, ip);
  }

  // GET 查询（原版行 285-293）
  if (path === 'admin/config.json') {
    return new Response(JSON.stringify(config, null, 2), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (casePath === 'admin/ADD.txt') {
    let localIP = await env.KV.get('ADD.txt') || 'null';
    if (localIP === 'null') {
      localIP = (await generateRandomIP(request, config.优选订阅生成.本地IP库.随机数量, config.优选订阅生成.本地IP库.指定端口))[1];
    }
    return new Response(localIP, { status: 200, headers: { 'Content-Type': 'text/plain;charset=utf-8', 'asn': String(request.cf.asn) } });
  }
  if (path === 'admin/cf.json') {
    return new Response(JSON.stringify(request.cf, null, 2), { status: 200, headers: { 'Content-Type': 'application/json;charset=utf-8' } });
  }

  // 默认回管理面板静态页面（原版行 295-296）
  ctx.waitUntil(logRequest(env, request, ip, 'Admin_Login', config));
  return fetch(PAGES_STATIC + '/admin' + url.search);
}

// ============================================================
// 管理面板 POST 处理（原版行 217-284）
// ============================================================
async function handleAdminPost(request, env, ctx, url, ctx_, config, ip) {
  const { path, casePath } = ctx_;

  if (path === 'admin/config.json') {
    try {
      const newConfig = await request.json();
      if (!newConfig.UUID || !newConfig.HOST) return new Response(JSON.stringify({ error: '配置不完整' }), { status: 400, headers: { 'Content-Type': 'application/json;charset=utf-8' } });
      await env.KV.put('config.json', JSON.stringify(newConfig, null, 2));
      ctx.waitUntil(logRequest(env, request, ip, 'Save_Config', config));
      return new Response(JSON.stringify({ success: true, message: '配置已保存' }), { status: 200, headers: { 'Content-Type': 'application/json;charset=utf-8' } });
    } catch (err) {
      return new Response(JSON.stringify({ error: '保存配置失败: ' + err.message }), { status: 500, headers: { 'Content-Type': 'application/json;charset=utf-8' } });
    }
  }

  if (path === 'admin/cf.json') {
    try {
      const newConfig = await request.json();
      const CF_JSON = { Email: null, GlobalAPIKey: null, AccountID: null, APIToken: null, UsageAPI: null };
      if (!newConfig.init || newConfig.init !== true) {
        if (newConfig.Email && newConfig.GlobalAPIKey) { CF_JSON.Email = newConfig.Email; CF_JSON.GlobalAPIKey = newConfig.GlobalAPIKey; }
        else if (newConfig.AccountID && newConfig.APIToken) { CF_JSON.AccountID = newConfig.AccountID; CF_JSON.APIToken = newConfig.APIToken; }
        else if (newConfig.UsageAPI) { CF_JSON.UsageAPI = newConfig.UsageAPI; }
        else return new Response(JSON.stringify({ error: '配置不完整' }), { status: 400, headers: { 'Content-Type': 'application/json;charset=utf-8' } });
      }
      await env.KV.put('cf.json', JSON.stringify(CF_JSON, null, 2));
      ctx.waitUntil(logRequest(env, request, ip, 'Save_Config', config));
      return new Response(JSON.stringify({ success: true, message: '配置已保存' }), { status: 200, headers: { 'Content-Type': 'application/json;charset=utf-8' } });
    } catch (err) {
      return new Response(JSON.stringify({ error: '保存配置失败: ' + err.message }), { status: 500, headers: { 'Content-Type': 'application/json;charset=utf-8' } });
    }
  }

  // admin/tg.json 保存
  if (path === 'admin/tg.json') {
    return await handleAdminTgPost(request, env, ctx, ctx_, config, ip);
  }

  if (casePath === 'admin/ADD.txt') {
    try {
      const customIPs = await request.text();
      await env.KV.put('ADD.txt', customIPs);
      ctx.waitUntil(logRequest(env, request, ip, 'Save_Custom_IPs', config));
      return new Response(JSON.stringify({ success: true, message: '自定义IP已保存' }), { status: 200, headers: { 'Content-Type': 'application/json;charset=utf-8' } });
    } catch (err) {
      return new Response(JSON.stringify({ error: '保存自定义IP失败: ' + err.message }), { status: 500, headers: { 'Content-Type': 'application/json;charset=utf-8' } });
    }
  }

  return new Response(JSON.stringify({ error: '不支持的POST请求路径' }), { status: 404, headers: { 'Content-Type': 'application/json;charset=utf-8' } });
}

// ============================================================
// 插槽函数
// ============================================================

// -- admin/getCloudflareUsage
async function handleGetCloudflareUsage(url) {
  try {
    const result = await getCloudflareUsage(
      url.searchParams.get('Email'),
      url.searchParams.get('GlobalAPIKey'),
      url.searchParams.get('AccountID'),
      url.searchParams.get('APIToken')
    );
    return new Response(JSON.stringify(result, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ msg: '查询请求量失败，失败原因：' + err.message, error: err.message }, null, 2), {
      status: 500,
      headers: { 'Content-Type': 'application/json;charset=utf-8' },
    });
  }
}

// -- admin/getADDAPI（原版行 120-134）
async function handleGetADDAPI(url) {
  const apiUrl = url.searchParams.get('url');
  if (!apiUrl) {
    return new Response(JSON.stringify({ success: false, data: [] }, null, 2), {
      status: 403,
      headers: { 'Content-Type': 'application/json;charset=utf-8' },
    });
  }
  try {
    new URL(apiUrl); // 验证URL有效性
    const [ipv4, ipv6] = await requestPreferredAPI([apiUrl], url.searchParams.get('port') || '443');
    let preferredIPs = ipv4.length > 0 ? ipv4 : ipv6;
    preferredIPs = preferredIPs.map(item => item.replace(/#(.+)$/, (_, remark) => '#' + decodeURIComponent(remark)));
    return new Response(JSON.stringify({ success: true, data: preferredIPs }, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json;charset=utf-8' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ msg: '验证优选API失败，失败原因：' + err.message, error: err.message }, null, 2), {
      status: 500,
      headers: { 'Content-Type': 'application/json;charset=utf-8' },
    });
  }
}

// -- admin/check（原版行 135-202）
async function handleAdminCheck(request, url) {
  const proxyProtocol = ['socks5', 'http', 'https', 'turn', 'sstp'].find(t => url.searchParams.has(t)) || null;
  if (!proxyProtocol) {
    return new Response(JSON.stringify({ error: '缺少代理参数' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json;charset=utf-8' },
    });
  }
  const proxyParam = url.searchParams.get(proxyProtocol);
  const result = await proxyCheck(request, proxyProtocol, proxyParam);
  return new Response(JSON.stringify(result, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json;charset=utf-8' },
  });
}

// -- admin/tg.json POST（原版行 258-273）
async function handleAdminTgPost(request, env, ctx, ctx_, config, ip) {
  try {
    const newConfig = await request.json();
    await saveTgConfig(env, newConfig);
    ctx.waitUntil(logRequest(env, request, ip, 'Save_Config', config));
    return new Response(JSON.stringify({ success: true, message: '配置已保存' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json;charset=utf-8' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: '保存配置失败: ' + err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json;charset=utf-8' },
    });
  }
}

// -- 生成随机IP（原版 订阅生成 中调用）
// generateRandomIP 已在顶部导入，此处直接使用

// ============================================================
// 辅助函数
// ============================================================

// 读取配置
async function readConfigKV(env, hostname, userID, UA, reset = false) {
  const defaults = {
    TIME: new Date().toISOString(), HOST: hostname, HOSTS: [hostname], UUID: userID,
    协议类型: 'vless', 传输协议: 'ws', gRPC模式: 'gun',
    gRPCUserAgent: 'Mozilla/5.0',
    跳过证书验证: false, 启用0RTT: true, TLS分片: 'Shadowrocket', 随机路径: false,
    ECH: false, ECHConfig: { DNS: 'https://doh.cmliussss.net/CMLiussss', SNI: null },
    SS: { 加密方式: 'aes-128-gcm', TLS: true },
    Fingerprint: 'chrome',
    优选订阅生成: {
      local: true,
      本地IP库: { 随机IP: true, 随机数量: 16, 指定端口: -1 },
      SUB: null, SUBNAME: 'edgetunnel', SUBUpdateTime: 6,
      TOKEN: await md5md5(hostname + userID),
    },
    订阅转换配置: {
      SUBAPI: 'https://subapi.cmliussss.net',
      SUBCONFIG: 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/refs/heads/master/Clash/config/ACL4SSR_Online_Mini_MultiMode.ini',
      SUBEMOJI: false, SUBLIST: false,
    },
    CF: { Email: null, GlobalAPIKey: null, AccountID: null, APIToken: null, UsageAPI: null },
    PATH: '/', 完整节点路径: '/?ed=2560', LINK: '', 加载时间: '0ms',
  };
  if (reset) {
    if (env.KV?.put) await env.KV.put('config.json', JSON.stringify(defaults, null, 2));
    return defaults;
  }
  if (env.KV?.get) {
    try { const saved = await env.KV.get('config.json'); if (saved) return { ...defaults, ...JSON.parse(saved) }; } catch (_) {}
  }
  return defaults;
}

// 日志记录
async function logRequest(env, request, ip, type, cfg, writeKV = true) {
  try {
    const entry = {
      TYPE: type, IP: ip,
      ASN: `AS${request.cf.asn || '0'} ${request.cf.asOrganization || 'Unknown'}`,
      CC: `${request.cf.country || 'N/A'} ${request.cf.city || 'N/A'}`,
      URL: request.url, UA: request.headers.get('User-Agent') || 'Unknown',
      TIME: Date.now(),
    };
    if (writeKV && env.KV?.get) {
      const existing = await env.KV.get('log.json');
      const logs = JSON.parse(existing || '[]');
      logs.unshift(entry);
      if (logs.length > 500) logs.length = 500;
      await env.KV.put('log.json', JSON.stringify(logs));
    }
  } catch (_) {}
}