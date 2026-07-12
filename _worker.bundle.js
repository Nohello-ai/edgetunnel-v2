// edgetunnel v2 — bundled for Cloudflare Workers
// Generated from 27 modules


// ====== _worker.js ======
// _worker.js — edgetunnel v2 入口
// 设计：极简入口，所有逻辑委托给 router 和 context

export default {
  async fetch(request, env, ctx) {
    // 1. URL 清洗（对齐原版）
    const url = cleanUrl(request.url);

    // 2. 构建请求上下文（线程安全，替代全局变量）
    const ctx_ = createRequestContext(request, env, url);

    // 3. 路由分发
    return await routeRequest(request, env, ctx, url, ctx_);
  },
};

// ---- URL 清洗（对齐原版 行 20-27） ----
function cleanUrl(raw) {
  let s = raw.replace(/%5[Cc]/g, '').replace(/\\/g, '');
  const hashIdx = s.indexOf('#');
  const body = hashIdx === -1 ? s : s.slice(0, hashIdx);
  const hash = hashIdx === -1 ? '' : s.slice(hashIdx);
  if (!body.includes('?') && /%3f/i.test(body)) {
    s = body.replace(/%3f/i, '?') + hash;
  }
  return new URL(s);
}

// ====== src/context.js ======
// context.js — 请求上下文工厂（线程安全，替代原版全局变量）
// 原版行 1-16：全局变量 Version/反代IP/SOCKS5白名单 等

const VERSION = '2026-06-17 01:41:21';
const PAGES_STATIC = 'https://edt-pages.github.io';

// ---- 特征码字典（原版行 12-16） ----
const FINGERPRINT_DICT = [
  (Proxy.name + 'IP').toUpperCase(),
  (String.fromCharCode(67, 109) + URL.name[2] + 'i' + URL.name[0]).toLowerCase(),
  String(2407 * 300 - 10).split('').reverse().join(''),
];

// ---- 常量（原版行 7-10） ----
const WS_EARLY_DATA_MAX_BYTES = 8 * 1024;
const WS_EARLY_DATA_MAX_HEADER_LEN = Math.ceil(WS_EARLY_DATA_MAX_BYTES * 4 / 3) + 4;
const UPSTREAM_BUNDLE_TARGET = 16 * 1024;
const UPSTREAM_QUEUE_MAX_BYTES = 16 * 1024 * 1024;
const UPSTREAM_QUEUE_MAX_ITEMS = 4096;
const DOWNSTREAM_GRAIN_PACKET = 32 * 1024;
const DOWNSTREAM_GRAIN_TAIL_THRESHOLD = 512;
const DOWNSTREAM_GRAIN_SILENCE_MS = 0;

// ---- SOCKS5 白名单（原版行 4） ----
const DEFAULT_SOCKS5_WHITELIST = [
  '*tapecontent.net',
  '*cloudatacdn.com',
  '*loadshare.org',
  '*cdn-centaurus.com',
  'scholar.google.com',
];

// ---- 代理默认端口 ----
const DEFAULT_PROXY_PORTS = {
  socks5: 1080, http: 80, https: 443, turn: 3478, sstp: 443,
};

// ---- 请求上下文 ----
function createRequestContext(request, env, url) {
  const UA = request.headers.get('User-Agent') || 'null';

  return {
    // 反代
    proxyIP: '',
    enableSOCKS5Proxy: null,
    enableSOCKS5Global: false,
    mySOCKS5Account: '',
    parsedSocks5Address: {},

    // 缓存
    socks5Whitelist: [...DEFAULT_SOCKS5_WHITELIST],
    cachedSocks5Whitelist: null,
    cachedProxyIP: null,
    cachedProxyIPArray: null,
    cachedProxyIPIndex: 0,
    enableProxyFallback: true,

    // 调试
    debugLog: false,

    // TCP
    tcpConcurrentDial: 2,
    preloadRaceDial: false,

    // 配置
    configJSON: null,

    // 请求级
    UA,
    hosts: [],
    host: url.hostname,
    path: url.pathname.slice(1).toLowerCase(),
    casePath: url.pathname.slice(1),
    ip: request.headers.get('CF-Connecting-IP')
      || request.headers.get('True-Client-IP')
      || request.headers.get('X-Real-IP')
      || request.headers.get('X-Forwarded-For')
      || request.headers.get('Fly-Client-IP')
      || request.headers.get('X-Appengine-Remote-Addr')
      || request.headers.get('X-Cluster-Client-IP')
      || '未知IP',
    userID: '',
    adminPwd: '',
    secretKey: '',
  };
}

// ====== src/router.js ======
// router.js — 核心路由分发器
// 设计：按优先级分层，每层有明确的函数插槽


// ---- 代理传输层（已实现） ----

// ---- 代理配置（已实现） ----

// ---- 管理面板辅助函数 ----

// ---- 订阅（已实现） ----

// ---- 伪装页（已实现） ----

// ---- 新增：管理面板/订阅缺失功能 ----

// ============================================================
// 主路由入口
// ============================================================
async function routeRequest(request, env, ctx, url, ctx_) {
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

// ====== src/utils.js ======
// ============================================================
// utils.js — 通用工具函数
// 对应原文件多处散布的工具函数
// ============================================================

// --- 数据类型转换 ---

/** 将任意数据转为 Uint8Array */
function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return new Uint8Array(data || 0);
}

/** 计算有效数据长度 */
function dataLength(data) {
  if (!data) return 0;
  if (typeof data.byteLength === 'number') return data.byteLength;
  if (typeof data.length === 'number') return data.length;
  return 0;
}

/** 拼接多个字节块 */
function concatBytes(...chunks) {
  const nonEmpty = chunks.filter(c => c && c.length > 0);
  if (nonEmpty.length === 0) return new Uint8Array(0);
  const total = nonEmpty.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const c of nonEmpty) {
    result.set(c, offset);
    offset += c.length;
  }
  return result;
}

// --- IP / 域名工具 ---

const ipv4Regex = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

function isIPv4(value) {
  const parts = String(value || '').split('.');
  return parts.length === 4 && parts.every(p => /^\d{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255);
}

function stripIPv6Brackets(hostname = '') {
  const host = String(hostname || '').trim();
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

function isIPHostname(hostname = '') {
  const host = stripIPv6Brackets(hostname);
  if (ipv4Regex.test(host)) return true;
  if (!host.includes(':')) return false;
  try {
    new URL(`http://[${host}]/`);
    return true;
  } catch (_) {
    return false;
  }
}

// --- 加密工具 ---

/** MD5(MD5(text)) 双哈希 */
async function md5md5(text) {
  const encoder = new TextEncoder();
  const first = await crypto.subtle.digest('MD5', encoder.encode(text));
  const second = await crypto.subtle.digest('MD5', first);
  return [...new Uint8Array(second)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** SHA-224（纯 JS 同步实现，与原文件完全一致） */
function sha224str(s) {
  const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  const r = (n, b) => ((n >>> b) | (n << (32 - b))) >>> 0;
  s = unescape(encodeURIComponent(s));
  const l = s.length * 8; s += String.fromCharCode(0x80);
  while ((s.length * 8) % 512 !== 448) s += String.fromCharCode(0);
  const h = [0xc1059ed8, 0x367cd507, 0x3070dd17, 0xf70e5939, 0xffc00b31, 0x68581511, 0x64f98fa7, 0xbefa4fa4];
  const hi = Math.floor(l / 0x100000000), lo = l & 0xFFFFFFFF;
  s += String.fromCharCode((hi >>> 24) & 0xFF, (hi >>> 16) & 0xFF, (hi >>> 8) & 0xFF, hi & 0xFF, (lo >>> 24) & 0xFF, (lo >>> 16) & 0xFF, (lo >>> 8) & 0xFF, lo & 0xFF);
  const w = []; for (let i = 0; i < s.length; i += 4) w.push((s.charCodeAt(i) << 24) | (s.charCodeAt(i + 1) << 16) | (s.charCodeAt(i + 2) << 8) | s.charCodeAt(i + 3));
  for (let i = 0; i < w.length; i += 16) {
    const x = new Array(64).fill(0);
    for (let j = 0; j < 16; j++) x[j] = w[i + j];
    for (let j = 16; j < 64; j++) {
      const s0 = r(x[j - 15], 7) ^ r(x[j - 15], 18) ^ (x[j - 15] >>> 3);
      const s1 = r(x[j - 2], 17) ^ r(x[j - 2], 19) ^ (x[j - 2] >>> 10);
      x[j] = (x[j - 16] + s0 + x[j - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h0] = h;
    for (let j = 0; j < 64; j++) {
      const S1 = r(e, 6) ^ r(e, 11) ^ r(e, 25), ch = (e & f) ^ (~e & g), t1 = (h0 + S1 + ch + K[j] + x[j]) >>> 0;
      const S0 = r(a, 2) ^ r(a, 13) ^ r(a, 22), maj = (a & b) ^ (a & c) ^ (b & c), t2 = (S0 + maj) >>> 0;
      h0 = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    for (let j = 0; j < 8; j++) h[j] = (h[j] + (j === 0 ? a : j === 1 ? b : j === 2 ? c : j === 3 ? d : j === 4 ? e : j === 5 ? f : j === 6 ? g : h0)) >>> 0;
  }
  let hex = '';
  for (let i = 0; i < 7; i++) {
    for (let j = 24; j >= 0; j -= 8) hex += ((h[i] >>> j) & 0xFF).toString(16).padStart(2, '0');
  }
  return hex;
}

/** Base64 编码（带秘钥混淆） */
function base64SecretEncode(plaintext, secret) {
  const data = new TextEncoder().encode(plaintext);
  const key = new TextEncoder().encode(secret);
  const result = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    result[i] = data[i] ^ key[i % key.length];
  }
  return btoa(String.fromCharCode(...result));
}

// --- 字符串 / 路径工具 ---

/** 替换字符串中的星号为随机小写字母数字 */
function replaceStars(str) {
  if (typeof str !== 'string' || !str.includes('*')) return str;
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return str.replace(/\*/g, () => chars[Math.floor(Math.random() * chars.length)]);
}

/** 生成随机子路径 */
function randomPath(fullPath = '/') {
  const dirs = [
    'about', 'account', 'api', 'app', 'apps', 'archive', 'article',
    'auth', 'blog', 'blogs', 'channel', 'chat', 'docs', 'download',
    'event', 'explore', 'feed', 'file', 'files', 'forum', 'game',
    'games', 'home', 'image', 'images', 'info', 'link', 'links',
    'live', 'login', 'media', 'member', 'music', 'news', 'page',
    'pages', 'photo', 'photos', 'post', 'posts', 'profile', 'pub',
    'search', 'share', 'shop', 'site', 'static', 'status', 'talk',
    'topic', 'topics', 'track', 'user', 'video', 'view', 'wiki',
  ];
  const count = Math.floor(Math.random() * 3) + 1;
  const shuffled = [...dirs].sort(() => 0.5 - Math.random()).slice(0, count).join('/');
  return `/${shuffled}${fullPath.replace('/?', '?')}`;
}

// --- 数组处理 ---

/** 将逗号或换行分隔的字符串转为数组 */
async function splitToArray(input) {
  if (!input) return [];
  if (Array.isArray(input)) return input;
  const str = String(input);
  if (str.includes('\n')) return str.split('\n').map(s => s.trim()).filter(Boolean);
  if (str.includes(',')) return str.split(',').map(s => s.trim()).filter(Boolean);
  return [str.trim()].filter(Boolean);
}

// --- 日志 ---

/** 调试日志（DEBUG=true 时打印） */
function log(debug, ...args) {
  // 由调用方传入 debug 标志；这里简单打印所有参数
  if (debug) console.log(...args);
}

// --- 运营商识别 ---

function detectISP(request) {
  const asn = request?.cf?.asn;
  if (asn === 56044 || asn === 56046 || asn === 56047 || asn === 24547 || asn === 56040) return 'cmcc';
  return '';
}

// --- 超时封装 ---

async function withTimeout(promise, timeoutMs, message = 'timeout') {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// --- WebSocket 静默关闭 ---

function closeSocketQuietly(socket) {
  try {
    if (socket.readyState === 1 /* OPEN */ || socket.readyState === 2 /* CLOSING */) {
      socket.close();
    }
  } catch (_) {}
}

// --- WebSocket 发送并等待 ---

async function wsSend(webSocket, payload) {
  const result = webSocket.send(payload);
  if (result && typeof result.then === 'function') await result;
}

// --- ID 格式化 ---

function formatUUID(arr, offset = 0) {
  const hex = [...arr.slice(offset, offset + 16)].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// --- 传输协议配置 ---

function getTransportConfig(config = {}) {
  const isGRPC = config.传输协议 === 'grpc';
  let type;
  if (isGRPC) {
    type = config.gRPC模式 === 'multi' ? 'grpc&mode=multi' : 'grpc&mode=gun';
  } else {
    type = config.传输协议 === 'xhttp' ? 'xhttp&mode=stream-one' : 'ws';
  }
  return {
    type,
    pathKey: isGRPC ? 'serviceName' : 'path',
    hostKey: isGRPC ? 'authority' : 'host',
  };
}

function getTransportPathValue(config = {}, nodePath = '/', isSubGenerator = false) {
  const pathValue = isSubGenerator ? '/' : (config.随机路径 ? randomPath(nodePath) : nodePath);
  if (config.传输协议 !== 'grpc') return pathValue;
  return pathValue.split('?')[0] || '/';
}

// ====== src/uuid.js ======
// ============================================================
// uuid.js — UUID 工具函数
// 对应原文件: 读取十六进制半字节、获取UUID字节、UUID字节匹配
// ============================================================


const UUID_BYTE_CACHE = new Map();
const MAX_CACHE_SIZE = 32;

/** 读取单个十六进制半字节 */
function readHexNibble(code) {
  if (code >= 48 && code <= 57) return code - 48;       // '0'-'9'
  code |= 32;
  if (code >= 97 && code <= 102) return code - 87;      // 'a'-'f'
  return -1;
}

/** 将 UUID 字符串转为 16 字节 Uint8Array（带缓存） */
function getUUIDBytes(uuid) {
  const key = String(uuid || '');
  const cached = UUID_BYTE_CACHE.get(key);
  if (cached) return cached;

  const clean = key.replace(/-/g, '');
  if (clean.length !== 32) return null;

  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    const high = readHexNibble(clean.charCodeAt(i * 2));
    const low = readHexNibble(clean.charCodeAt(i * 2 + 1));
    if (high < 0 || low < 0) return null;
    bytes[i] = (high << 4) | low;
  }

  if (UUID_BYTE_CACHE.size >= MAX_CACHE_SIZE) UUID_BYTE_CACHE.clear();
  UUID_BYTE_CACHE.set(key, bytes);
  return bytes;
}

/** 校验 data 在 offset 处是否匹配 uuid 的 16 字节 */
function uuidBytesMatch(data, offset, uuid) {
  const expected = getUUIDBytes(uuid);
  if (!expected || data.byteLength < offset + 16) return false;
  for (let i = 0; i < 16; i++) {
    if (data[offset + i] !== expected[i]) return false;
  }
  return true;
}

/** 从环境变量生成 userID（UUIDv4 格式） */
async function generateUserID(env, adminPassword, secretKey) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const envUUID = env.UUID || env.uuid;
  if (envUUID && uuidRegex.test(envUUID)) return envUUID.toLowerCase();

// [bundle] dynamic import removed: const { md5md5 } = await import('./utils.js');
  const hash = await md5md5(adminPassword + secretKey);
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    '4' + hash.slice(13, 16),
    '8' + hash.slice(17, 20),
    hash.slice(20),
  ].join('-');
}

// ====== src/transport/ws.js ======
// transport/ws.js — WebSocket transport (extracted from original lines 1087-1558)

// ---- UUID helpers (inline) ----
const UUID_BYTES_CACHE = new Map();
function hexNibble(code) { if (code >= 48 && code <= 57) return code - 48; code |= 32; if (code >= 97 && code <= 102) return code - 87; return -1; }
function getUUIDBytes(uuid) { const key = String(uuid || ""); let c = UUID_BYTES_CACHE.get(key); if (c) return c; const clean = key.replace(/-/g, ""); if (clean.length !== 32) return null; const bytes = new Uint8Array(16); for (let i = 0; i < 16; i++) { const h = hexNibble(clean.charCodeAt(i * 2)); const l = hexNibble(clean.charCodeAt(i * 2 + 1)); if (h < 0 || l < 0) return null; bytes[i] = (h << 4) | l; } if (UUID_BYTES_CACHE.size >= 32) UUID_BYTES_CACHE.clear(); UUID_BYTES_CACHE.set(key, bytes); return bytes; }
function uuidBytesMatch(data, offset, uuid) { const exp = getUUIDBytes(uuid); if (!exp || data.byteLength < offset + 16) return false; for (let i = 0; i < 16; i++) if (data[offset + i] !== exp[i]) return false; return true; }

// ---- Early data validation/decoding (original lines 1087-1126) ----
function isValidWSEarlyData(bytes, token) {
	if (!bytes?.byteLength) return false;
	if (bytes.byteLength >= 18 && uuidBytesMatch(bytes, 1, token)) return true;
	if (bytes.byteLength < 58 || bytes[56] !== 0x0d || bytes[57] !== 0x0a) return false;

	const trojanPassword = sha224str(token);
	for (let i = 0; i < 56; i++) {
		if (bytes[i] !== trojanPassword.charCodeAt(i)) return false;
	}
	return true;
}

function decodeWSEarlyData(header, token) {
	if (!header) return null;
	if (header.length > WS_EARLY_DATA_MAX_HEADER_LEN) throw new Error('early data is too large');

	let bytes;
	const Uint8ArrayBase64 = /** @type {any} */ (Uint8Array);
	if (typeof Uint8ArrayBase64.fromBase64 === 'function') {
		try {
			bytes = Uint8ArrayBase64.fromBase64(header, { alphabet: 'base64url' });
		} catch (_) { }
	}
	if (!bytes) {
		let normalized = header.replace(/-/g, '+').replace(/_/g, '/');
		const padding = normalized.length % 4;
		if (padding) normalized += '='.repeat(4 - padding);
		let binaryString;
		try {
			binaryString = atob(normalized);
		} catch (_) {
			return null;
		}
		bytes = new Uint8Array(binaryString.length);
		for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
	}

	if (bytes.byteLength > WS_EARLY_DATA_MAX_BYTES) throw new Error('early data is too large');
	return isValidWSEarlyData(bytes, token) ? bytes : null;
}

{ decodeWSEarlyData };

// ---- Main handler (original lines 1129-1558) ----
async function handleWS(request, yourUUID, url) {
	const wsPair = new WebSocketPair();
	const [clientSock, serverSock] = Object.values(wsPair);
	try { (/** @type {any} */ (serverSock)).accept({ allowHalfOpen: true }) }
	catch (_) { serverSock.accept() }
	serverSock.binaryType = 'arraybuffer';
	let remoteConnWrapper = { socket: null, connectingPromise: null, retryConnect: null };
	let isDnsQuery = false;
	let isTrojan = null;
	const trojanUDPCtx = { cache: new Uint8Array(0) };
	const earlyDataHeader = request.headers.get('sec-websocket-protocol') || '';
	const ssDisableEarlyData = !!url.searchParams.get('enc');
	let wsUpstreamQueue = null;
	let wsExplicitChain = Promise.resolve();
	let wsExplicitStopRecv = false, wsExplicitFailed = false, wsExplicitDrainQueued = false;
	let wsExplicitQueueBytes = 0, wsExplicitQueueItems = 0;
	let protocolType = null, currentWriteSocket = null, remoteWriter = null;
	let ssCtx = null, ssInitTask = null;

	const releaseRemoteWriter = () => {
		if (remoteWriter) {
			try { remoteWriter.releaseLock() } catch (e) { }
			remoteWriter = null;
		}
		currentWriteSocket = null;
	};

	const upstreamQueue = wsUpstreamQueue = createUpstreamQueue({
		getWriter: () => {
			const socket = remoteConnWrapper.socket;
			if (!socket) return null;
			if (socket !== currentWriteSocket) {
				releaseRemoteWriter();
				currentWriteSocket = socket;
				remoteWriter = socket.writable.getWriter();
			}
			return remoteWriter;
		},
		releaseWriter: releaseRemoteWriter,
		retryConnect: async () => {
			if (typeof remoteConnWrapper.retryConnect !== 'function') throw new Error('retry unavailable');
			await remoteConnWrapper.retryConnect();
		},
		closeConnection: () => {
			try { remoteConnWrapper.socket?.close() } catch (e) { }
			closeSocketQuietly(serverSock);
		},
		name: 'WS upstream'
	});

	const writeToRemote = async (chunk, allowRetry = true) => {
		return upstreamQueue.writeAndWait(chunk, allowRetry);
	};

	const getSSCtx = async () => {
		if (ssCtx) return ssCtx;
		if (!ssInitTask) {
			ssInitTask = (async () => {
				const requestCipher = (url.searchParams.get('enc') || '').toLowerCase();
				const preferredCipher = SS_CIPHER_CONFIGS[requestCipher] || SS_CIPHER_CONFIGS['aes-128-gcm'];
				const candidateCiphers = [preferredCipher, ...Object.values(SS_CIPHER_CONFIGS).filter(c => c.method !== preferredCipher.method)];
				const inboundMasterKeyCache = new Map();
				const getInboundMasterKeyTask = (config) => {
					if (!inboundMasterKeyCache.has(config.method)) inboundMasterKeyCache.set(config.method, deriveMasterKey(yourUUID, config.keyLen));
					return inboundMasterKeyCache.get(config.method);
				};
				const inboundState = {
					buffer: new Uint8Array(0),
					hasSalt: false,
					waitPayloadLength: null,
					decryptKey: null,
					nonceCounter: new Uint8Array(SS_NONCE_LEN),
					cipherConfig: null,
				};
				const initInboundDecryptState = async () => {
					const lengthCipherTotalLength = 2 + SS_TAG_LEN;
					const maxSaltLen = Math.max(...candidateCiphers.map(c => c.saltLen));
					const maxAlignScanBytes = 16;
					const maxScanOffset = Math.min(maxAlignScanBytes, Math.max(0, inboundState.buffer.byteLength - (lengthCipherTotalLength + Math.min(...candidateCiphers.map(c => c.saltLen)))));
					for (let offset = 0; offset <= maxScanOffset; offset++) {
						for (const cipherConfig of candidateCiphers) {
							const initMinLen = offset + cipherConfig.saltLen + lengthCipherTotalLength;
							if (inboundState.buffer.byteLength < initMinLen) continue;
							const salt = inboundState.buffer.subarray(offset, offset + cipherConfig.saltLen);
							const lengthCipher = inboundState.buffer.subarray(offset + cipherConfig.saltLen, initMinLen);
							const masterKey = await getInboundMasterKeyTask(cipherConfig);
							const decryptKey = await deriveSessionKey(cipherConfig, masterKey, salt, ['decrypt']);
							const nonceCounter = new Uint8Array(SS_NONCE_LEN);
							try {
								const lengthPlain = await ssDecrypt(decryptKey, nonceCounter, lengthCipher);
								if (lengthPlain.byteLength !== 2) continue;
								const payloadLength = (lengthPlain[0] << 8) | lengthPlain[1];
								if (payloadLength < 0 || payloadLength > cipherConfig.maxChunk) continue;
								if (offset > 0) log(`[SS inbound] detected leading noise ${offset}B, auto-aligned`);
								if (cipherConfig.method !== preferredCipher.method) log(`[SS inbound] URL enc=${requestCipher || preferredCipher.method} mismatched actual ${cipherConfig.method}, auto-switched`);
								inboundState.buffer = inboundState.buffer.subarray(initMinLen);
								inboundState.decryptKey = decryptKey;
								inboundState.nonceCounter = nonceCounter;
								inboundState.waitPayloadLength = payloadLength;
								inboundState.cipherConfig = cipherConfig;
								inboundState.hasSalt = true;
								return true;
							} catch (_) { }
						}
					}
					const initFailThreshold = maxSaltLen + lengthCipherTotalLength + maxAlignScanBytes;
					if (inboundState.buffer.byteLength >= initFailThreshold) {
						throw new Error(`SS handshake decrypt failed (enc=${requestCipher || 'auto'}, candidates=${candidateCiphers.map(c => c.method).join('/')})`);
					}
					return false;
				};
				const inboundDecrypter = {
					async input(dataChunk) {
						const chunk = toBytes(dataChunk);
						if (chunk.byteLength > 0) inboundState.buffer = concatBytes(inboundState.buffer, chunk);
						if (!inboundState.hasSalt) {
							const initOk = await initInboundDecryptState();
							if (!initOk) return [];
						}
						const plaintextChunks = [];
						while (true) {
							if (inboundState.waitPayloadLength === null) {
								const lengthCipherTotalLength = 2 + SS_TAG_LEN;
								if (inboundState.buffer.byteLength < lengthCipherTotalLength) break;
								const lengthCipher = inboundState.buffer.subarray(0, lengthCipherTotalLength);
								inboundState.buffer = inboundState.buffer.subarray(lengthCipherTotalLength);
								const lengthPlain = await ssDecrypt(inboundState.decryptKey, inboundState.nonceCounter, lengthCipher);
								if (lengthPlain.byteLength !== 2) throw new Error('SS length decrypt failed');
								const payloadLength = (lengthPlain[0] << 8) | lengthPlain[1];
								if (payloadLength < 0 || payloadLength > inboundState.cipherConfig.maxChunk) throw new Error(`SS payload length invalid: ${payloadLength}`);
								inboundState.waitPayloadLength = payloadLength;
							}
							const payloadCipherTotalLength = inboundState.waitPayloadLength + SS_TAG_LEN;
							if (inboundState.buffer.byteLength < payloadCipherTotalLength) break;
							const payloadCipher = inboundState.buffer.subarray(0, payloadCipherTotalLength);
							inboundState.buffer = inboundState.buffer.subarray(payloadCipherTotalLength);
							const payloadPlain = await ssDecrypt(inboundState.decryptKey, inboundState.nonceCounter, payloadCipher);
							plaintextChunks.push(payloadPlain);
							inboundState.waitPayloadLength = null;
						}
						return plaintextChunks;
					},
				};
				let outboundEncrypter = null;
				const ssBatchMaxBytes = 32 * 1024;
				const getOutboundEncrypter = async () => {
					if (outboundEncrypter) return outboundEncrypter;
					if (!inboundState.cipherConfig) throw new Error('SS cipher is not negotiated');
					const outboundCipher = inboundState.cipherConfig;
					const outboundMasterKey = await deriveMasterKey(yourUUID, outboundCipher.keyLen);
					const outboundSalt = crypto.getRandomValues(new Uint8Array(outboundCipher.saltLen));
					const outboundEncryptKey = await deriveSessionKey(outboundCipher, outboundMasterKey, outboundSalt, ['encrypt']);
					const outboundNonceCounter = new Uint8Array(SS_NONCE_LEN);
					let saltSent = false;
					outboundEncrypter = {
						async encryptAndSend(dataChunk, sendChunk) {
							const plaintextData = toBytes(dataChunk);
							if (!saltSent) {
								await sendChunk(outboundSalt);
								saltSent = true;
							}
							if (plaintextData.byteLength === 0) return;
							let offset = 0;
							while (offset < plaintextData.byteLength) {
								const end = Math.min(offset + outboundCipher.maxChunk, plaintextData.byteLength);
								const payloadPlain = plaintextData.subarray(offset, end);
								const lengthPlain = new Uint8Array(2);
								lengthPlain[0] = (payloadPlain.byteLength >>> 8) & 0xff;
								lengthPlain[1] = payloadPlain.byteLength & 0xff;
								const lengthCipher = await ssEncrypt(outboundEncryptKey, outboundNonceCounter, lengthPlain);
								const payloadCipher = await ssEncrypt(outboundEncryptKey, outboundNonceCounter, payloadPlain);
								const frame = new Uint8Array(lengthCipher.byteLength + payloadCipher.byteLength);
								frame.set(lengthCipher, 0);
								frame.set(payloadCipher, lengthCipher.byteLength);
								await sendChunk(frame);
								offset = end;
							}
						},
					};
					return outboundEncrypter;
				};
				let ssSendQueue = Promise.resolve();
				const ssEnqueueSend = (chunk) => {
					ssSendQueue = ssSendQueue.then(async () => {
						if (serverSock.readyState !== WebSocket.OPEN) return;
						const enc = await getOutboundEncrypter();
						await enc.encryptAndSend(chunk, async (encryptedChunk) => {
							if (encryptedChunk.byteLength > 0 && serverSock.readyState === WebSocket.OPEN) {
								await wsSend(serverSock, encryptedChunk.buffer);
							}
						});
					}).catch((error) => {
						log(`[SS send] encrypt failed: ${error?.message || error}`);
						closeSocketQuietly(serverSock);
					});
					return ssSendQueue;
				};
				const replySocket = {
					get readyState() {
						return serverSock.readyState;
					},
					send(data) {
						const chunk = toBytes(data);
						if (chunk.byteLength <= ssBatchMaxBytes) {
							return ssEnqueueSend(chunk);
						}
						for (let i = 0; i < chunk.byteLength; i += ssBatchMaxBytes) {
							ssEnqueueSend(chunk.subarray(i, Math.min(i + ssBatchMaxBytes, chunk.byteLength)));
						}
						return ssSendQueue;
					},
					close() {
						closeSocketQuietly(serverSock);
					}
				};
				ssCtx = {
					inboundDecrypter,
					replySocket,
					firstPacketEstablished: false,
					targetHost: '',
					targetPort: 0,
				};
				return ssCtx;
			})().finally(() => { ssInitTask = null });
		}
		return ssInitTask;
	};

	const processSSData = async (chunk) => {
		const ctx = await getSSCtx();
		let plainChunks = null;
		try {
			plainChunks = await ctx.inboundDecrypter.input(chunk);
		} catch (err) {
			const msg = err?.message || `${err}`;
			if (msg.includes('Decryption failed') || msg.includes('SS handshake decrypt failed') || msg.includes('SS length decrypt failed')) {
				log(`[SS inbound] decrypt failed, closing: ${msg}`);
				closeSocketQuietly(serverSock);
				return;
			}
			throw err;
		}
		for (const plainChunk of plainChunks) {
			let written = false;
			try {
				written = await writeToRemote(plainChunk, false);
			} catch (err) {
				if ((/** @type {any} */ (err))?.isQueueOverflow) throw err;
				written = false;
			}
			if (written) continue;
			if (ctx.firstPacketEstablished && ctx.targetHost && ctx.targetPort > 0) {
				await forwardataTCP(ctx.targetHost, ctx.targetPort, plainChunk, ctx.replySocket, null, remoteConnWrapper, yourUUID, request);
				continue;
			}
			const plainData = toBytes(plainChunk);
			if (plainData.byteLength < 3) throw new Error('invalid ss data');
			const addressType = plainData[0];
			let cursor = 1;
			let hostname = '';
			if (addressType === 1) {
				if (plainData.byteLength < cursor + 4 + 2) throw new Error('invalid ss ipv4 length');
				hostname = `${plainData[cursor]}.${plainData[cursor + 1]}.${plainData[cursor + 2]}.${plainData[cursor + 3]}`;
				cursor += 4;
			} else if (addressType === 3) {
				if (plainData.byteLength < cursor + 1) throw new Error('invalid ss domain length');
				const domainLength = plainData[cursor];
				cursor += 1;
				if (plainData.byteLength < cursor + domainLength + 2) throw new Error('invalid ss domain data');
				hostname = new TextDecoder().decode(plainData.subarray(cursor, cursor + domainLength));
				cursor += domainLength;
			} else if (addressType === 4) {
				if (plainData.byteLength < cursor + 16 + 2) throw new Error('invalid ss ipv6 length');
				const ipv6 = [];
				const ipv6View = new DataView(plainData.buffer, plainData.byteOffset + cursor, 16);
				for (let i = 0; i < 8; i++) ipv6.push(ipv6View.getUint16(i * 2).toString(16));
				hostname = ipv6.join(':');
				cursor += 16;
			} else {
				throw new Error(`invalid ss addressType: ${addressType}`);
			}
			if (!hostname) throw new Error(`invalid ss address: ${addressType}`);
			const port = (plainData[cursor] << 8) | plainData[cursor + 1];
			cursor += 2;
			const rawClientData = plainData.subarray(cursor);
			if (isSpeedTestSite(hostname)) throw new Error('Speedtest site is blocked');
			ctx.firstPacketEstablished = true;
			ctx.targetHost = hostname;
			ctx.targetPort = port;
			await forwardataTCP(hostname, port, rawClientData, ctx.replySocket, null, remoteConnWrapper, yourUUID, request);
		}
	};

	const processWSInbound = async (chunk) => {
		let currentChunkBytes = null;
		if (isDnsQuery) {
			if (isTrojan) return await forwardTrojanUDP(chunk, serverSock, trojanUDPCtx, request);
			return await forwardataudp(chunk, serverSock, null, request);
		}
		if (protocolType === 'ss') {
			await processSSData(chunk);
			return;
		}
		if (await writeToRemote(chunk)) return;

		if (protocolType === null) {
			if (url.searchParams.get('enc')) protocolType = 'ss';
			else {
				currentChunkBytes = currentChunkBytes || toBytes(chunk);
				const bytes = currentChunkBytes;
				protocolType = bytes.byteLength >= 58 && bytes[56] === 0x0d && bytes[57] === 0x0a ? 'trojan' : 'vless';
			}
			isTrojan = protocolType === 'trojan';
			log(`[WS forward] protocol: ${protocolType} | from: ${url.host} | UA: ${request.headers.get('user-agent') || 'unknown'}`);
		}

		if (protocolType === 'ss') {
			await processSSData(chunk);
			return;
		}
		if (await writeToRemote(chunk)) return;
		if (protocolType === 'trojan') {
			const parsed = parseTrojan(chunk, yourUUID);
			if (parsed?.hasError) throw new Error(parsed.message || 'Invalid trojan request');
			const { port, hostname, rawClientData, isUDP } = parsed;
			if (isSpeedTestSite(hostname)) throw new Error('Speedtest site is blocked');
			if (isUDP) {
				isDnsQuery = true;
				if (dataLength(rawClientData) > 0) return forwardTrojanUDP(rawClientData, serverSock, trojanUDPCtx, request);
				return;
			}
			await forwardataTCP(hostname, port, rawClientData, serverSock, null, remoteConnWrapper, yourUUID, request);
		} else {
			isTrojan = false;
			currentChunkBytes = currentChunkBytes || toBytes(chunk);
			const bytes = currentChunkBytes;
			const parsed = parseVLESS(bytes, yourUUID);
			if (parsed?.hasError) throw new Error(parsed.message || 'Invalid vless request');
			const { port, hostname, version, isUDP, rawClientData } = parsed;
			if (isSpeedTestSite(hostname)) throw new Error('Speedtest site is blocked');
			if (isUDP) {
				if (port === 53) isDnsQuery = true;
				else throw new Error('UDP is not supported');
			}
			const respHeader = new Uint8Array([version, 0]);
			const rawData = rawClientData;
			if (isDnsQuery) {
				if (isTrojan) return forwardTrojanUDP(rawData, serverSock, trojanUDPCtx, request);
				return forwardataudp(rawData, serverSock, respHeader, request);
			}
			await forwardataTCP(hostname, port, rawData, serverSock, respHeader, remoteConnWrapper, yourUUID, request);
		}
	};

	const handleWSExplicitError = (err) => {
		if (wsExplicitFailed) return;
		wsExplicitFailed = true;
		wsExplicitStopRecv = true;
		wsExplicitQueueBytes = 0;
		wsExplicitQueueItems = 0;
		const msg = err?.message || `${err}`;
		if (msg.includes('Network connection lost') || msg.includes('ReadableStream is closed')) {
			log(`[WS forward] connection ended: ${msg}`);
		} else {
			log(`[WS forward] processing failed: ${msg}`);
		}
		upstreamQueue.clear();
		releaseRemoteWriter();
		closeSocketQuietly(serverSock);
	};

	const appendWSExplicitTask = (task) => {
		wsExplicitChain = wsExplicitChain.then(task).catch(handleWSExplicitError);
		return wsExplicitChain;
	};

	const enqueueWSExplicit = (data) => {
		if (wsExplicitStopRecv || wsExplicitFailed) return;
		const chunkSize = Math.max(0, dataLength(data));
		const nextBytes = wsExplicitQueueBytes + chunkSize;
		const nextItems = wsExplicitQueueItems + 1;
		if (nextBytes > UPSTREAM_QUEUE_MAX_BYTES || nextItems > UPSTREAM_QUEUE_MAX_ITEMS) {
			handleWSExplicitError(new Error(`[WS explicit] queue overflow: ${nextBytes}B/${nextItems}`));
			return;
		}
		wsExplicitQueueBytes = nextBytes;
		wsExplicitQueueItems = nextItems;
		appendWSExplicitTask(async () => {
			wsExplicitQueueBytes = Math.max(0, wsExplicitQueueBytes - chunkSize);
			wsExplicitQueueItems = Math.max(0, wsExplicitQueueItems - 1);
			if (wsExplicitFailed) return;
			await processWSInbound(data);
		});
	};

	const drainWSExplicit = () => {
		if (wsExplicitDrainQueued) return;
		wsExplicitDrainQueued = true;
		wsExplicitStopRecv = true;
		appendWSExplicitTask(async () => {
			if (wsExplicitFailed) return;
			await upstreamQueue.waitEmpty();
			releaseRemoteWriter();
		});
	};

	serverSock.addEventListener('message', (event) => {
		enqueueWSExplicit(event.data);
	});
	serverSock.addEventListener('close', () => {
		closeSocketQuietly(serverSock);
		drainWSExplicit();
	});
	serverSock.addEventListener('error', (err) => {
		handleWSExplicitError(err);
	});

	// SS mode disables sec-websocket-protocol early-data to avoid injecting subprotocol value (e.g. "binary")
	// as base64 data into the first packet, which would cause AEAD decrypt failure.
	if (!ssDisableEarlyData && earlyDataHeader) {
		try {
			const bytes = decodeWSEarlyData(earlyDataHeader, yourUUID);
			if (bytes?.byteLength) enqueueWSExplicit(bytes.buffer);
		} catch (error) {
			handleWSExplicitError(error);
		}
	}

	return new Response(null, { status: 101, webSocket: clientSock, headers: { 'Sec-WebSocket-Extensions': '' } });
}

// ====== src/transport/grpc.js ======
// transport/grpc.js — gRPC 传输处理（原版提取，行 838-1085）


async function handleGRPC(request, yourUUID) {
  if (!request.body) return new Response('Bad Request', { status: 400 });
  const reader = request.body.getReader();
  const remoteConnWrapper = { socket: null, connectingPromise: null, retryConnect: null };
  let isDnsQuery = false;
  const trojanUDPCtx = { cache: new Uint8Array(0) };
  let isTrojan = null;
  let currentSocket = null;
  let remoteWriter = null;
  let grpcUpstreamQueue = null;

  const grpcHeaders = new Headers({
    'Content-Type': 'application/grpc',
    'grpc-status': '0',
    'X-Accel-Buffering': 'no',
    'Cache-Control': 'no-store'
  });

  const downBufLimit = DOWNSTREAM_GRAIN_PACKET;
  const downFlushInterval = Math.max(DOWNSTREAM_GRAIN_SILENCE_MS, 1);

  return new Response(new ReadableStream({
    async start(controller) {
      let closed = false;
      let sendQueue = [];
      let queueBytes = 0;
      let flushTimer = null;
      let microtaskQueued = false;

      const grpcBridge = {
        readyState: WebSocket.OPEN,
        send(data) {
          if (closed) return;
          const chunk = data instanceof Uint8Array ? data : new Uint8Array(data);
          const lenBytesArr = [];
          let remaining = chunk.byteLength >>> 0;
          while (remaining > 127) {
            lenBytesArr.push((remaining & 0x7f) | 0x80);
            remaining >>>= 7;
          }
          lenBytesArr.push(remaining);
          const lenBytes = new Uint8Array(lenBytesArr);
          const protobufLen = 1 + lenBytes.length + chunk.byteLength;
          const frame = new Uint8Array(5 + protobufLen);
          frame[0] = 0;
          frame[1] = (protobufLen >>> 24) & 0xff;
          frame[2] = (protobufLen >>> 16) & 0xff;
          frame[3] = (protobufLen >>> 8) & 0xff;
          frame[4] = protobufLen & 0xff;
          frame[5] = 0x0a;
          frame.set(lenBytes, 6);
          frame.set(chunk, 6 + lenBytes.length);
          sendQueue.push(frame);
          queueBytes += frame.byteLength;
          scheduleFlush();
        },
        close() {
          if (this.readyState === WebSocket.CLOSED) return;
          flushQueue(true);
          closed = true;
          this.readyState = WebSocket.CLOSED;
          try { controller.close(); } catch (e) { }
        }
      };

      const flushQueue = (force = false) => {
        microtaskQueued = false;
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        if ((!force && closed) || queueBytes === 0) return;
        const out = new Uint8Array(queueBytes);
        let offset = 0;
        for (const item of sendQueue) {
          out.set(item, offset);
          offset += item.byteLength;
        }
        sendQueue = [];
        queueBytes = 0;
        try {
          controller.enqueue(out);
        } catch (e) {
          closed = true;
          grpcBridge.readyState = WebSocket.CLOSED;
        }
      };

      const scheduleFlush = () => {
        if (queueBytes >= downBufLimit) {
          flushQueue();
          return;
        }
        if (microtaskQueued || flushTimer) return;
        microtaskQueued = true;
        queueMicrotask(() => {
          microtaskQueued = false;
          if (closed || queueBytes === 0 || flushTimer) return;
          flushTimer = setTimeout(flushQueue, downFlushInterval);
        });
      };

      const closeConnection = () => {
        if (closed) return;
        grpcUpstreamQueue?.clear();
        flushQueue(true);
        closed = true;
        grpcBridge.readyState = WebSocket.CLOSED;
        if (flushTimer) clearTimeout(flushTimer);
        if (remoteWriter) {
          try { remoteWriter.releaseLock(); } catch (e) { }
          remoteWriter = null;
        }
        currentSocket = null;
        try { reader.releaseLock(); } catch (e) { }
        try { remoteConnWrapper.socket?.close(); } catch (e) { }
        try { controller.close(); } catch (e) { }
      };

      const releaseRemoteWriter = () => {
        if (remoteWriter) {
          try { remoteWriter.releaseLock(); } catch (e) { }
          remoteWriter = null;
        }
        currentSocket = null;
      };

      const upstreamQueue = grpcUpstreamQueue = createUpstreamQueue({
        getWriter: () => {
          const socket = remoteConnWrapper.socket;
          if (!socket) return null;
          if (socket !== currentSocket) {
            releaseRemoteWriter();
            currentSocket = socket;
            remoteWriter = socket.writable.getWriter();
          }
          return remoteWriter;
        },
        releaseWriter: releaseRemoteWriter,
        retryConnect: async () => {
          if (typeof remoteConnWrapper.retryConnect !== 'function') throw new Error('retry unavailable');
          await remoteConnWrapper.retryConnect();
        },
        closeConnection,
        name: 'gRPC上行'
      });

      const writeToRemote = async (payload, allowRetry = true) => {
        return upstreamQueue.writeAndWait(payload, allowRetry);
      };

      try {
        let pending = new Uint8Array(0);
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value || value.byteLength === 0) continue;
          const block = value instanceof Uint8Array ? value : new Uint8Array(value);
          const merged = new Uint8Array(pending.length + block.length);
          merged.set(pending, 0);
          merged.set(block, pending.length);
          pending = merged;

          while (pending.byteLength >= 5) {
            const grpcLen = ((pending[1] << 24) >>> 0) | (pending[2] << 16) | (pending[3] << 8) | pending[4];
            const frameSize = 5 + grpcLen;
            if (pending.byteLength < frameSize) break;
            const grpcPayload = pending.subarray(5, frameSize);
            pending = pending.slice(frameSize);
            if (!grpcPayload.byteLength) continue;

            let payload = grpcPayload;
            if (payload.byteLength >= 2 && payload[0] === 0x0a) {
              let shift = 0;
              let offset = 1;
              let varintValid = false;
              while (offset < payload.length) {
                const current = payload[offset++];
                if ((current & 0x80) === 0) {
                  varintValid = true;
                  break;
                }
                shift += 7;
                if (shift > 35) break;
              }
              if (varintValid) payload = payload.subarray(offset);
            }
            if (!payload.byteLength) continue;

            if (isDnsQuery) {
              if (isTrojan) await forwardTrojanUDP(payload, grpcBridge, trojanUDPCtx, request);
              else await forwardataudp(payload, grpcBridge, null, request);
              continue;
            }

            if (remoteConnWrapper.socket) {
              if (!(await writeToRemote(payload))) throw new Error('Remote socket is not ready');
            } else {
              const firstBytes = toBytes(payload);
              if (isTrojan === null) isTrojan = firstBytes.byteLength >= 58 && firstBytes[56] === 0x0d && firstBytes[57] === 0x0a;

              if (isTrojan) {
                const parsed = parseTrojan(firstBytes, yourUUID);
                if (parsed?.hasError) throw new Error(parsed.message || 'Invalid trojan request');
                const { port, hostname, rawClientData, isUDP } = parsed;
                log(`[gRPC] Trojan first: ${hostname}:${port} | UDP: ${isUDP ? 'yes' : 'no'}`);
                if (isSpeedTestSite(hostname)) throw new Error('Speedtest site is blocked');
                if (isUDP) {
                  isDnsQuery = true;
                  if (dataLength(rawClientData) > 0) await forwardTrojanUDP(rawClientData, grpcBridge, trojanUDPCtx, request);
                } else {
                  await forwardataTCP(hostname, port, rawClientData, grpcBridge, null, remoteConnWrapper, yourUUID, request);
                }
              } else {
                isTrojan = false;
                const parsed = parseVLESS(firstBytes, yourUUID);
                if (parsed?.hasError) throw new Error(parsed.message || 'Invalid VLESS request');
                const { port, hostname, version, isUDP, rawClientData } = parsed;
                log(`[gRPC] VLESS first: ${hostname}:${port} | UDP: ${isUDP ? 'yes' : 'no'}`);
                if (isSpeedTestSite(hostname)) throw new Error('Speedtest site is blocked');
                if (isUDP) {
                  if (port !== 53) throw new Error('UDP is not supported');
                  isDnsQuery = true;
                }
                const respHeader = new Uint8Array([version, 0]);
                grpcBridge.send(respHeader);
                const rawData = rawClientData;
                if (isDnsQuery) {
                  if (isTrojan) await forwardTrojanUDP(rawData, grpcBridge, trojanUDPCtx, request);
                  else await forwardataudp(rawData, grpcBridge, null, request);
                } else {
                  await forwardataTCP(hostname, port, rawData, grpcBridge, null, remoteConnWrapper, yourUUID, request);
                }
              }
            }
          }
          flushQueue();
        }
        await upstreamQueue.waitEmpty();
      } catch (err) {
        log(`[gRPC] Error: ${err?.message || err}`);
      } finally {
        upstreamQueue.clear();
        releaseRemoteWriter();
        closeConnection();
      }
    },
    cancel() {
      grpcUpstreamQueue?.clear();
      try { remoteConnWrapper.socket?.close(); } catch (e) { }
      try { reader.releaseLock(); } catch (e) { }
    }
  }), { status: 200, headers: grpcHeaders });
}


// ====== src/transport/xhttp.js ======
// transport/xhttp.js — XHTTP 传输处理（原版提取，行 529-837）

const VLESS_DECODER = new TextDecoder();
const UUID_CACHE = new Map();

function hexNibble(code) {
  if (code >= 48 && code <= 57) return code - 48;
  code |= 32;
  if (code >= 97 && code <= 102) return code - 87;
  return -1;
}

function getUUIDBytes(uuid) {
  const key = String(uuid || '');
  let c = UUID_CACHE.get(key);
  if (c) return c;
  const clean = key.replace(/-/g, '');
  if (clean.length !== 32) return null;
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    const h = hexNibble(clean.charCodeAt(i * 2));
    const l = hexNibble(clean.charCodeAt(i * 2 + 1));
    if (h < 0 || l < 0) return null;
    bytes[i] = (h << 4) | l;
  }
  if (UUID_CACHE.size >= 32) UUID_CACHE.clear();
  UUID_CACHE.set(key, bytes);
  return bytes;
}

function uuidMatch(data, offset, uuid) {
  const exp = getUUIDBytes(uuid);
  if (!exp || data.byteLength < offset + 16) return false;
  for (let i = 0; i < 16; i++) if (data[offset + i] !== exp[i]) return false;
  return true;
}

function parseVLESSFirst(data, token) {
  const len = data.byteLength;
  if (len < 18) return { s: 'more' };
  if (!uuidMatch(data, 1, token)) return { s: 'bad' };
  const opt = data[17], ci = 18 + opt;
  if (len < ci + 1) return { s: 'more' };
  const cmd = data[ci];
  if (cmd !== 1 && cmd !== 2) return { s: 'bad' };
  const pi = ci + 1;
  if (len < pi + 3) return { s: 'more' };
  const port = (data[pi] << 8) | data[pi + 1];
  const at = data[pi + 2], ai = pi + 3;
  let hl = -1, host = '';
  if (at === 1) { if (len < ai + 4) return { s: 'more' }; host = `${data[ai]}.${data[ai+1]}.${data[ai+2]}.${data[ai+3]}`; hl = ai + 4; }
  else if (at === 2) { if (len < ai + 1) return { s: 'more' }; const dl = data[ai]; if (len < ai + 1 + dl) return { s: 'more' }; host = VLESS_DECODER.decode(data.subarray(ai + 1, ai + 1 + dl)); hl = ai + 1 + dl; }
  else if (at === 3) { if (len < ai + 16) return { s: 'more' }; const a = []; for (let i = 0; i < 8; i++) { const b = ai + i * 2; a.push(((data[b] << 8) | data[b + 1]).toString(16)); } host = a.join(':'); hl = ai + 16; }
  else return { s: 'bad' };
  if (!host) return { s: 'bad' };
  return { s: 'ok', r: { proto: 'vless', host, port, udp: cmd === 2, raw: data.subarray(hl), hdr: new Uint8Array([data[0], 0]) } };
}

function parseTrojanFirst(data, token) {
  const hash = sha224str(token);
  const hb = new TextEncoder().encode(hash);
  const len = data.byteLength;
  if (len < 58) return { s: 'more' };
  if (data[56] !== 0x0d || data[57] !== 0x0a) return { s: 'bad' };
  for (let i = 0; i < 56; i++) if (data[i] !== hb[i]) return { s: 'bad' };
  const ss = 58;
  if (len < ss + 2) return { s: 'more' };
  const cmd = data[ss];
  if (cmd !== 1 && cmd !== 3) return { s: 'bad' };
  const udp = cmd === 3, at = data[ss + 1];
  let cur = ss + 2, host = '';
  if (at === 1) { if (len < cur + 4) return { s: 'more' }; host = `${data[cur]}.${data[cur+1]}.${data[cur+2]}.${data[cur+3]}`; cur += 4; }
  else if (at === 3) { if (len < cur + 1) return { s: 'more' }; const dl = data[cur]; if (len < cur + 1 + dl) return { s: 'more' }; host = VLESS_DECODER.decode(data.subarray(cur + 1, cur + 1 + dl)); cur += 1 + dl; }
  else if (at === 4) { if (len < cur + 16) return { s: 'more' }; const a = []; for (let i = 0; i < 8; i++) { const b = cur + i * 2; a.push(((data[b] << 8) | data[b + 1]).toString(16)); } host = a.join(':'); cur += 16; }
  else return { s: 'bad' };
  if (!host) return { s: 'bad' };
  if (len < cur + 4) return { s: 'more' };
  const port = (data[cur] << 8) | data[cur + 1];
  if (data[cur + 2] !== 0x0d || data[cur + 3] !== 0x0a) return { s: 'bad' };
  return { s: 'ok', r: { proto: 'trojan', host, port, udp, raw: data.subarray(cur + 4), hdr: null } };
}

async function readXHTTPFirst(reader, token) {
  let buf = new Uint8Array(1024), off = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) { if (off === 0) return null; break; }
    const ch = value instanceof Uint8Array ? value : new Uint8Array(value);
    if (off + ch.byteLength > buf.byteLength) {
      const nb = new Uint8Array(Math.max(buf.byteLength * 2, off + ch.byteLength));
      nb.set(buf.subarray(0, off)); buf = nb;
    }
    buf.set(ch, off); off += ch.byteLength;
    const cd = buf.subarray(0, off);
    const tr = parseTrojanFirst(cd, token);
    if (tr.s === 'ok') return { ...tr.r, reader };
    const vr = parseVLESSFirst(cd, token);
    if (vr.s === 'ok') return { ...vr.r, reader };
    if (tr.s === 'bad' && vr.s === 'bad') return null;
  }
  const fd = buf.subarray(0, off);
  const ft = parseTrojanFirst(fd, token);
  if (ft.s === 'ok') return { ...ft.r, reader };
  const fv = parseVLESSFirst(fd, token);
  if (fv.s === 'ok') return { ...fv.r, reader };
  return null;
}

async function handleXHTTP(request, yourUUID) {
  if (!request.body) return new Response('Bad Request', { status: 400 });
  const reader = request.body.getReader();
  const pkt = await readXHTTPFirst(reader, yourUUID);
  if (!pkt) { try { reader.releaseLock(); } catch (_) {} return new Response('Invalid request', { status: 400 }); }
  if (isSpeedTestSite(pkt.host)) { try { reader.releaseLock(); } catch (_) {} return new Response('Forbidden', { status: 403 }); }
  if (pkt.udp && pkt.proto !== 'trojan' && pkt.port !== 53) { try { reader.releaseLock(); } catch (_) {} return new Response('UDP unsupported', { status: 400 }); }

  const rw = { socket: null, connectingPromise: null, retryConnect: null };
  let cs = null, rwr = null;

  const relR = () => { if (rwr) { try { rwr.releaseLock(); } catch (_) {} rwr = null; } cs = null; };
  const getR = () => { const s = rw.socket; if (!s) return null; if (s !== cs) { relR(); cs = s; rwr = s.writable.getWriter(); } return rwr; };

  let uq = null;
  return new Response(new ReadableStream({
    async start(ctrl) {
      let cl = false, uh = pkt.hdr;
      const tu = { cache: new Uint8Array(0) };
      const br = {
        readyState: WebSocket.OPEN,
        send(d) {
          if (cl) return;
          try {
            const ck = d instanceof Uint8Array ? d : d instanceof ArrayBuffer ? new Uint8Array(d) : ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength) : new Uint8Array(d);
            ctrl.enqueue(ck);
          } catch (_) { cl = true; br.readyState = WebSocket.CLOSED; }
        },
        close() { if (!cl) { cl = true; br.readyState = WebSocket.CLOSED; try { ctrl.close(); } catch (_) {} } }
      };
      const uq2 = uq = createUpstreamQueue({
        getWriter: getR,
        releaseWriter: relR,
        retryConnect: async () => { if (typeof rw.retryConnect !== 'function') throw new Error('retry'); await rw.retryConnect(); },
        closeConnection: () => { try { rw.socket?.close(); } catch (_) {} closeSocketQuietly(br); },
        name: 'XHTTP上行'
      });
      const wr = async (p, ar = true) => uq2.writeAndWait(p, ar);
      try {
        if (pkt.udp) {
          if (pkt.raw?.byteLength) {
            if (pkt.proto === 'trojan') await forwardTrojanUDP(pkt.raw, br, tu, request);
            else await forwardataudp(pkt.raw, br, uh, request);
            uh = null;
          }
        } else { await forwardataTCP(pkt.host, pkt.port, pkt.raw, br, pkt.hdr, rw, yourUUID, request); }
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value || value.byteLength === 0) continue;
          if (pkt.udp) {
            if (pkt.proto === 'trojan') await forwardTrojanUDP(value, br, tu, request);
            else await forwardataudp(value, br, uh, request);
            uh = null;
          } else { if (!(await wr(value))) throw new Error('Remote not ready'); }
        }
        if (!pkt.udp) { await uq2.waitEmpty(); const w = getR(); if (w) { try { await w.close(); } catch (_) {} } }
      } catch (err) { log(`[XHTTP] Error: ${err?.message || err}`); closeSocketQuietly(br); }
      finally { uq2.clear(); relR(); try { reader.releaseLock(); } catch (_) {} }
    },
    cancel() { uq?.clear(); try { rw.socket?.close(); } catch (_) {} relR(); try { reader.releaseLock(); } catch (_) {} }
  }), { status: 200, headers: new Headers({ 'Content-Type': 'application/octet-stream', 'X-Accel-Buffering': 'no', 'Cache-Control': 'no-store' }) });
}

// ====== src/proxy/proxy-config.js ======
// proxy/proxy-config.js — Proxy parameter parsing from URL
// Extracted from original: 反代参数获取 (line 5481+)

/** Default proxy ports */
const DEFAULT_PORTS = { socks5: 1080, http: 80, https: 443, turn: 3478, sstp: 443 };

/**
 * Parse proxy config from URL search params and env.
 * Sets global proxy state on the context object.
 */
async function parseProxyConfig(url, userID, env, ctx) {
  const { searchParams } = url;
  const pathname = decodeURIComponent(url.pathname);
  const pathLower = pathname.toLowerCase();

  // Check for proxy in URL params
  for (const proto of ['socks5', 'http', 'https', 'turn', 'sstp']) {
    const raw = searchParams.get(proto);
    if (raw) {
      ctx.enableSOCKS5Proxy = proto;
      ctx.mySOCKS5Account = raw;
      ctx.parsedSocks5Address = parseProxyAddress(raw, DEFAULT_PORTS[proto]);
      log(ctx.debugLog, `[Proxy] ${proto} proxy: ${ctx.parsedSocks5Address.hostname}:${ctx.parsedSocks5Address.port}`);
    }
  }

  // Check global proxy toggle
  const globalProxy = searchParams.get('global') || searchParams.get('proxy');
  if (globalProxy === 'true' || globalProxy === '1') {
    ctx.enableSOCKS5Global = true;
  }

  // Parse GO2SOCKS5 whitelist from env
  if (env.GO2SOCKS5) {
    const extra = await splitToArray(env.GO2SOCKS5);
    ctx.socks5Whitelist = [...new Set([...ctx.socks5Whitelist, ...extra])];
  }

  // Check for proxy via path segments (e.g., /socks5/user:pass@host:port/...)
  for (const proto of ['socks5', 'http', 'https', 'turn', 'sstp']) {
    const prefix = proto + '/';
    const idx = pathLower.indexOf(prefix);
    if (idx !== -1) {
      const after = pathname.slice(idx + prefix.length);
      const end = after.indexOf('/');
      const proxyPart = end === -1 ? after : after.slice(0, end);
      if (proxyPart) {
        ctx.enableSOCKS5Proxy = proto;
        ctx.mySOCKS5Account = proxyPart;
        ctx.parsedSocks5Address = parseProxyAddress(proxyPart, DEFAULT_PORTS[proto]);
        ctx.enableSOCKS5Global = true;
        log(ctx.debugLog, `[Proxy] path-based ${proto}: ${ctx.parsedSocks5Address.hostname}:${ctx.parsedSocks5Address.port}`);
      }
    }
  }
}

/**
 * Parse proxy address string (user:pass@host:port or host:port)
 */
function parseProxyAddress(raw, defaultPort) {
  let str = String(raw || '').trim();
  let username = null, password = null, hostname = '127.0.0.1', port = defaultPort;

  // Strip protocol prefix
  str = str.replace(/^[a-z]+:\/\//i, '');

  // Extract user:pass
  const atIdx = str.lastIndexOf('@');
  if (atIdx !== -1) {
    const auth = str.slice(0, atIdx);
    str = str.slice(atIdx + 1);
    const colonIdx = auth.indexOf(':');
    if (colonIdx !== -1) {
      username = auth.slice(0, colonIdx);
      password = auth.slice(colonIdx + 1);
    } else {
      username = auth;
    }
  }

  // Extract host:port
  if (str.startsWith('[')) {
    const closeBracket = str.indexOf(']');
    if (closeBracket !== -1) {
      hostname = str.slice(1, closeBracket);
      const afterBracket = str.slice(closeBracket + 1);
      if (afterBracket.startsWith(':')) {
        const p = parseInt(afterBracket.slice(1), 10);
        if (p > 0 && p < 65536) port = p;
      }
    }
  } else {
    const colonIdx = str.lastIndexOf(':');
    if (colonIdx !== -1) {
      const p = parseInt(str.slice(colonIdx + 1), 10);
      if (p > 0 && p < 65536) {
        hostname = str.slice(0, colonIdx);
        port = p;
      } else {
        hostname = str;
      }
    } else {
      hostname = str;
    }
  }

  if (!hostname) hostname = '127.0.0.1';
  return { username, password, hostname, port };
}

// ====== src/subscription/subscription.js ======
// subscription/subscription.js — 订阅生成（全部走远端转换后端）


async function handleSubscription(request, env, ctx, ctx_, host, UA) {
  const url = new URL(request.url);
  const userID = ctx_.userID;
  const subToken = await md5md5(host + userID);
  const isBestSub = ['1', 'true'].includes(env.BEST_SUB)
    && url.searchParams.get('host') === 'example.com'
    && url.searchParams.get('uuid') === '00000000-0000-4000-8000-000000000000'
    && UA.toLowerCase().includes('tunnel (https://github.com/' + FINGERPRINT_DICT[1] + '/edge');

  const reqToken = url.searchParams.get('token');
  const isClient = reqToken === subToken;
  const daySeq = Math.floor(Date.now() / 86400000);
  const backendSeed = base64SecretEncode(subToken, userID);
  const [todayToken, yesterdayToken] = await Promise.all([
    md5md5(backendSeed + daySeq),
    md5md5(backendSeed + (daySeq - 1)),
  ]);
  const isBackend = reqToken === todayToken || reqToken === yesterdayToken;

  if (!isClient && !isBackend && !isBestSub) return null;

  const config = await readConfigKV(env, host, userID, UA);

  const ua = UA.toLowerCase();
  const headers = {
    'content-type': 'text/plain; charset=utf-8',
    'Profile-Update-Interval': String(config.优选订阅生成?.SUBUpdateTime || 6),
    'Profile-web-page-url': url.protocol + '//' + url.host + '/admin',
    'Cache-Control': 'no-store',
  };

  if (config.CF?.Usage?.success) {
    const pages = config.CF.Usage.pages;
    const workers = config.CF.Usage.workers;
    const max = Number.isFinite(config.CF.Usage.max) ? (config.CF.Usage.max / 1000) * 1024 : 102400;
    headers['Subscription-Userinfo'] = `upload=${pages}; download=${workers}; total=${max}; expire=4102329600`;
  }

  const isSubConverter = url.searchParams.has('b64')
    || url.searchParams.has('base64')
    || request.headers.get('subconverter-request')
    || request.headers.get('subconverter-version')
    || ua.includes('subconverter')
    || ua.includes('cf-workers-sub')
    || isBestSub;

  const subType = isSubConverter ? 'mixed'
    : url.searchParams.has('target') ? url.searchParams.get('target')
    : url.searchParams.has('clash') || ua.includes('clash') || ua.includes('meta') || ua.includes('mihomo') ? 'clash'
    : url.searchParams.has('sb') || url.searchParams.has('singbox') || ua.includes('singbox') || ua.includes('sing-box') ? 'singbox'
    : url.searchParams.has('surge') || ua.includes('surge') ? 'surge&ver=4'
    : url.searchParams.has('quanx') || ua.includes('quantumult') ? 'quanx'
    : url.searchParams.has('loon') || ua.includes('loon') ? 'loon'
    : 'mixed';

  if (!ua.includes('mozilla')) {
    headers['Content-Disposition'] = `attachment; filename*=utf-8''${encodeURIComponent(config.优选订阅生成?.SUBNAME || 'edgetunnel')}`;
  }

  // 所有订阅类型统一走远端转换后端
  const subConverterUrl = buildSubConverterUrl(config, subType, url, subToken);
  let content = '';
  try {
    const resp = await fetch(subConverterUrl, {
      headers: { 'User-Agent': 'Subconverter for ' + subType + ' edgetunnel (https://github.com/' + FINGERPRINT_DICT[1] + '/edgetunnel)' }
    });
    if (resp.ok) {
      content = await resp.text();
      if (url.searchParams.has('surge') || ua.includes('surge')) {
        content = surgePatch(content, url.protocol + '//' + url.host + '/sub?token=' + subToken + '&surge', config);
      }
    } else {
      return new Response('订阅转换后端异常：' + resp.statusText, { status: resp.status });
    }
  } catch (err) {
    return new Response('订阅转换后端异常：' + err.message, { status: 403 });
  }

  // 替换占位符
  if (!ua.includes('subconverter') && isClient) {
    const shuffledHosts = [...(config.HOSTS || [host])].sort(() => Math.random() - 0.5);
    let count = 0, randomHost = null;
    content = content
      .replace(/00000000-0000-4000-8000-000000000000/g, config.UUID)
      .replace(/MDAwMDAwMDAtMDAwMC00MDAwLTgwMDAtMDAwMDAwMDAwMDAw/g, btoa(config.UUID))
      .replace(/example\.com/g, () => {
        if (count % 2 === 0) randomHost = replaceStars(shuffledHosts[Math.floor(count / 2) % shuffledHosts.length]);
        count++;
        return randomHost;
      });
  }

  if (subType === 'mixed' && (!ua.includes('mozilla') || url.searchParams.has('b64') || url.searchParams.has('base64'))) {
    content = btoa(content);
  }
  if (subType === 'singbox') {
    content = singboxPatch(content, config);
    headers['content-type'] = 'application/json; charset=utf-8';
  } else if (subType === 'clash') {
    content = clashPatch(content, config);
    headers['content-type'] = 'application/x-yaml; charset=utf-8';
  }

  return new Response(content, { status: 200, headers });
}
function buildSubConverterUrl(config, subType, url, todayToken) {
  const subapi = config.订阅转换配置?.SUBAPI || 'https://subapi.cmliussss.net';
  const subconfig = config.订阅转换配置?.SUBCONFIG || '';
  const emoji = config.订阅转换配置?.SUBEMOJI || false;
  const list = config.订阅转换配置?.SUBLIST || false;
  return `${subapi}/sub?target=${subType}&url=${encodeURIComponent(url.protocol + '//' + url.host + '/sub?target=mixed&token=' + todayToken)}&config=${encodeURIComponent(subconfig)}&emoji=${emoji}&list=${list}`;
}

// ============================================================
// 客户端 patch（已实现）
// ============================================================
function surgePatch(content, url, config) {
  const lines = content.includes('\r\n') ? content.split('\r\n') : content.split('\n');
  const fullPath = config.随机路径 ? randomPath(config.完整节点路径) : config.完整节点路径;
  let out = '';
  for (const line of lines) {
    if (line.trim().startsWith('#')) { out += line + '\n'; continue; }
    if (line.trim()) out += line.replace(/path=([^&]+)/, 'path=' + encodeURIComponent(fullPath)) + '\n';
    else out += line + '\n';
  }
  return out;
}

function clashPatch(content, config) {
  const uuid = config?.UUID || '';
  const lines = content.split('\n');
  const result = [];
  for (const line of lines) {
    let l = line;
    l = l.replace(/uuid:\s*00000000-0000-4000-8000-000000000000/g, 'uuid: ' + uuid);
    l = l.replace(/server:\s*example\.com/g, 'server: ' + (config.HOSTS?.[0] || config.HOST || ''));
    result.push(l);
  }
  return result.join('\n');
}

function singboxPatch(content, config) {
  const uuid = config?.UUID || '';
  const fp = config?.Fingerprint || 'chrome';
  return content
    .replace(/"uuid":\s*"00000000-0000-4000-8000-000000000000"/g, '"uuid": "' + uuid + '"')
    .replace(/"server":\s*"example\.com"/g, '"server": "' + (config.HOSTS?.[0] || config.HOST || '') + '"')
    .replace(/"utls-fingerprint":\s*"[^"]*"/g, '"utls-fingerprint": "' + fp + '"');
}

// ====== src/nginx.js ======
// nginx.js — 伪装页（原版提取）

function nginx() {
  return `
<!DOCTYPE html>
<html>
<head>
<title>Welcome to nginx!</title>
<style>
    body {
        width: 35em;
        margin: 0 auto;
        font-family: Tahoma, Verdana, Arial, sans-serif;
    }
</style>
</head>
<body>
<h1>Welcome to nginx!</h1>
<p>If you see this page, the nginx web server is successfully installed and
working. Further configuration is required.</p>

<p>For online documentation and support please refer to
<a href="http://nginx.org/">nginx.org</a>.<br/>
Commercial support is available at
<a href="http://nginx.com/">nginx.com</a>.</p>

<p><em>Thank you for using nginx.</em></p>
</body>
</html>
`;
}

function html1101(host, ip) {
  const now = new Date();
  const ts = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0') + ' ' + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0') + ':' + String(now.getSeconds()).padStart(2, '0');
  const rid = Array.from(crypto.getRandomValues(new Uint8Array(8))).map(b => b.toString(16).padStart(2, '0')).join('');
  return `<!DOCTYPE html>
<!--[if lt IE 7]> <html class="no-js ie6 oldie" lang="en-US"> <![endif]-->
<!--[if IE 7]>    <html class="no-js ie7 oldie" lang="en-US"> <![endif]-->
<!--[if IE 8]>    <html class="no-js ie8 oldie" lang="en-US"> <![endif]-->
<!--[if gt IE 8]><!--> <html class="no-js" lang="en-US"> <!--<![endif]-->
<head>
<title>Worker threw exception | ${host} | Cloudflare</title>
<meta charset="UTF-8" />
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta http-equiv="X-UA-Compatible" content="IE=Edge" />
<meta name="robots" content="noindex, nofollow" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<link rel="stylesheet" id="cf_styles-css" href="/cdn-cgi/styles/cf.errors.css" />
<!--[if lt IE 9]><link rel="stylesheet" id='cf_styles-ie-css' href="/cdn-cgi/styles/cf.errors.ie.css" /><![endif]-->
<style>body{margin:0;padding:0}</style>
<!--[if gte IE 10]><!-->
<script>
  if (!navigator.cookieEnabled) {
    window.addEventListener('DOMContentLoaded', function () {
      var cookieEl = document.getElementById('cookie-alert');
      cookieEl.style.display = 'block';
    })
  }
</script>
<!--<![endif]-->
</head>
<body>
    <div id="cf-wrapper">
        <div class="cf-alert cf-alert-error cf-cookie-error" id="cookie-alert" data-translate="enable_cookies">Please enable cookies.</div>
        <div id="cf-error-details" class="cf-error-details-wrapper">
            <div class="cf-wrapper cf-header cf-error-overview">
                <h1>
                    <span class="cf-error-type" data-translate="error">Error</span>
                    <span class="cf-error-code">1101</span>
                    <small class="heading-ray-id">Ray ID: ${rid} &bull; ${ts} UTC</small>
                </h1>
                <h2 class="cf-subheadline" data-translate="error_desc">Worker threw exception</h2>
            </div>
            <section></section>
            <div class="cf-section cf-wrapper">
                <div class="cf-columns two">
                    <div class="cf-column">
                        <h2 data-translate="what_happened">What happened?</h2>
                            <p>You've requested a page on a website (${host}) that is on the <a href="https://www.cloudflare.com/5xx-error-landing?utm_source=error_100x" target="_blank">Cloudflare</a> network. An unknown error occurred while rendering the page.</p>
                    </div>
                    <div class="cf-column">
                        <h2 data-translate="what_can_i_do">What can I do?</h2>
                            <p><strong>If you are the owner of this website:</strong><br />refer to <a href="https://developers.cloudflare.com/workers/observability/errors/" target="_blank">Workers - Errors and Exceptions</a> and check Workers Logs for ${host}.</p>
                    </div>
                </div>
            </div>
            <div class="cf-error-footer cf-wrapper w-240 lg:w-full py-10 sm:py-4 sm:px-8 mx-auto text-center sm:text-left border-solid border-0 border-t border-gray-300">
    <p class="text-13">
      <span class="cf-footer-item sm:block sm:mb-1">Cloudflare Ray ID: <strong class="font-semibold"> ${rid}</strong></span>
      <span class="cf-footer-separator sm:hidden">&bull;</span>
      <span id="cf-footer-item-ip" class="cf-footer-item hidden sm:block sm:mb-1">
        Your IP:
        <button type="button" id="cf-footer-ip-reveal" class="cf-footer-ip-reveal-btn">Click to reveal</button>
        <span class="hidden" id="cf-footer-ip">${ip}</span>
        <span class="cf-footer-separator sm:hidden">&bull;</span>
      </span>
      <span class="cf-footer-item sm:block sm:mb-1"><span>Performance &amp; security by</span> <a rel="noopener noreferrer" href="https://www.cloudflare.com/5xx-error-landing" id="brand_link" target="_blank">Cloudflare</a></span>
    </p>
    <script>(function(){function d(){var b=a.getElementById("cf-footer-item-ip"),c=a.getElementById("cf-footer-ip-reveal");b&&"classList"in b&&(b.classList.remove("hidden"),c.addEventListener("click",function(){c.classList.add("hidden");a.getElementById("cf-footer-ip").classList.remove("hidden")}))}var a=document;document.addEventListener&&a.addEventListener("DOMContentLoaded",d)})();</script>
  </div>

</div>
    </div>
     <script>
    window._cf_translation = {};
  </script>
</body>
</html>`;
}


// ====== src/admin/cloudflare.js ======
// admin/cloudflare.js — Cloudflare API 用量查询
// 功能：调用 Cloudflare API 查询所有 zone 的 Spectrum 事件统计
// 支持三种认证方式：API Token、Global API Key + Email、UsageAPI

/**
 * 查询 Cloudflare 账户的 Spectrum 用量统计
 * @param {string} email - Cloudflare 邮箱
 * @param {string} globalAPIKey - Global API Key
 * @param {string} accountID - 账户 ID
 * @param {string} apiToken - API Token
 * @returns {Promise<{success:boolean, pages?:number, workers?:number, total?:number, max?:number, error?:string}>}
 */
async function getCloudflareUsage(email, globalAPIKey, accountID, apiToken) {
  const API = 'https://api.cloudflare.com/client/v4';
  const headers = { 'Content-Type': 'application/json' };

  // 认证策略：优先 API Token，其次 Global Key + Email
  if (apiToken) {
    headers['Authorization'] = 'Bearer ' + apiToken;
  } else if (email && globalAPIKey) {
    headers['X-Auth-Email'] = email;
    headers['X-Auth-Key'] = globalAPIKey;
  } else {
    return { success: false, error: '缺少认证信息（需要 Email+GlobalAPIKey 或 APIToken）' };
  }

  try {
    // 第一步：获取所有 zone
    const zonesRes = await fetch(API + '/zones?per_page=50', { headers });
    const zonesData = await zonesRes.json();
    if (!zonesData.success) {
      return { success: false, error: zonesData.errors?.[0]?.message || '获取 zone 列表失败' };
    }

    const zones = zonesData.result;
    if (!zones || zones.length === 0) {
      return { success: true, pages: 0, workers: 0, total: 0, max: 100000 };
    }

    // 第二步：并发查询所有 zone 的 spectrum analytics
    const since = '2024-01-01T00:00:00Z';
    const until = '2099-12-31T23:59:59Z';
    const sumRequests = (dataArray) =>
      (dataArray || []).reduce((total, item) => total + (item?.sum?.requests || 0), 0);

    const results = await Promise.all(
      zones.map(zone =>
        fetch(
          API + '/zones/' + zone.id + '/spectrum/analytics/events/summary?since=' + since + '&until=' + until,
          { headers }
        )
          .then(r => r.json())
          .then(data => (data.success ? sumRequests(data.result?.data) : 0))
          .catch(() => 0)
      )
    );

    const total = results.reduce((a, b) => a + b, 0);
    return {
      success: true,
      pages: total,
      workers: 0,
      total,
      max: 100000,
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ====== src/admin/proxy-check.js ======
// admin/proxy-check.js — 代理连通性检测（admin/check 端点）
//
// 功能：检测 socks5/http/https/turn/sstp 代理是否可用
// 通过代理建立到 cloudflare.com:443 的 TLS 连接，GET /cdn-cgi/trace
// 返回 { success, proxy, ip, loc, responseTime }
//
// 依赖：
//   - ../proxy/socks5.js  → socks5Connect
//   - ../proxy/http.js    → httpConnect, httpsConnect
//   - ../proxy/turn.js    → turnConnect, sstpConnect
//   - ../tls.js           → TlsClient
//   - 拼接字节数据 (utils.js concatBytes)
//   - 获取代理默认端口 (context.js DEFAULT_PROXY_PORTS)
//   - 获取SOCKS5账号 (proxy/proxy-config.js parseProxyAddress)


const CHECK_HOST = 'cloudflare.com';
const CHECK_PORT = 443;
const MAX_RESPONSE_BYTES = 64 * 1024;

async function proxyCheck(request, proxyProtocol, proxyParam) {
  const startTime = Date.now();
  const parsed = await parseProxyAddress(proxyParam, DEFAULT_PROXY_PORTS[proxyProtocol]);
  const { username, password, hostname, port } = parsed;
  const fullProxy = username && password ? `${username}:${password}@${hostname}:${port}` : `${hostname}:${port}`;

  try {
    const tcpConnector = createTCPConnector(request);
    let tcpSocket = null, tlsSocket = null;

    try {
      // 根据 proxyProtocol 选择对应的连接函数
      tcpSocket = proxyProtocol === 'socks5'
        ? await socks5Connect(CHECK_HOST, CHECK_PORT, new Uint8Array(0), parsed, tcpConnector)
        : proxyProtocol === 'turn'
          ? await turnConnect(parsed, CHECK_HOST, CHECK_PORT, tcpConnector)
          : proxyProtocol === 'sstp'
            ? await sstpConnect(parsed, CHECK_HOST, CHECK_PORT, tcpConnector)
            : proxyProtocol === 'https'
              ? await httpsConnect(CHECK_HOST, CHECK_PORT, new Uint8Array(0), parsed, tcpConnector)
              : await httpConnect(CHECK_HOST, CHECK_PORT, new Uint8Array(0), parsed, tcpConnector, false);

      if (!tcpSocket) throw new Error('无法连接到代理服务器');

      tlsSocket = new TlsClient(tcpSocket, { serverName: CHECK_HOST, insecure: true });
      await tlsSocket.handshake();
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();

      await tlsSocket.write(encoder.encode(`GET /cdn-cgi/trace HTTP/1.1\r\nHost: ${CHECK_HOST}\r\nUser-Agent: Mozilla/5.0\r\nConnection: close\r\n\r\n`));

      let responseBuffer = new Uint8Array(0);
      let headerEnd = -1;
      let contentLength = null;
      let chunked = false;

      while (responseBuffer.length < MAX_RESPONSE_BYTES) {
        const value = await tlsSocket.read();
        if (!value) break;
        if (value.byteLength === 0) continue;
        responseBuffer = concatBytes(responseBuffer, value);

        if (headerEnd === -1) {
          const crlfcrlf = responseBuffer.findIndex((_, i) =>
            i < responseBuffer.length - 3 &&
            responseBuffer[i] === 0x0d && responseBuffer[i + 1] === 0x0a &&
            responseBuffer[i + 2] === 0x0d && responseBuffer[i + 3] === 0x0a
          );
          if (crlfcrlf !== -1) {
            headerEnd = crlfcrlf + 4;
            const headers = decoder.decode(responseBuffer.slice(0, headerEnd));
            const statusLine = headers.split('\r\n')[0] || '';
            const statusMatch = statusLine.match(/HTTP\/\d\.\d\s+(\d+)/);
            const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : NaN;
            if (!Number.isFinite(statusCode) || statusCode < 200 || statusCode >= 300) {
              throw new Error(`代理检测请求失败: ${statusLine || '无效响应'}`);
            }
            const lengthMatch = headers.match(/\r\nContent-Length:\s*(\d+)/i);
            if (lengthMatch) contentLength = parseInt(lengthMatch[1], 10);
            chunked = /\r\nTransfer-Encoding:\s*chunked/i.test(headers);
          }
        }
        if (headerEnd !== -1 && contentLength !== null && responseBuffer.length >= headerEnd + contentLength) break;
        if (headerEnd !== -1 && chunked && decoder.decode(responseBuffer).includes('\r\n0\r\n\r\n')) break;
      }

      if (headerEnd === -1) throw new Error('代理检测响应头过长或无效');

      const response = decoder.decode(responseBuffer);
      const ip = response.match(/(?:^|\n)ip=(.*)/)?.[1];
      const loc = response.match(/(?:^|\n)loc=(.*)/)?.[1];
      if (!ip || !loc) throw new Error('代理检测响应无效');

      return { success: true, proxy: proxyProtocol + '://' + fullProxy, ip, loc, responseTime: Date.now() - startTime };
    } finally {
      try { tlsSocket ? tlsSocket.close() : await tcpSocket?.close?.(); } catch (e) { }
    }
  } catch (error) {
    return { success: false, error: error.message, proxy: proxyProtocol + '://' + fullProxy, responseTime: Date.now() - startTime };
  }
}

// 创建 TCP 连接器（对齐原版）
function createTCPConnector(request) {
  const fetcher = request?.fetcher;
  if (!fetcher || typeof fetcher.connect !== 'function') {
    throw new Error('request.fetcher.connect unavailable');
  }
  return (opts, extra) => fetcher.connect(opts, extra);
}

// ====== src/admin/telegram.js ======
// admin/telegram.js — Telegram 通知配置管理 & 消息发送
// 功能：保存/读取 tg.json 配置，通过 Telegram Bot API 发送通知

/**
 * 保存 Telegram 配置到 KV
 * @param {object} env - Cloudflare env
 * @param {object} newConfig - { BotToken, ChatID, init? }
 */
async function saveTgConfig(env, newConfig) {
  if (newConfig.init && newConfig.init === true) {
    await env.KV.put('tg.json', JSON.stringify({ BotToken: null, ChatID: null }, null, 2));
  } else {
    if (!newConfig.BotToken || !newConfig.ChatID) {
      throw new Error('配置不完整：需要 BotToken 和 ChatID');
    }
    await env.KV.put('tg.json', JSON.stringify(newConfig, null, 2));
  }
}

/**
 * 发送 Telegram 通知
 * @param {object} env - Cloudflare env
 * @param {string} message - 通知内容（支持 Markdown）
 * @returns {Promise<boolean>} 是否发送成功
 */
async function sendTelegramNotification(env, message) {
  try {
    const tgRaw = await env.KV.get('tg.json');
    if (!tgRaw) return false;

    const tg = JSON.parse(tgRaw);
    if (!tg.BotToken || !tg.ChatID) return false;

    const apiUrl = `https://api.telegram.org/bot${tg.BotToken}/sendMessage`;
    const body = JSON.stringify({
      chat_id: tg.ChatID,
      text: message,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    });

    const resp = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    const result = await resp.json();
    return result.ok === true;
  } catch (_) {
    return false;
  }
}

// ====== src/subscription/preferred-ip.js ======
// subscription/preferred-ip.js — 优选IP生成 & 优选API请求
// 功能：本地随机IP生成、远程优选API请求、反代IP轮询
// 按照运营商(ct/cu/cmcc/cf)从远程IP库获取并随机选择


// 运营商远程IP库基础URL
const ISP_IP_BASE = 'https://raw.githubusercontent.com/' + FINGERPRINT_DICT[1] + '/cf-cdn-ip/refs/heads/master/';

/**
 * 从远程运营商IP库生成随机优选IP
 * @param {Request} request - Cloudflare Worker request
 * @param {number} count - 生成的IP数量，默认16
 * @param {number} port - 指定端口，-1表示使用默认端口
 * @returns {Promise<[string, string]>} [ipv4列表(换行分隔), ipv6列表(换行分隔)]
 */
async function generateRandomIP(request, count = 16, port = -1) {
  const url = new URL(request.url);
  const ispParam = String(url.searchParams.get('cnIspCode') || '').toLowerCase();
  const isp = (['ct', 'cu', 'cmcc', 'cf'].includes(ispParam) ? ispParam : null) || detectISP(request) || 'cf';

  const portStr = port > 0 ? ':' + port : '';

  try {
    // 并发获取 IPv4 和 IPv6 列表
    const [v4Resp, v6Resp] = await Promise.all([
      fetch(ISP_IP_BASE + isp + '.txt').catch(() => null),
      fetch(ISP_IP_BASE + isp + '6.txt').catch(() => null),
    ]);

    const v4Text = v4Resp?.ok ? await v4Resp.text() : '';
    const v6Text = v6Resp?.ok ? await v6Resp.text() : '';

    const v4Lines = v4Text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    const v6Lines = v6Text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));

    const pickRandom = (arr, n) => {
      const shuffled = [...arr].sort(() => Math.random() - 0.5);
      return shuffled.slice(0, n).map(ip => ip + portStr);
    };

    const v4Result = pickRandom(v4Lines, count).join('\n');
    const v6Result = pickRandom(v6Lines, count).join('\n');

    return [v4Result, v6Result];
  } catch (_) {
    return ['', ''];
  }
}

/**
 * 请求远程优选API获取测速后的IP列表
 * @param {string[]} urls - 优选API的URL列表
 * @param {string} port - 默认端口
 * @param {number} timeout - 超时毫秒
 * @returns {Promise<[string[], string[], string[], string[]]>}
 *   [IPv4列表, IPv6列表, 反代IP池, 订阅链接明文LINK]
 */
async function requestPreferredAPI(urls, port = '443', timeout = 3000) {
  if (!urls || urls.length === 0) return [[], [], [], []];

  const results = new Set();
  const proxyIPSet = new Set();
  let plainLinkContent = '';
  const subUrls = [];

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  const fetchPromises = urls.map(async (u) => {
    try {
      const resp = await fetch(u, { signal: controller.signal });
      const text = await resp.text();

      if (resp.headers.get('content-type')?.includes('text/plain') || text.includes('://')) {
        // 可能是订阅链接
        if (text.includes('://')) {
          subUrls.push(u);
          plainLinkContent += text + '\n';
        }
      }

      // 解析IP行（格式：ip:port#remark）
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        // 匹配 IP:端口 格式
        if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+/.test(trimmed)
            || /^\[?[0-9a-f:]+]?:\d+/i.test(trimmed)) {
          results.add(trimmed);
        }
        // 匹配反代IP格式
        if (trimmed.includes('.' + FINGERPRINT_DICT[1] + 'SsSs.nEt')) {
          proxyIPSet.add(trimmed);
        }
      }
    } catch (_) {
      // 单个URL失败不影响其他
    }
  });

  await Promise.allSettled(fetchPromises);
  clearTimeout(timeoutId);

  const all = [...results];
  const ipv4 = all.filter(ip => /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+/.test(ip));
  const ipv6 = all.filter(ip => ip.includes(':') && !ip.startsWith('[') && !/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(ip));

  return [ipv4, ipv6, [...proxyIPSet], subUrls];
}

/**
 * 获取下一个反代IP（轮询）
 * @param {object} ctx_ - 请求上下文
 * @returns {string}
 */
function getNextProxyIP(ctx_) {
  if (!ctx_.cachedProxyIPArray || ctx_.cachedProxyIPArray.length === 0) {
    return ctx_.proxyIP;
  }
  const ip = ctx_.cachedProxyIPArray[ctx_.cachedProxyIPIndex % ctx_.cachedProxyIPArray.length];
  ctx_.cachedProxyIPIndex = (ctx_.cachedProxyIPIndex + 1) % ctx_.cachedProxyIPArray.length;
  return ip;
}

// ====== src/stream/upstream-queue.js ======
// stream/upstream-queue.js — 上行写入队列（合包 + 背压 + 重试）
// 对应原文件: 创建上行写入队列 (行 2158-2340)


function createUpstreamQueue({ getWriter, releaseWriter, retryConnect, closeConnection, name = 'upstream' }) {
  let chunks = [];
  let head = 0;
  let queuedBytes = 0;
  let draining = false;
  let closed = false;
  let bundleBuffer = null;
  let idleResolvers = [];
  let activeCompletions = null;

  const settle = (completions, err = null) => {
    if (!completions) return;
    for (const c of completions) {
      if (err) c.reject(err);
      else c.resolve();
    }
  };

  const rejectQueued = (err) => {
    for (let i = head; i < chunks.length; i++) {
      if (chunks[i]?.completions) settle(chunks[i].completions, err);
    }
  };

  const compact = () => {
    if (head > 32 && head * 2 >= chunks.length) {
      chunks = chunks.slice(head);
      head = 0;
    }
  };

  const resolveIdle = () => {
    if (queuedBytes || draining || !idleResolvers.length) return;
    const rs = idleResolvers;
    idleResolvers = [];
    for (const r of rs) r();
  };

  const clear = (err = null) => {
    const closeErr = err || (closed ? new Error(`${name}: queue closed`) : null);
    if (closeErr) {
      rejectQueued(closeErr);
      settle(activeCompletions, closeErr);
      activeCompletions = null;
    }
    chunks = [];
    head = 0;
    queuedBytes = 0;
    resolveIdle();
  };

  const shift = () => {
    if (head >= chunks.length) return null;
    const item = chunks[head];
    chunks[head++] = undefined;
    queuedBytes -= item.chunk.byteLength;
    compact();
    return item;
  };

  const bundle = () => {
    const first = shift();
    if (!first) return null;
    if (head >= chunks.length || first.chunk.byteLength >= UPSTREAM_BUNDLE_TARGET) return first;

    let byteLen = first.chunk.byteLength;
    let end = head;
    let allowRetry = first.allowRetry;
    let completionList = first.completions || null;

    while (end < chunks.length) {
      const next = chunks[end];
      if (byteLen + next.chunk.byteLength > UPSTREAM_BUNDLE_TARGET) break;
      byteLen += next.chunk.byteLength;
      allowRetry = allowRetry && next.allowRetry;
      if (next.completions) completionList = completionList ? completionList.concat(next.completions) : next.completions;
      end++;
    }
    if (end === head) return first;

    const output = (bundleBuffer || (bundleBuffer = new Uint8Array(UPSTREAM_BUNDLE_TARGET)));
    output.set(first.chunk);
    let offset = first.chunk.byteLength;
    while (head < end) {
      const next = chunks[head];
      chunks[head++] = undefined;
      queuedBytes -= next.chunk.byteLength;
      output.set(next.chunk, offset);
      offset += next.chunk.byteLength;
    }
    compact();
    return { chunk: output.subarray(0, byteLen), allowRetry, completions: completionList };
  };

  const drain = async () => {
    if (draining || closed) return;
    draining = true;
    try {
      for (;;) {
        if (closed) break;
        const item = bundle();
        if (!item) break;
        let writer = getWriter();
        if (!writer) throw new Error(`${name}: remote writer unavailable`);
        const completions = item.completions || null;
        activeCompletions = completions;
        try {
          try {
            await writer.write(item.chunk);
          } catch (err) {
            releaseWriter?.();
            if (!item.allowRetry || typeof retryConnect !== 'function') throw err;
            await retryConnect();
            writer = getWriter();
            if (!writer) throw err;
            await writer.write(item.chunk);
          }
          settle(completions);
        } catch (err) {
          settle(completions, err);
          throw err;
        } finally {
          if (activeCompletions === completions) activeCompletions = null;
        }
      }
    } catch (err) {
      closed = true;
      clear(err);
      try { closeConnection?.(err); } catch (_) {}
    } finally {
      draining = false;
      if (!closed && head < chunks.length) queueMicrotask(drain);
      else resolveIdle();
    }
  };

  const enqueue = (data, allowRetry = true, waitForFlush = false) => {
    if (closed) return false;
    if (!getWriter()) return false;
    const chunk = toBytes(data);
    if (!chunk.byteLength) return true;
    const nextBytes = queuedBytes + chunk.byteLength;
    const nextItems = chunks.length - head + 1;
    if (nextBytes > UPSTREAM_QUEUE_MAX_BYTES || nextItems > UPSTREAM_QUEUE_MAX_ITEMS) {
      closed = true;
      const err = Object.assign(new Error(`${name}: overflow (${nextBytes}B/${nextItems})`), { isQueueOverflow: true });
      clear(err);
      try { closeConnection?.(err); } catch (_) {}
      throw err;
    }
    let completionPromise = null;
    let completions = null;
    if (waitForFlush) {
      completions = [];
      completionPromise = new Promise((resolve, reject) => completions.push({ resolve, reject }));
    }
    chunks.push({ chunk, allowRetry, completions });
    queuedBytes = nextBytes;
    if (!draining) queueMicrotask(drain);
    return waitForFlush ? completionPromise.then(() => true) : true;
  };

  return {
    write(data, allowRetry = true) { return enqueue(data, allowRetry, false); },
    writeAndWait(data, allowRetry = true) { return enqueue(data, allowRetry, true); },
    async waitEmpty() { if (!queuedBytes && !draining) return; await new Promise(r => idleResolvers.push(r)); },
    clear() { closed = true; clear(); },
  };
}

// ====== src/protocol/trojan.js ======
// protocol/trojan.js — Trojan 协议解析
// 对应原文件: 解析木马请求 (行 1561-1625) + tryParseTrojanFirstPacket


const TROJAN_DECODER = new TextDecoder();

function parseTrojan(buffer, passwordPlainText) {
  const data = toBytes(buffer);
  const sha224Password = sha224str(passwordPlainText);
  if (data.byteLength < 58) return { hasError: true, message: 'invalid data' };
  const crLfIndex = 56;
  if (data[crLfIndex] !== 0x0d || data[crLfIndex + 1] !== 0x0a) return { hasError: true, message: 'invalid header format' };
  for (let i = 0; i < crLfIndex; i++) {
    if (data[i] !== sha224Password.charCodeAt(i)) return { hasError: true, message: 'invalid password' };
  }
  const socks5Index = crLfIndex + 2;
  if (data.byteLength < socks5Index + 6) return { hasError: true, message: 'invalid S5 request data' };
  const cmd = data[socks5Index];
  if (cmd !== 1 && cmd !== 3) return { hasError: true, message: 'unsupported command, only TCP/UDP is allowed' };
  const isUDP = cmd === 3;
  const atype = data[socks5Index + 1];
  let addrLen = 0, addrIdx = socks5Index + 2, address = '';
  switch (atype) {
    case 1: addrLen = 4; if (data.byteLength < addrIdx + addrLen + 4) return { hasError: true, message: 'invalid S5 request data' }; address = `${data[addrIdx]}.${data[addrIdx+1]}.${data[addrIdx+2]}.${data[addrIdx+3]}`; break;
    case 3: if (data.byteLength < addrIdx + 1) return { hasError: true, message: 'invalid S5 request data' }; addrLen = data[addrIdx]; addrIdx += 1; if (data.byteLength < addrIdx + addrLen + 4) return { hasError: true, message: 'invalid S5 request data' }; address = TROJAN_DECODER.decode(data.subarray(addrIdx, addrIdx + addrLen)); break;
    case 4: addrLen = 16; if (data.byteLength < addrIdx + addrLen + 4) return { hasError: true, message: 'invalid S5 request data' }; const ipv6 = []; for (let i = 0; i < 8; i++) { const pi = addrIdx + i * 2; ipv6.push(((data[pi] << 8) | data[pi + 1]).toString(16)); } address = ipv6.join(':'); break;
    default: return { hasError: true, message: `invalid addressType is ${atype}` };
  }
  if (!address) return { hasError: true, message: `address is empty, addressType is ${atype}` };
  const portIdx = addrIdx + addrLen;
  if (data.byteLength < portIdx + 4) return { hasError: true, message: 'invalid S5 request data' };
  const port = (data[portIdx] << 8) | data[portIdx + 1];
  return { hasError: false, addressType: atype, port, hostname: address, isUDP, rawClientData: data.subarray(portIdx + 4) };
}

function tryParseTrojanFirstPacket(data, token) {
  const passwordHash = sha224str(token);
  const passwordBytes = new TextEncoder().encode(passwordHash);
  const length = data.byteLength;
  if (length < 58) return { 状态: 'need_more' };
  if (data[56] !== 0x0d || data[57] !== 0x0a) return { 状态: 'invalid' };
  for (let i = 0; i < 56; i++) { if (data[i] !== passwordBytes[i]) return { 状态: 'invalid' }; }
  const socksStart = 58;
  if (length < socksStart + 2) return { 状态: 'need_more' };
  const cmd = data[socksStart];
  if (cmd !== 1 && cmd !== 3) return { 状态: 'invalid' };
  const isUDP = cmd === 3;
  const atype = data[socksStart + 1];
  let cursor = socksStart + 2, hostname = '';
  if (atype === 1) { if (length < cursor + 4) return { 状态: 'need_more' }; hostname = `${data[cursor]}.${data[cursor+1]}.${data[cursor+2]}.${data[cursor+3]}`; cursor += 4; }
  else if (atype === 3) { if (length < cursor + 1) return { 状态: 'need_more' }; const dl = data[cursor]; if (length < cursor + 1 + dl) return { 状态: 'need_more' }; hostname = TROJAN_DECODER.decode(data.subarray(cursor + 1, cursor + 1 + dl)); cursor += 1 + dl; }
  else if (atype === 4) { if (length < cursor + 16) return { 状态: 'need_more' }; const ipv6 = []; for (let i = 0; i < 8; i++) { const base = cursor + i * 2; ipv6.push(((data[base] << 8) | data[base + 1]).toString(16)); } hostname = ipv6.join(':'); cursor += 16; }
  else return { 状态: 'invalid' };
  if (!hostname) return { 状态: 'invalid' };
  if (length < cursor + 4) return { 状态: 'need_more' };
  const port = (data[cursor] << 8) | data[cursor + 1];
  if (data[cursor+2] !== 0x0d || data[cursor+3] !== 0x0a) return { 状态: 'invalid' };
  return { 状态: 'ok', 结果: { 协议: 'trojan', hostname, port, isUDP, rawData: data.subarray(cursor + 4), respHeader: null } };
}

// --- Trojan UDP 转发（原版提取） ---


async function forwardTrojanUDP(chunk, webSocket, context, request) {
  const current = toBytesRaw(chunk);
  const cache = context?.cache instanceof Uint8Array ? context.cache : new Uint8Array(0);
  const input = cache.byteLength ? concatBytes(cache, current) : current;
  let cursor = 0;
  while (cursor < input.byteLength) {
    const packetStart = cursor;
    const atype = input[cursor];
    let addrCursor = cursor + 1;
    let addrLen = 0;
    if (atype === 1) addrLen = 4;
    else if (atype === 4) addrLen = 16;
    else if (atype === 3) {
      if (input.byteLength < addrCursor + 1) break;
      addrLen = 1 + input[addrCursor];
    } else throw new Error(`invalid trojan udp addressType: ${atype}`);
    const portCursor = addrCursor + addrLen;
    if (input.byteLength < portCursor + 6) break;
    const port = (input[portCursor] << 8) | input[portCursor + 1];
    const payloadLength = (input[portCursor + 2] << 8) | input[portCursor + 3];
    if (input[portCursor + 4] !== 0x0d || input[portCursor + 5] !== 0x0a) throw new Error('invalid trojan udp delimiter');
    const payloadStart = portCursor + 6;
    const payloadEnd = payloadStart + payloadLength;
    if (input.byteLength < payloadEnd) break;
    const addrPortHeader = input.slice(packetStart, portCursor + 2);
    const payload = input.slice(payloadStart, payloadEnd);
    cursor = payloadEnd;
    if (port !== 53) throw new Error('UDP is not supported');
    if (!payload.byteLength) continue;
    let tcpDNSQuery = payload;
    if (payload.byteLength < 2 || ((payload[0] << 8) | payload[1]) !== payload.byteLength - 2) {
      tcpDNSQuery = new Uint8Array(payload.byteLength + 2);
      tcpDNSQuery[0] = (payload.byteLength >>> 8) & 0xff;
      tcpDNSQuery[1] = payload.byteLength & 0xff;
      tcpDNSQuery.set(payload, 2);
    }
    const dnsRespCtx = { cache: new Uint8Array(0) };
    await forwardataudp(tcpDNSQuery, webSocket, null, request, (dnsRespChunk) => {
      const respBlock = toBytesRaw(dnsRespChunk);
      const respInput = dnsRespCtx.cache.byteLength ? concatBytes(dnsRespCtx.cache, respBlock) : respBlock;
      const respFrames = [];
      let respCursor = 0;
      while (respCursor + 2 <= respInput.byteLength) {
        const dnsLen = (respInput[respCursor] << 8) | respInput[respCursor + 1];
        const dnsStart = respCursor + 2;
        const dnsEnd = dnsStart + dnsLen;
        if (dnsEnd > respInput.byteLength) break;
        const dnsPayload = respInput.slice(dnsStart, dnsEnd);
        const frame = new Uint8Array(addrPortHeader.byteLength + 4 + dnsPayload.byteLength);
        frame.set(addrPortHeader, 0);
        frame[addrPortHeader.byteLength] = (dnsPayload.byteLength >>> 8) & 0xff;
        frame[addrPortHeader.byteLength + 1] = dnsPayload.byteLength & 0xff;
        frame[addrPortHeader.byteLength + 2] = 0x0d;
        frame[addrPortHeader.byteLength + 3] = 0x0a;
        frame.set(dnsPayload, addrPortHeader.byteLength + 4);
        respFrames.push(frame);
        respCursor = dnsEnd;
      }
      dnsRespCtx.cache = respInput.slice(respCursor);
      return respFrames.length ? respFrames : new Uint8Array(0);
    });
  }
  if (context) context.cache = input.slice(cursor);
}

// ====== src/protocol/vless.js ======
// ============================================================
// protocol/vless.js — VLESS 协议解析
// 对应原文件: 解析魏烈思请求 (行 1667-1715)
// ============================================================


const VLESS_DECODER = new TextDecoder();

/**
 * 解析 VLESS 请求首包
 * @param {Uint8Array|ArrayBuffer} chunk - 原始数据
 * @param {string} token - UUID 用于验证
 * @returns {{ hasError: boolean, message?: string, addressType?: number, port?: number, hostname?: string, isUDP?: boolean, rawClientData?: Uint8Array, version?: number }}
 */
function parseVLESS(chunk, token) {
  const data = toBytes(chunk);
  const length = data.byteLength;

  if (length < 24) return { hasError: true, message: 'Invalid data' };

  const version = data[0];
  if (!uuidBytesMatch(data, 1, token)) return { hasError: true, message: 'Invalid uuid' };

  const optLen = data[17];
  const cmdIndex = 18 + optLen;
  if (length < cmdIndex + 4) return { hasError: true, message: 'Invalid data' };

  const cmd = data[cmdIndex];
  let isUDP = false;
  if (cmd === 1) {
    // TCP
  } else if (cmd === 2) {
    isUDP = true;
  } else {
    return { hasError: true, message: 'Invalid command' };
  }

  const portIdx = cmdIndex + 1;
  const port = (data[portIdx] << 8) | data[portIdx + 1];
  let addrValIdx = portIdx + 3;
  let addrLen = 0;
  let hostname = '';
  const addressType = data[portIdx + 2];

  switch (addressType) {
    case 1: // IPv4
      addrLen = 4;
      if (length < addrValIdx + addrLen) return { hasError: true, message: 'Invalid IPv4 address length' };
      hostname = `${data[addrValIdx]}.${data[addrValIdx + 1]}.${data[addrValIdx + 2]}.${data[addrValIdx + 3]}`;
      break;
    case 2: // Domain
      if (length < addrValIdx + 1) return { hasError: true, message: 'Invalid domain length' };
      addrLen = data[addrValIdx];
      addrValIdx += 1;
      if (length < addrValIdx + addrLen) return { hasError: true, message: 'Invalid domain data' };
      hostname = VLESS_DECODER.decode(data.subarray(addrValIdx, addrValIdx + addrLen));
      break;
    case 3: // IPv6
      addrLen = 16;
      if (length < addrValIdx + addrLen) return { hasError: true, message: 'Invalid IPv6 address length' };
      const ipv6 = [];
      for (let i = 0; i < 8; i++) {
        const base = addrValIdx + i * 2;
        ipv6.push(((data[base] << 8) | data[base + 1]).toString(16));
      }
      hostname = ipv6.join(':');
      break;
    default:
      return { hasError: true, message: `Invalid address type: ${addressType}` };
  }

  if (!hostname) return { hasError: true, message: `Invalid address: ${addressType}` };

  const rawIndex = addrValIdx + addrLen;
  return {
    hasError: false,
    addressType,
    port,
    hostname,
    isUDP,
    rawClientData: data.subarray(rawIndex),
    version,
  };
}

/**
 * 尝试从 buffer 解析 VLESS 首包（用于 XHTTP 首包读取场景）
 * 返回 { 状态: 'ok'|'invalid'|'need_more', 结果? }
 */
function tryParseVLESSFirstPacket(data, token) {
  const length = data.byteLength;
  if (length < 18) return { 状态: 'need_more' };
  if (!uuidBytesMatch(data, 1, token)) return { 状态: 'invalid' };

  const optLen = data[17];
  const cmdIndex = 18 + optLen;
  if (length < cmdIndex + 1) return { 状态: 'need_more' };

  const cmd = data[cmdIndex];
  if (cmd !== 1 && cmd !== 2) return { 状态: 'invalid' };

  const portIndex = cmdIndex + 1;
  if (length < portIndex + 3) return { 状态: 'need_more' };

  const port = (data[portIndex] << 8) | data[portIndex + 1];
  const addressType = data[portIndex + 2];
  const addressIndex = portIndex + 3;
  let headerLen = -1;
  let hostname = '';

  if (addressType === 1) {
    if (length < addressIndex + 4) return { 状态: 'need_more' };
    hostname = `${data[addressIndex]}.${data[addressIndex + 1]}.${data[addressIndex + 2]}.${data[addressIndex + 3]}`;
    headerLen = addressIndex + 4;
  } else if (addressType === 2) {
    if (length < addressIndex + 1) return { 状态: 'need_more' };
    const domainLen = data[addressIndex];
    if (length < addressIndex + 1 + domainLen) return { 状态: 'need_more' };
    hostname = VLESS_DECODER.decode(data.subarray(addressIndex + 1, addressIndex + 1 + domainLen));
    headerLen = addressIndex + 1 + domainLen;
  } else if (addressType === 3) {
    if (length < addressIndex + 16) return { 状态: 'need_more' };
    const ipv6 = [];
    for (let i = 0; i < 8; i++) {
      const base = addressIndex + i * 2;
      ipv6.push(((data[base] << 8) | data[base + 1]).toString(16));
    }
    hostname = ipv6.join(':');
    headerLen = addressIndex + 16;
  } else return { 状态: 'invalid' };

  if (!hostname) return { 状态: 'invalid' };

  return {
    状态: 'ok',
    结果: {
      协议: 'vless',
      hostname,
      port,
      isUDP: cmd === 2,
      rawData: data.subarray(headerLen),
      respHeader: new Uint8Array([data[0], 0]),
    },
  };
}

// ====== src/proxy/forward.js ======
// proxy/forward.js — TCP/UDP forwarding + connection helpers

// ---- TCP forwarding ----

async function forwardataTCP(host, portNum, rawData, ws, respHeader, remoteConnWrapper, yourUUID, request) {
  log(true, `[TCP] forwarding to ${host}:${portNum}`);
  const req = /** @type {any} */ (request);
  const fetcher = req?.fetcher;
  if (!fetcher || typeof fetcher.connect !== 'function') {
    throw new Error('request.fetcher.connect unavailable');
  }

  const tcpConnect = (/** @type {any} */ opts) => fetcher.connect(opts);

  /** Open a TCP connection and wait for it to be ready */
  async function openTCP(address, port) {
    const sock = tcpConnect({ hostname: address, port });
    await sock.opened;
    return sock;
  }

  /** Write initial data to the socket */
  async function writeFirstPacket(sock, data) {
    if (dataLength(data) <= 0) return;
    const writer = sock.writable.getWriter();
    try { await writer.write(toBytes(data)); }
    finally { try { writer.releaseLock(); } catch (_) {} }
  }

  async function doConnect() {
    let sock = null;
    try {
      sock = await openTCP(host, portNum);
      await writeFirstPacket(sock, rawData);
      remoteConnWrapper.socket = sock;
      // connectStreams bridges socket.readable → ws.send (via grainSender)
      // retryFunc is called if stream ends with zero data transferred
      connectStreams(sock, ws, respHeader, async () => {
        if (remoteConnWrapper.socket !== sock) return;
        log(true, `[TCP] zero-data stream ended, triggering retry`);
        await doConnect();
      });
    } catch (err) {
      log(true, `[TCP] connect to ${host}:${portNum} failed: ${err?.message || err}`);
      try { sock?.close?.(); } catch (_) {}
      throw err;
    }
  }

  remoteConnWrapper.retryConnect = async () => {
    log(true, `[TCP] retrying connection to ${host}:${portNum}`);
    await doConnect();
  };

  await doConnect();
}

// ---- UDP (DNS) forwarding ----

async function forwardataudp(udpChunk, webSocket, respHeader, request, responseWrapper = null) {
  const data = toBytes(udpChunk);
  const byteLen = data.byteLength;
  log(true, `[UDP] DNS request: ${byteLen}B -> 8.8.4.4:53`);

  try {
    const req = /** @type {any} */ (request);
    const fetcher = req?.fetcher;
    if (!fetcher?.connect) throw new Error('fetcher.connect unavailable');

    const tcpSocket = fetcher.connect({ hostname: '8.8.4.4', port: 53 });
    let vlessHeader = respHeader;
    const writer = tcpSocket.writable.getWriter();
    await writer.write(data);
    log(true, `[UDP] DNS request written: ${byteLen}B`);
    writer.releaseLock();

    await tcpSocket.readable.pipeTo(new WritableStream({
      async write(chunk) {
        const response = toBytes(chunk);
        log(true, `[UDP] DNS response: ${response.byteLength}B`);
        if (webSocket.readyState !== WebSocket.OPEN) return;
        // Allow caller to transform the response (used by Trojan UDP)
        const fragments = responseWrapper ? await responseWrapper(response) : response;
        const frames = Array.isArray(fragments) ? fragments : [fragments];
        for (const fragment of frames) {
          const frag = toBytes(fragment);
          if (!frag.byteLength) continue;
          if (vlessHeader) {
            const combined = new Uint8Array(vlessHeader.length + frag.byteLength);
            combined.set(vlessHeader, 0);
            combined.set(frag, vlessHeader.length);
            await wsSend(webSocket, combined.buffer);
            vlessHeader = null;
          } else {
            await wsSend(webSocket, frag);
          }
        }
      },
    }));
  } catch (error) {
    log(true, `[UDP] DNS forward failed: ${error?.message || error}`);
  }
}

// ---- Speed test detection ----

function isSpeedTestSite(hostname) {
  const domains = [atob('c3BlZWQuY2xvdWRmbGFyZS5jb20=')];
  if (domains.includes(hostname)) return true;
  for (const domain of domains) {
    if (hostname.endsWith('.' + domain) || hostname === domain) return true;
  }
  return false;
}

// ====== src/protocol/shadowsocks.js ======
// protocol/shadowsocks.js — Shadowsocks AEAD 加解密
// 对应原文件: SS支持加密配置、SSAEAD加密/解密、SS派生主密钥/会话密钥、Nonce计数器 (行 1717-1869)


const SS_CIPHER_CONFIGS = {
  'aes-128-gcm': { method: 'aes-128-gcm', keyLen: 16, saltLen: 16, maxChunk: 0x3fff, aesLength: 128 },
  'aes-256-gcm': { method: 'aes-256-gcm', keyLen: 32, saltLen: 32, maxChunk: 0x3fff, aesLength: 256 },
};

const SS_TAG_LEN = 16;
const SS_NONCE_LEN = 12;
const SS_SUBKEY_INFO = new TextEncoder().encode('ss-subkey');
const SS_ENCODER = new TextEncoder();
const SS_KEY_CACHE = new Map();

function incrementNonce(counter) {
  for (let i = 0; i < counter.length; i++) {
    counter[i] = (counter[i] + 1) & 0xff;
    if (counter[i] !== 0) return;
  }
}

async function deriveMasterKey(passwordText, keyLen) {
  const cacheKey = `${keyLen}:${passwordText}`;
  if (SS_KEY_CACHE.has(cacheKey)) return SS_KEY_CACHE.get(cacheKey);
  const task = (async () => {
    const pwBytes = SS_ENCODER.encode(passwordText || '');
    let prev = new Uint8Array(0), result = new Uint8Array(0);
    while (result.byteLength < keyLen) {
      const input = new Uint8Array(prev.byteLength + pwBytes.byteLength);
      input.set(prev, 0); input.set(pwBytes, prev.byteLength);
      prev = new Uint8Array(await crypto.subtle.digest('MD5', input));
      result = concatBytes(result, prev);
    }
    return result.slice(0, keyLen);
  })();
  SS_KEY_CACHE.set(cacheKey, task);
  try { return await task; } catch (e) { SS_KEY_CACHE.delete(cacheKey); throw e; }
}

async function deriveSessionKey(config, masterKey, salt, usages) {
  const hmacOpts = { name: 'HMAC', hash: 'SHA-1' };
  const saltHmacKey = await crypto.subtle.importKey('raw', salt, hmacOpts, false, ['sign']);
  const prk = new Uint8Array(await crypto.subtle.sign('HMAC', saltHmacKey, masterKey));
  const prkHmacKey = await crypto.subtle.importKey('raw', prk, hmacOpts, false, ['sign']);
  const subKey = new Uint8Array(config.keyLen);
  let prev = new Uint8Array(0), written = 0, counter = 1;
  while (written < config.keyLen) {
    const input = concatBytes(prev, SS_SUBKEY_INFO, new Uint8Array([counter]));
    prev = new Uint8Array(await crypto.subtle.sign('HMAC', prkHmacKey, input));
    const copyLen = Math.min(prev.byteLength, config.keyLen - written);
    subKey.set(prev.subarray(0, copyLen), written);
    written += copyLen; counter += 1;
  }
  return crypto.subtle.importKey('raw', subKey, { name: 'AES-GCM', length: config.aesLength }, false, usages);
}

async function ssEncrypt(cryptoKey, nonceCounter, plaintext) {
  const iv = nonceCounter.slice();
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, cryptoKey, plaintext);
  incrementNonce(nonceCounter);
  return new Uint8Array(ct);
}

async function ssDecrypt(cryptoKey, nonceCounter, ciphertext) {
  const iv = nonceCounter.slice();
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, tagLength: 128 }, cryptoKey, ciphertext);
  incrementNonce(nonceCounter);
  return new Uint8Array(pt);
}

// ====== src/admin/config.js ======
// admin/config.js — KV 配置管理
//
// 提供 readConfigKV 函数，从 KV 读取/重置配置，合并默认值


async function readConfigKV(env, hostname, userID, UA, reset = false) {
  const defaults = {
    TIME: new Date().toISOString(),
    HOST: hostname,
    HOSTS: [hostname],
    UUID: userID,
    协议类型: 'vless',
    传输协议: 'ws',
    gRPC模式: 'gun',
    gRPCUserAgent: 'Mozilla/5.0',
    跳过证书验证: false,
    启用0RTT: true,
    TLS分片: 'Shadowrocket',
    随机路径: false,
    ECH: false,
    ECHConfig: { DNS: 'https://doh.cmliussss.net/CMLiussss', SNI: null },
    SS: { 加密方式: 'aes-128-gcm', TLS: true },
    Fingerprint: 'chrome',
    优选订阅生成: {
      local: true,
      本地IP库: { 随机IP: true, 随机数量: 16, 指定端口: -1 },
      SUB: null,
      SUBNAME: 'edgetunnel',
      SUBUpdateTime: 6,
      TOKEN: await md5md5(hostname + userID),
    },
    订阅转换配置: {
      SUBAPI: 'https://subapi.cmliussss.net',
      SUBCONFIG: 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/refs/heads/master/Clash/config/ACL4SSR_Online_Mini_MultiMode.ini',
      SUBEMOJI: false,
      SUBLIST: false,
    },
    CF: {
      Email: null,
      GlobalAPIKey: null,
      AccountID: null,
      APIToken: null,
      UsageAPI: null,
      Usage: { success: false },
    },
    PATH: '/',
    完整节点路径: '/?ed=2560',
    LINK: '',
    加载时间: '0ms',
  };

  if (reset) {
    if (env.KV?.put) await env.KV.put('config.json', JSON.stringify(defaults, null, 2));
    return defaults;
  }
  if (env.KV?.get) {
    try {
      const saved = await env.KV.get('config.json');
      if (saved) return { ...defaults, ...JSON.parse(saved) };
    } catch (_) {}
  }
  return defaults;
}

// ====== src/proxy/socks5.js ======
// proxy/socks5.js — SOCKS5 代理连接
// 对应原文件: socks5Connect (行 2502-2537)


async function socks5Connect(targetHost, targetPort, initialData, parsedAddress, createTCP) {
  const { username, password, hostname, port } = parsedAddress;
  const socket = createTCP({ hostname, port });
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();

  try {
    const authMethods = (username && password)
      ? new Uint8Array([0x05, 0x02, 0x00, 0x02])
      : new Uint8Array([0x05, 0x01, 0x00]);
    await writer.write(authMethods);

    let response = await reader.read();
    if (response.done || response.value.byteLength < 2) throw new Error('S5 method selection failed');

    const selectedMethod = new Uint8Array(response.value)[1];
    if (selectedMethod === 0x02) {
      if (!username || !password) throw new Error('S5 requires authentication');
      const userBytes = new TextEncoder().encode(username);
      const passBytes = new TextEncoder().encode(password);
      const authPacket = new Uint8Array([0x01, userBytes.length, ...userBytes, passBytes.length, ...passBytes]);
      await writer.write(authPacket);
      response = await reader.read();
      if (response.done || new Uint8Array(response.value)[1] !== 0x00) throw new Error('S5 authentication failed');
    } else if (selectedMethod !== 0x00) {
      throw new Error(`S5 unsupported auth method: ${selectedMethod}`);
    }

    const hostBytes = new TextEncoder().encode(targetHost);
    const connectPacket = new Uint8Array([
      0x05, 0x01, 0x00, 0x03,
      hostBytes.length, ...hostBytes,
      targetPort >> 8, targetPort & 0xff,
    ]);
    await writer.write(connectPacket);
    response = await reader.read();
    if (response.done || new Uint8Array(response.value)[1] !== 0x00) throw new Error('S5 connection failed');

    if (dataLength(initialData) > 0) await writer.write(initialData);
    writer.releaseLock();
    reader.releaseLock();
    return socket;
  } catch (error) {
    try { writer.releaseLock(); } catch (_) {}
    try { reader.releaseLock(); } catch (_) {}
    try { socket.close(); } catch (_) {}
    throw error;
  }
}

// ====== src/proxy/http.js ======
// proxy/http.js — HTTP/HTTPS 代理连接
// 对应原文件: httpConnect + httpsConnect (行 2539-2696)


async function httpConnect(targetHost, targetPort, initialData, parsedAddress, createTCP, isHTTPS = false) {
  const { username, password, hostname, port } = parsedAddress;
  const socket = isHTTPS
    ? createTCP({ hostname, port }, { secureTransport: 'on', allowHalfOpen: false })
    : createTCP({ hostname, port });
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  try {
    if (isHTTPS) await socket.opened;
    const auth = (username && password)
      ? `Proxy-Authorization: Basic ${btoa(`${username}:${password}`)}\r\n`
      : '';
    const request = `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n${auth}User-Agent: Mozilla/5.0\r\nConnection: keep-alive\r\n\r\n`;
    await writer.write(encoder.encode(request));
    writer.releaseLock();

    let respBuf = new Uint8Array(0), headerEnd = -1, bytesRead = 0;
    while (headerEnd === -1 && bytesRead < 8192) {
      const { done, value } = await reader.read();
      if (done || !value) throw new Error(`${isHTTPS ? 'HTTPS' : 'HTTP'} proxy closed before CONNECT response`);
      respBuf = new Uint8Array([...respBuf, ...value]);
      bytesRead = respBuf.length;
      const crlf = respBuf.findIndex((_, i) =>
        i < respBuf.length - 3 && respBuf[i] === 0x0d && respBuf[i + 1] === 0x0a && respBuf[i + 2] === 0x0d && respBuf[i + 3] === 0x0a);
      if (crlf !== -1) headerEnd = crlf + 4;
    }
    if (headerEnd === -1) throw new Error('Proxy CONNECT header too long');
    const statusLine = decoder.decode(respBuf.slice(0, headerEnd)).split('\r\n')[0];
    const statusCode = parseInt((statusLine.match(/HTTP\/\d\.\d\s+(\d+)/) || [])[1], 10);
    if (!Number.isFinite(statusCode) || statusCode < 200 || statusCode >= 300) throw new Error(`Connection failed: HTTP ${statusCode}`);

    reader.releaseLock();

    if (dataLength(initialData) > 0) {
      const w = socket.writable.getWriter();
      await w.write(initialData);
      w.releaseLock();
    }

    if (bytesRead > headerEnd) {
      const { readable, writable } = new TransformStream();
      const tw = writable.getWriter();
      await tw.write(respBuf.subarray(headerEnd, bytesRead));
      tw.releaseLock();
      socket.readable.pipeTo(writable).catch(() => {});
      return { readable, writable: socket.writable, closed: socket.closed, close: () => socket.close() };
    }
    return socket;
  } catch (error) {
    try { writer.releaseLock(); } catch (_) {}
    try { reader.releaseLock(); } catch (_) {}
    try { socket.close(); } catch (_) {}
    throw error;
  }
}

async function httpsConnect(targetHost, targetPort, initialData, parsedAddress, createTCP) {
  const { username, password, hostname, port } = parsedAddress;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let tlsSocket = null;
  const tlsServerName = isIPHostname(hostname) ? '' : stripIPv6Brackets(hostname);

  const openTLSToProxy = async (allowChacha = false) => {
    const proxySocket = createTCP({ hostname, port });
    try {
      await proxySocket.opened;
      const socket = new TlsClient(proxySocket, { serverName: tlsServerName, insecure: true, allowChacha });
      await socket.handshake();
      return socket;
    } catch (e) {
      try { proxySocket.close(); } catch (_) {}
      throw e;
    }
  };

  try {
    try { tlsSocket = await openTLSToProxy(false); }
    catch (e) {
      if (!/cipher|handshake|TLS Alert|ServerHello|Finished|Unsupported|Missing TLS/i.test(e?.message || `${e}`)) throw e;
      tlsSocket = await openTLSToProxy(true);
    }

    const auth = (username && password) ? `Proxy-Authorization: Basic ${btoa(`${username}:${password}`)}\r\n` : '';
    const request = `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n${auth}User-Agent: Mozilla/5.0\r\nConnection: keep-alive\r\n\r\n`;
    await tlsSocket.write(encoder.encode(request));

    let respBuf = new Uint8Array(0), headerEnd = -1, bytesRead = 0;
    while (headerEnd === -1 && bytesRead < 8192) {
      const value = await tlsSocket.read();
      if (!value) throw new Error('HTTPS proxy closed before CONNECT response');
      respBuf = concatBytes(respBuf, value);
      bytesRead = respBuf.length;
      const crlf = respBuf.findIndex((_, i) =>
        i < respBuf.length - 3 && respBuf[i] === 0x0d && respBuf[i + 1] === 0x0a && respBuf[i + 2] === 0x0d && respBuf[i + 3] === 0x0a);
      if (crlf !== -1) headerEnd = crlf + 4;
    }
    if (headerEnd === -1) throw new Error('HTTPS proxy CONNECT header too long');
    const statusLine = decoder.decode(respBuf.slice(0, headerEnd)).split('\r\n')[0];
    const statusCode = parseInt((statusLine.match(/HTTP\/\d\.\d\s+(\d+)/) || [])[1], 10);
    if (!Number.isFinite(statusCode) || statusCode < 200 || statusCode >= 300) throw new Error(`Connection failed: HTTP ${statusCode}`);

    if (dataLength(initialData) > 0) await tlsSocket.write(toBytes(initialData));
    const buffered = bytesRead > headerEnd ? respBuf.subarray(headerEnd, bytesRead) : null;

    let settled = false, resolveClosed, rejectClosed;
    const closed = new Promise((res, rej) => { resolveClosed = res; rejectClosed = rej; });
    const close = () => { try { tlsSocket.close(); } catch (_) {} if (!settled) { settled = true; resolveClosed(); } };

    const readable = new ReadableStream({
      async start(ctrl) {
        try {
          if (dataLength(buffered) > 0) ctrl.enqueue(buffered);
          while (true) {
            const val = await tlsSocket.read();
            if (!val) break;
            if (val.byteLength > 0) ctrl.enqueue(val);
          }
          ctrl.close();
          if (!settled) { settled = true; resolveClosed(); }
        } catch (err) {
          try { ctrl.error(err); } catch (_) {}
          if (!settled) { settled = true; rejectClosed(err); }
        }
      },
      cancel() { close(); }
    });
    const writable = new WritableStream({
      async write(chunk) { await tlsSocket.write(toBytes(chunk)); },
      close,
      abort(err) { close(); if (err && !settled) { settled = true; rejectClosed(err); } }
    });
    return { readable, writable, closed, close };
  } catch (error) {
    try { tlsSocket?.close(); } catch (_) {}
    throw error;
  }
}

// ====== src/proxy/turn.js ======
// proxy/turn.js — TURN + SSTP 代理连接（原版提取，行 3398-4101）

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

// DNS-over-HTTPS 查询（内联，供 turnConnect / sstpConnect 使用）
async function dohQuery(domain, type = 'A', server = 'https://cloudflare-dns.com/dns-query') {
  const url = `${server}?name=${encodeURIComponent(domain)}&type=${type}`;
  const resp = await fetch(url, { headers: { 'Accept': 'application/dns-json' } });
  if (!resp.ok) throw new Error(`DoH query failed: ${resp.status}`);
  const json = await resp.json();
  return (json.Answer || []).map(r => ({ type: r.type, data: r.data }));
}

const CONNECT_TIMEOUT_MS = 9999;
const TURN_STUN_MAGIC_COOKIE = new Uint8Array([0x21, 0x12, 0xa4, 0x42]);
const TURN_STUN_TYPE = {
	ALLOCATE_REQUEST: 0x0003, ALLOCATE_SUCCESS: 0x0103, ALLOCATE_ERROR: 0x0113,
	CREATE_PERMISSION_REQUEST: 0x0008, CREATE_PERMISSION_SUCCESS: 0x0108,
	CONNECT_REQUEST: 0x000a, CONNECT_SUCCESS: 0x010a,
	CONNECTION_BIND_REQUEST: 0x000b, CONNECTION_BIND_SUCCESS: 0x010b
};
const TURN_STUN_ATTR = {
	USERNAME: 0x0006, MESSAGE_INTEGRITY: 0x0008, ERROR_CODE: 0x0009,
	XOR_PEER_ADDRESS: 0x0012, REALM: 0x0014, NONCE: 0x0015,
	REQUESTED_TRANSPORT: 0x0019, CONNECTION_ID: 0x002a
};



function turnStunPadding(length) {
	return -length & 3;
}

function createTurnStunAttribute(type, value) {
	const body = toBytes(value);
	const attribute = new Uint8Array(4 + body.byteLength + turnStunPadding(body.byteLength));
	const view = new DataView(attribute.buffer);
	view.setUint16(0, type);
	view.setUint16(2, body.byteLength);
	attribute.set(body, 4);
	return attribute;
}

function createTurnStunMessage(type, transactionId, attributes) {
	const body = concatBytes(...attributes);
	const header = new Uint8Array(20);
	const view = new DataView(header.buffer);
	view.setUint16(0, type);
	view.setUint16(2, body.byteLength);
	header.set(TURN_STUN_MAGIC_COOKIE, 4);
	header.set(transactionId, 8);
	return concatBytes(header, body);
}

function parseTurnErrorCode(data) {
	return data?.byteLength >= 4 ? (data[2] & 7) * 100 + data[3] : 0;
}

function randomTurnTransactionId() {
	return crypto.getRandomValues(new Uint8Array(12));
}

async function addTurnMessageIntegrity(message, key) {
	const signedMessage = new Uint8Array(message);
	const view = new DataView(signedMessage.buffer);
	view.setUint16(2, view.getUint16(2) + 24);
	const hmacKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
	const signature = await crypto.subtle.sign('HMAC', hmacKey, signedMessage);
	return concatBytes(signedMessage, createTurnStunAttribute(TURN_STUN_ATTR.MESSAGE_INTEGRITY, new Uint8Array(signature)));
}

async function readTurnStunMessage(reader, bufferedData = null, timeoutMessage = 'TURN response timed out') {
	let buffer = dataLength(bufferedData) ? toBytes(bufferedData) : new Uint8Array(0);
	const pull = async () => {
		const { done, value } = await withTimeout(reader.read(), CONNECT_TIMEOUT_MS, timeoutMessage);
		if (done) throw new Error('TURN server closed connection');
		if (value?.byteLength) buffer = concatBytes(buffer, value);
	};
	while (buffer.byteLength < 20) await pull();

	const messageLength = 20 + ((buffer[2] << 8) | buffer[3]);
	if (messageLength > 65555) throw new Error('TURN response is too large');
	while (buffer.byteLength < messageLength) await pull();
	const messageBuffer = buffer.subarray(0, messageLength);
	if (TURN_STUN_MAGIC_COOKIE.some((value, index) => messageBuffer[4 + index] !== value)) throw new Error('Invalid TURN/STUN response');

	const view = new DataView(messageBuffer.buffer, messageBuffer.byteOffset, messageBuffer.byteLength);
	const attributes = {};
	for (let offset = 20; offset + 4 <= messageLength;) {
		const type = view.getUint16(offset);
		const length = view.getUint16(offset + 2);
		if (offset + 4 + length > messageBuffer.byteLength) break;
		attributes[type] = messageBuffer.slice(offset + 4, offset + 4 + length);
		offset += 4 + length + turnStunPadding(length);
	}
	return {
		message: { type: view.getUint16(0), attributes },
		extraData: buffer.byteLength > messageLength ? buffer.subarray(messageLength) : null
	};
}

async function writeTurnBytes(writer, bytes, timeoutMessage) {
	await withTimeout(writer.write(bytes), CONNECT_TIMEOUT_MS, timeoutMessage);
}

async function turnConnect(proxy, targetHost, targetPort, TCP连接) {
	proxy = { ...proxy, username: proxy.username ?? null, password: proxy.password ?? null };
	const resolvedTargetHost = stripIPv6Brackets(targetHost);
	/** @type {string | null} */
	let targetIp = isIPv4(resolvedTargetHost) ? resolvedTargetHost : null;
	if (!targetIp) {
		const records = await dohQuery(resolvedTargetHost, 'A');
		const recordData = records.find(item => item.type === 1 && isIPv4(item.data))?.data;
		targetIp = typeof recordData === 'string' ? recordData : null;
	}
	if (!targetIp) throw new Error(`Could not resolve ${targetHost} to an IPv4 address for TURN CONNECT`);

	const turnHost = stripIPv6Brackets(proxy.hostname);
	let controlSocket = null, dataSocket = null, controlWriter = null, controlReader = null, dataWriter = null, dataReader = null, dataReaderReleased = false;
	const close = () => {
		try { controlSocket?.close?.() } catch (e) { }
		try { dataSocket?.close?.() } catch (e) { }
	};
	const releaseDataReader = () => {
		if (dataReaderReleased) return;
		dataReaderReleased = true;
		try { dataReader?.releaseLock?.() } catch (e) { }
	};

	try {
		controlSocket = TCP连接({ hostname: turnHost, port: proxy.port });
		await withTimeout(controlSocket.opened, CONNECT_TIMEOUT_MS, 'TURN server connection timed out');
		controlWriter = controlSocket.writable.getWriter();
		controlReader = controlSocket.readable.getReader();

		const xorPeerAddress = new Uint8Array(8);
		xorPeerAddress[1] = 1;
		new DataView(xorPeerAddress.buffer).setUint16(2, targetPort ^ 0x2112);
		targetIp.split('.').forEach((value, index) => {
			xorPeerAddress[4 + index] = Number(value) ^ TURN_STUN_MAGIC_COOKIE[index];
		});
		const peerAddress = createTurnStunAttribute(TURN_STUN_ATTR.XOR_PEER_ADDRESS, xorPeerAddress);
		const requestedTransport = new Uint8Array([6, 0, 0, 0]);

		await writeTurnBytes(controlWriter, createTurnStunMessage(
			TURN_STUN_TYPE.ALLOCATE_REQUEST,
			randomTurnTransactionId(),
			[createTurnStunAttribute(TURN_STUN_ATTR.REQUESTED_TRANSPORT, requestedTransport)]
		), 'TURN Allocate request timed out');

		let turnResponse = await readTurnStunMessage(controlReader, null, 'TURN Allocate response timed out');
		let message = turnResponse.message;
		let bufferedData = turnResponse.extraData;
		let integrityKey = null;
		let authAttributes = [];
		const sign = messageToSign => integrityKey ? addTurnMessageIntegrity(messageToSign, integrityKey) : Promise.resolve(messageToSign);

		if (
			message.type === TURN_STUN_TYPE.ALLOCATE_ERROR
			&& proxy.username !== null
			&& proxy.password !== null
			&& parseTurnErrorCode(message.attributes[TURN_STUN_ATTR.ERROR_CODE]) === 401
		) {
			const realmBytes = message.attributes[TURN_STUN_ATTR.REALM];
			const nonce = message.attributes[TURN_STUN_ATTR.NONCE];
			if (!realmBytes || !nonce?.byteLength) throw new Error('TURN authentication challenge is missing realm or nonce');

			const realm = textDecoder.decode(realmBytes);
			integrityKey = new Uint8Array(await crypto.subtle.digest('MD5', textEncoder.encode(`${proxy.username}:${realm}:${proxy.password}`)));
			authAttributes = [
				createTurnStunAttribute(TURN_STUN_ATTR.USERNAME, textEncoder.encode(proxy.username)),
				createTurnStunAttribute(TURN_STUN_ATTR.REALM, textEncoder.encode(realm)),
				createTurnStunAttribute(TURN_STUN_ATTR.NONCE, nonce)
			];

			const allocateRequest = await addTurnMessageIntegrity(createTurnStunMessage(
				TURN_STUN_TYPE.ALLOCATE_REQUEST,
				randomTurnTransactionId(),
				[
					createTurnStunAttribute(TURN_STUN_ATTR.REQUESTED_TRANSPORT, requestedTransport),
					...authAttributes
				]
			), integrityKey);
			const pipelinedMessages = await Promise.all([
				sign(createTurnStunMessage(TURN_STUN_TYPE.CREATE_PERMISSION_REQUEST, randomTurnTransactionId(), [peerAddress, ...authAttributes])),
				sign(createTurnStunMessage(TURN_STUN_TYPE.CONNECT_REQUEST, randomTurnTransactionId(), [peerAddress, ...authAttributes]))
			]);
			await writeTurnBytes(controlWriter, concatBytes(allocateRequest, ...pipelinedMessages), 'TURN authenticated Allocate request timed out');
			turnResponse = await readTurnStunMessage(controlReader, bufferedData, 'TURN authenticated Allocate response timed out');
			message = turnResponse.message;
			bufferedData = turnResponse.extraData;
		} else if (message.type === TURN_STUN_TYPE.ALLOCATE_SUCCESS) {
			const pipelinedMessages = await Promise.all([
				sign(createTurnStunMessage(TURN_STUN_TYPE.CREATE_PERMISSION_REQUEST, randomTurnTransactionId(), [peerAddress, ...authAttributes])),
				sign(createTurnStunMessage(TURN_STUN_TYPE.CONNECT_REQUEST, randomTurnTransactionId(), [peerAddress, ...authAttributes]))
			]);
			if (pipelinedMessages.length) await writeTurnBytes(controlWriter, concatBytes(...pipelinedMessages), 'TURN pipelined request timed out');
		}

		if (message.type !== TURN_STUN_TYPE.ALLOCATE_SUCCESS) {
			const errorCode = parseTurnErrorCode(message.attributes[TURN_STUN_ATTR.ERROR_CODE]);
			throw new Error(errorCode ? `TURN Allocate failed with ${errorCode}` : 'TURN Allocate failed');
		}

		dataSocket = TCP连接({ hostname: turnHost, port: proxy.port });
		turnResponse = await readTurnStunMessage(controlReader, bufferedData, 'TURN CreatePermission response timed out');
		message = turnResponse.message;
		bufferedData = turnResponse.extraData;
		if (message.type !== TURN_STUN_TYPE.CREATE_PERMISSION_SUCCESS) throw new Error('TURN CreatePermission failed');

		turnResponse = await readTurnStunMessage(controlReader, bufferedData, 'TURN CONNECT response timed out');
		message = turnResponse.message;
		bufferedData = turnResponse.extraData;
		if (message.type !== TURN_STUN_TYPE.CONNECT_SUCCESS || !message.attributes[TURN_STUN_ATTR.CONNECTION_ID]) throw new Error('TURN CONNECT failed');

		await withTimeout(dataSocket.opened, CONNECT_TIMEOUT_MS, 'TURN data connection timed out');
		dataWriter = dataSocket.writable.getWriter();
		dataReader = dataSocket.readable.getReader();
		await writeTurnBytes(dataWriter, await sign(createTurnStunMessage(
			TURN_STUN_TYPE.CONNECTION_BIND_REQUEST,
			randomTurnTransactionId(),
			[
				createTurnStunAttribute(TURN_STUN_ATTR.CONNECTION_ID, message.attributes[TURN_STUN_ATTR.CONNECTION_ID]),
				...authAttributes
			]
		)), 'TURN ConnectionBind request timed out');

		turnResponse = await readTurnStunMessage(dataReader, null, 'TURN ConnectionBind response timed out');
		message = turnResponse.message;
		const extraPayload = turnResponse.extraData;
		if (message.type !== TURN_STUN_TYPE.CONNECTION_BIND_SUCCESS) throw new Error('TURN ConnectionBind failed');

		controlWriter.releaseLock();
		controlWriter = null;
		controlReader.releaseLock();
		controlReader = null;
		dataWriter.releaseLock();
		dataWriter = null;

		const readable = new ReadableStream({
			start(controller) {
				if (extraPayload?.byteLength) controller.enqueue(extraPayload);
			},
			pull(controller) {
				return dataReader.read().then(({ done, value }) => {
					if (done) {
						releaseDataReader();
						controller.close();
					} else if (value?.byteLength) controller.enqueue(new Uint8Array(value));
				});
			},
			cancel() {
				try { dataReader?.cancel?.() } catch (e) { }
				releaseDataReader();
				close();
			}
		});

		return { readable, writable: dataSocket.writable, closed: dataSocket.closed, close };
	} catch (error) {
		try { controlWriter?.releaseLock?.() } catch (e) { }
		try { controlReader?.releaseLock?.() } catch (e) { }
		try { dataWriter?.releaseLock?.() } catch (e) { }
		releaseDataReader();
		close();
		throw error;
	}
}
//////////////////////////////////////////////////sstpConnect///////////////////////////////////////////////
const SSTP_TCP_MSS = 1400;
const SSTP_EMPTY_BYTES = new Uint8Array(0);

function readSstpUint16(bytes, offset = 0) {
	return (bytes[offset] << 8) | bytes[offset + 1];
}

function readSstpUint32(bytes, offset = 0) {
	return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function randomSstpUint16() {
	return readSstpUint16(crypto.getRandomValues(new Uint8Array(2)));
}

function internetChecksum(bytes, offset, length) {
	let sum = 0;
	for (let index = offset; index < offset + length - 1; index += 2) sum += readSstpUint16(bytes, index);
	if (length & 1) sum += bytes[offset + length - 1] << 8;
	while (sum >> 16) sum = (sum & 0xffff) + (sum >> 16);
	return (~sum) & 0xffff;
}

async function sstpConnect(proxy, targetHost, targetPort, TCP连接) {
	proxy = { ...proxy, username: proxy.username ?? null, password: proxy.password ?? null };
	let bufferedBytes = SSTP_EMPTY_BYTES, pppIdentifier = 1, socket = null, reader = null, writer = null;
	let closedSettled = false, resolveClosed, rejectClosed;
	const closed = new Promise((resolve, reject) => {
		resolveClosed = resolve;
		rejectClosed = reject;
	});
	const settleClosed = (settle, value) => {
		if (closedSettled) return;
		closedSettled = true;
		settle(value);
	};
	const close = () => {
		try { reader?.cancel?.().catch?.(() => { }) } catch (e) { }
		try { reader?.releaseLock?.() } catch (e) { }
		try { writer?.close?.().catch?.(() => { }) } catch (e) { }
		try { writer?.releaseLock?.() } catch (e) { }
		try { socket?.close?.() } catch (e) { }
		settleClosed(resolveClosed);
	};

	const readSocketChunk = async () => {
		const { value, done } = await reader.read();
		if (done || !value) throw new Error('SSTP socket closed');
		return toBytes(value);
	};
	const readBytes = async length => {
		while (bufferedBytes.byteLength < length) {
			const chunk = await readSocketChunk();
			bufferedBytes = bufferedBytes.byteLength ? concatBytes(bufferedBytes, chunk) : chunk;
		}
		const result = bufferedBytes.subarray(0, length);
		bufferedBytes = bufferedBytes.subarray(length);
		return result;
	};
	const readHttpLine = async () => {
		for (; ;) {
			const lineEnd = bufferedBytes.indexOf(10);
			if (lineEnd >= 0) {
				const line = textDecoder.decode(bufferedBytes.subarray(0, lineEnd));
				bufferedBytes = bufferedBytes.subarray(lineEnd + 1);
				return line.replace(/\r$/, '');
			}
			const chunk = await readSocketChunk();
			bufferedBytes = bufferedBytes.byteLength ? concatBytes(bufferedBytes, chunk) : chunk;
		}
	};
	const readPacket = async (timeoutMs = CONNECT_TIMEOUT_MS) => {
		const header = await withTimeout(readBytes(4), timeoutMs, 'SSTP read timeout');
		const length = readSstpUint16(header, 2) & 0x0fff;
		if (length < 4) throw new Error('Invalid SSTP packet length');
		return {
			isControl: (header[1] & 1) !== 0,
			body: length > 4 ? await withTimeout(readBytes(length - 4), timeoutMs, 'SSTP packet body read timeout') : SSTP_EMPTY_BYTES
		};
	};
	const buildSstpDataPacket = pppFrame => {
		const packetLength = 6 + pppFrame.byteLength;
		const packet = new Uint8Array(packetLength);
		packet.set([0x10, 0x00, ((packetLength >> 8) & 0x0f) | 0x80, packetLength & 0xff, 0xff, 0x03]);
		packet.set(pppFrame, 6);
		return packet;
	};
	const buildPppConfigurePacket = (protocol, code, id, options = []) => {
		const optionsLength = options.reduce((size, option) => size + 2 + option.data.byteLength, 0);
		const frame = new Uint8Array(6 + optionsLength);
		const view = new DataView(frame.buffer);
		view.setUint16(0, protocol);
		frame[2] = code;
		frame[3] = id;
		view.setUint16(4, 4 + optionsLength);
		options.reduce((offset, option) => {
			frame[offset] = option.type;
			frame[offset + 1] = 2 + option.data.byteLength;
			frame.set(option.data, offset + 2);
			return offset + 2 + option.data.byteLength;
		}, 6);
		return frame;
	};
	const parsePPPFrame = data => {
		const offset = data.byteLength >= 2 && data[0] === 0xff && data[1] === 0x03 ? 2 : 0;
		if (data.byteLength - offset < 4) return null;
		const protocol = readSstpUint16(data, offset);
		if (protocol === 0x0021) return { protocol, ipPacket: data.subarray(offset + 2) };
		if (data.byteLength - offset < 6) return null;
		return { protocol, code: data[offset + 2], id: data[offset + 3], payload: data.subarray(offset + 6), rawPacket: data.subarray(offset) };
	};
	const parsePppOptions = data => {
		const options = [];
		for (let offset = 0; offset + 2 <= data.byteLength;) {
			const type = data[offset];
			const length = data[offset + 1];
			if (length < 2 || offset + length > data.byteLength) break;
			options.push({ type, data: data.subarray(offset + 2, offset + length) });
			offset += length;
		}
		return options;
	};

	try {
		const serverHost = stripIPv6Brackets(proxy.hostname);
		const serverPort = proxy.port;
		socket = TCP连接({ hostname: serverHost, port: serverPort }, { secureTransport: 'on', allowHalfOpen: false });
		await withTimeout(socket.opened, CONNECT_TIMEOUT_MS, 'SSTP server connection timed out');
		reader = socket.readable.getReader();
		writer = socket.writable.getWriter();

		const displayHost = serverHost.includes(':') ? `[${serverHost}]` : serverHost;
		const httpRequest = textEncoder.encode(
			`SSTP_DUPLEX_POST /sra_{BA195980-CD49-458b-9E23-C84EE0ADCD75}/ HTTP/1.1\r\n`
			+ `Host: ${Number(serverPort) === 443 ? displayHost : `${displayHost}:${serverPort}`}\r\n`
			+ 'Content-Length: 18446744073709551615\r\n'
			+ `SSTPCORRELATIONID: {${crypto.randomUUID()}}\r\n\r\n`
		);
		const encapsulatedProtocol = new Uint8Array(2);
		new DataView(encapsulatedProtocol.buffer).setUint16(0, 1);
		const maximumReceiveUnit = new Uint8Array(2);
		new DataView(maximumReceiveUnit.buffer).setUint16(0, 1500);
		const sstpConnectRequest = new Uint8Array(12 + encapsulatedProtocol.byteLength);
		const sstpConnectView = new DataView(sstpConnectRequest.buffer);
		sstpConnectRequest[0] = 0x10;
		sstpConnectRequest[1] = 0x01;
		sstpConnectView.setUint16(2, sstpConnectRequest.byteLength | 0x8000);
		sstpConnectView.setUint16(4, 0x0001);
		sstpConnectView.setUint16(6, 1);
		sstpConnectRequest[9] = 1;
		sstpConnectView.setUint16(10, 4 + encapsulatedProtocol.byteLength);
		sstpConnectRequest.set(encapsulatedProtocol, 12);

		await withTimeout(writer.write(concatBytes(
			httpRequest,
			sstpConnectRequest,
			buildSstpDataPacket(buildPppConfigurePacket(0xc021, 1, pppIdentifier++, [
				{ type: 1, data: maximumReceiveUnit }
			]))
		)), CONNECT_TIMEOUT_MS, 'SSTP HTTP handshake request timed out');

		const statusLine = await withTimeout(readHttpLine(), CONNECT_TIMEOUT_MS, 'SSTP HTTP handshake timed out');
		for (; ;) {
			const line = await withTimeout(readHttpLine(), CONNECT_TIMEOUT_MS, 'SSTP HTTP header read timed out');
			if (line === '') break;
		}
		if (!/HTTP\/\d(?:\.\d)?\s+2\d\d/i.test(statusLine)) throw new Error(`SSTP HTTP handshake failed: ${statusLine || 'invalid status'}`);

		let localLcpAcked = false, peerLcpAcked = false, papRequired = false, papSent = false, papDone = false, ipcpStarted = false, ipcpFinished = false, sourceIp = null;
		const sendPapIfReady = async () => {
			if (!localLcpAcked || !peerLcpAcked || !papRequired || papSent) return;
			if (proxy.username === null || proxy.password === null) throw new Error('SSTP server requires PAP authentication');
			const username = textEncoder.encode(proxy.username);
			const password = textEncoder.encode(proxy.password);
			if (username.byteLength > 255 || password.byteLength > 255) throw new Error('SSTP username/password is too long');
			const papLength = 6 + username.byteLength + password.byteLength;
			const frame = new Uint8Array(2 + papLength);
			const view = new DataView(frame.buffer);
			view.setUint16(0, 0xc023);
			frame[2] = 1;
			frame[3] = pppIdentifier++;
			view.setUint16(4, papLength);
			frame[6] = username.byteLength;
			frame.set(username, 7);
			frame[7 + username.byteLength] = password.byteLength;
			frame.set(password, 8 + username.byteLength);
			await withTimeout(writer.write(buildSstpDataPacket(frame)), CONNECT_TIMEOUT_MS, 'SSTP PAP authentication request timed out');
			papSent = true;
		};
		const startIpcpIfReady = async () => {
			if (!localLcpAcked || !peerLcpAcked || ipcpStarted || (papRequired && !papDone)) return;
			await withTimeout(writer.write(buildSstpDataPacket(buildPppConfigurePacket(0x8021, 1, pppIdentifier++, [
				{ type: 3, data: new Uint8Array(4) }
			]))), CONNECT_TIMEOUT_MS, 'SSTP IPCP request timed out');
			ipcpStarted = true;
		};

		for (let round = 0; round < 50 && !ipcpFinished; round++) {
			const packet = await readPacket(CONNECT_TIMEOUT_MS);
			if (packet.isControl) continue;
			const ppp = parsePPPFrame(packet.body);
			if (!ppp) continue;

			if (ppp.protocol === 0xc021) {
				if (ppp.code === 1) {
					const authOption = parsePppOptions(ppp.payload).find(option => option.type === 3);
					if (authOption?.data?.byteLength >= 2) {
						const authProtocol = readSstpUint16(authOption.data);
						if (authProtocol !== 0xc023) throw new Error(`SSTP unsupported PPP authentication protocol: 0x${authProtocol.toString(16)}`);
						papRequired = true;
					}
					const ack = new Uint8Array(ppp.rawPacket);
					ack[2] = 2;
					await withTimeout(writer.write(buildSstpDataPacket(ack)), CONNECT_TIMEOUT_MS, 'SSTP LCP Configure-Ack timed out');
					peerLcpAcked = true;
					await sendPapIfReady();
					await startIpcpIfReady();
				} else if (ppp.code === 2) {
					localLcpAcked = true;
					await sendPapIfReady();
					await startIpcpIfReady();
				}
				continue;
			}

			if (ppp.protocol === 0xc023) {
				if (ppp.code === 2) {
					papDone = true;
					await startIpcpIfReady();
				} else if (ppp.code === 3) throw new Error('SSTP PAP authentication failed');
				continue;
			}

			if (ppp.protocol === 0x8021) {
				if (ppp.code === 1) {
					const ack = new Uint8Array(ppp.rawPacket);
					ack[2] = 2;
					await withTimeout(writer.write(buildSstpDataPacket(ack)), CONNECT_TIMEOUT_MS, 'SSTP IPCP Configure-Ack timed out');
					await startIpcpIfReady();
				} else if (ppp.code === 3) {
					const addressOption = parsePppOptions(ppp.payload).find(option => option.type === 3);
					if (addressOption?.data?.byteLength === 4) {
						sourceIp = [...addressOption.data].join('.');
						await withTimeout(writer.write(buildSstpDataPacket(buildPppConfigurePacket(0x8021, 1, pppIdentifier++, [
							{ type: 3, data: addressOption.data }
						]))), CONNECT_TIMEOUT_MS, 'SSTP IPCP address request timed out');
						ipcpStarted = true;
					}
				} else if (ppp.code === 2) {
					const addressOption = parsePppOptions(ppp.payload).find(option => option.type === 3);
					if (addressOption?.data?.byteLength === 4) sourceIp = [...addressOption.data].join('.');
					ipcpFinished = true;
				}
			}
		}
		if (!sourceIp) throw new Error('SSTP did not assign an IPv4 address');

		const target = stripIPv6Brackets(targetHost);
		/** @type {string | null} */
		let targetIp = isIPv4(target) ? target : null;
		if (!targetIp) {
			const records = await dohQuery(target, 'A');
			const recordData = records.find(item => item.type === 1 && isIPv4(item.data))?.data;
			targetIp = typeof recordData === 'string' ? recordData : null;
		}
		if (!targetIp) throw new Error(`Could not resolve ${targetHost} to an IPv4 address for SSTP`);

		const sourcePort = 10000 + (randomSstpUint16() % 50000);
		const sourceAddress = new Uint8Array(String(sourceIp || '').split('.').map(Number));
		const destinationAddress = new Uint8Array(String(targetIp || '').split('.').map(Number));
		let sequenceNumber = readSstpUint32(crypto.getRandomValues(new Uint8Array(4)));
		let acknowledgementNumber = 0;
		const ipHeaderTemplate = new Uint8Array(20);
		ipHeaderTemplate.set([0x45, 0x00, 0x00, 0x00, 0x00, 0x00, 0x40, 0x00, 64, 6]);
		ipHeaderTemplate.set(sourceAddress, 12);
		ipHeaderTemplate.set(destinationAddress, 16);
		const tcpPseudoHeader = new Uint8Array(1432);
		tcpPseudoHeader.set(sourceAddress);
		tcpPseudoHeader.set(destinationAddress, 4);
		tcpPseudoHeader[9] = 6;
		const buildTcpFrame = (flags, payload = SSTP_EMPTY_BYTES) => {
			const bytes = toBytes(payload);
			const payloadLength = bytes.byteLength;
			const tcpLength = 20 + payloadLength;
			const ipLength = 20 + tcpLength;
			const sstpLength = 8 + ipLength;
			const frame = new Uint8Array(sstpLength);
			const view = new DataView(frame.buffer);
			frame.set([0x10, 0x00, ((sstpLength >> 8) & 0x0f) | 0x80, sstpLength & 0xff, 0xff, 0x03, 0x00, 0x21]);
			frame.set(ipHeaderTemplate, 8);
			view.setUint16(10, ipLength);
			view.setUint16(12, randomSstpUint16());
			view.setUint16(18, internetChecksum(frame, 8, 20));
			view.setUint16(28, sourcePort);
			view.setUint16(30, targetPort);
			view.setUint32(32, sequenceNumber);
			view.setUint32(36, acknowledgementNumber);
			frame[40] = 0x50;
			frame[41] = flags;
			view.setUint16(42, 65535);
			if (payloadLength) frame.set(bytes, 48);
			tcpPseudoHeader[10] = tcpLength >> 8;
			tcpPseudoHeader[11] = tcpLength & 0xff;
			tcpPseudoHeader.set(frame.subarray(28, 28 + tcpLength), 12);
			view.setUint16(44, internetChecksum(tcpPseudoHeader, 0, 12 + tcpLength));
			return frame;
		};
		const matchIncomingIpPacket = ipPacket => {
			if (ipPacket.byteLength < 40 || ipPacket[9] !== 6) return null;
			const ipHeaderLength = (ipPacket[0] & 0x0f) * 4;
			if (ipPacket.byteLength < ipHeaderLength + 20) return null;
			if (readSstpUint16(ipPacket, ipHeaderLength) !== targetPort) return null;
			if (readSstpUint16(ipPacket, ipHeaderLength + 2) !== sourcePort) return null;
			return {
				flags: ipPacket[ipHeaderLength + 13],
				sequence: readSstpUint32(ipPacket, ipHeaderLength + 4),
				payloadOffset: ipHeaderLength + ((ipPacket[ipHeaderLength + 12] >> 4) & 0x0f) * 4
			};
		};

		await withTimeout(writer.write(buildTcpFrame(0x02)), CONNECT_TIMEOUT_MS, 'SSTP TCP SYN write timed out');
		sequenceNumber = (sequenceNumber + 1) >>> 0;
		let tcpReady = false;
		for (let attempt = 0; attempt < 30; attempt++) {
			const packet = await readPacket(CONNECT_TIMEOUT_MS);
			if (packet.isControl) continue;
			const ppp = parsePPPFrame(packet.body);
			if (!ppp || ppp.protocol !== 0x0021) continue;
			const tcp = matchIncomingIpPacket(ppp.ipPacket);
			if (!tcp || (tcp.flags & 0x12) !== 0x12) continue;
			acknowledgementNumber = (tcp.sequence + 1) >>> 0;
			await withTimeout(writer.write(buildTcpFrame(0x10)), CONNECT_TIMEOUT_MS, 'SSTP TCP ACK write timed out');
			tcpReady = true;
			break;
		}
		if (!tcpReady) throw new Error('TCP handshake through SSTP timed out');

		/** @type {ReadableStreamDefaultController<Uint8Array> | null} */
		let streamController = null;
		const readable = new ReadableStream({
			start(controller) {
				streamController = controller;
			},
			cancel() {
				close();
			}
		});

		(async () => {
			try {
				let pendingChunks = [], pendingLength = 0;
				const flush = () => {
					if (!pendingLength) return;
					if (!streamController) throw new Error('SSTP readable stream is not ready');
					streamController.enqueue(pendingChunks.length === 1 ? pendingChunks[0] : concatBytes(...pendingChunks));
					pendingChunks = [];
					pendingLength = 0;
					writer.write(buildTcpFrame(0x10)).catch(() => { });
				};

				for (; ;) {
					const packet = await readPacket(60000);
					if (packet.isControl) continue;
					const ppp = parsePPPFrame(packet.body);
					if (!ppp || ppp.protocol !== 0x0021) continue;
					const incoming = matchIncomingIpPacket(ppp.ipPacket);
					if (!incoming) continue;

					if (incoming.payloadOffset < ppp.ipPacket.byteLength) {
						const payload = ppp.ipPacket.subarray(incoming.payloadOffset);
						if (payload.byteLength) {
							acknowledgementNumber = (incoming.sequence + payload.byteLength) >>> 0;
							pendingChunks.push(new Uint8Array(payload));
							pendingLength += payload.byteLength;
						}
					}

					if (incoming.flags & 0x01) {
						flush();
						acknowledgementNumber = (acknowledgementNumber + 1) >>> 0;
						writer.write(buildTcpFrame(0x11)).catch(() => { });
						const controller = streamController;
						if (controller) {
							try { controller.close() } catch (e) { }
						}
						close();
						return;
					}

					if (bufferedBytes.byteLength < 4 || pendingLength >= 32768) flush();
				}
			} catch (error) {
				const controller = streamController;
				if (controller) {
					try { controller.error(error) } catch (e) { }
				}
				settleClosed(rejectClosed, error);
				try { socket?.close?.() } catch (e) { }
			}
		})();

		const writable = new WritableStream({
			async write(chunk) {
				const bytes = toBytes(chunk);
				if (!bytes.byteLength) return;
				if (bytes.byteLength <= SSTP_TCP_MSS) {
					await writer.write(buildTcpFrame(0x18, bytes));
					sequenceNumber = (sequenceNumber + bytes.byteLength) >>> 0;
					return;
				}
				const frames = [];
				for (let offset = 0; offset < bytes.byteLength; offset += SSTP_TCP_MSS) {
					const segment = bytes.subarray(offset, Math.min(offset + SSTP_TCP_MSS, bytes.byteLength));
					frames.push(buildTcpFrame(0x18, segment));
					sequenceNumber = (sequenceNumber + segment.byteLength) >>> 0;
				}
				await writer.write(concatBytes(...frames));
			},
			close() {
				return writer.write(buildTcpFrame(0x11)).catch(() => { });
			},
			abort(error) {
				close();
				if (error) settleClosed(rejectClosed, error);
			}
		});

		return { readable, writable, closed, close };
	} catch (error) {
		close();
		throw error;
	}
}


// ====== src/tls.js ======
////////////////////////////////////////////TLSClient by: @Alexandre_Kojeve////////////////////////////////////////////////
const TLS_VERSION_10 = 769, TLS_VERSION_12 = 771, TLS_VERSION_13 = 772;
const CONTENT_TYPE_CHANGE_CIPHER_SPEC = 20, CONTENT_TYPE_ALERT = 21, CONTENT_TYPE_HANDSHAKE = 22, CONTENT_TYPE_APPLICATION_DATA = 23;
const HANDSHAKE_TYPE_CLIENT_HELLO = 1, HANDSHAKE_TYPE_SERVER_HELLO = 2, HANDSHAKE_TYPE_NEW_SESSION_TICKET = 4, HANDSHAKE_TYPE_ENCRYPTED_EXTENSIONS = 8, HANDSHAKE_TYPE_CERTIFICATE = 11, HANDSHAKE_TYPE_SERVER_KEY_EXCHANGE = 12, HANDSHAKE_TYPE_CERTIFICATE_REQUEST = 13, HANDSHAKE_TYPE_SERVER_HELLO_DONE = 14, HANDSHAKE_TYPE_CERTIFICATE_VERIFY = 15, HANDSHAKE_TYPE_CLIENT_KEY_EXCHANGE = 16, HANDSHAKE_TYPE_FINISHED = 20, HANDSHAKE_TYPE_KEY_UPDATE = 24;
const EXT_SERVER_NAME = 0, EXT_SUPPORTED_GROUPS = 10, EXT_EC_POINT_FORMATS = 11, EXT_SIGNATURE_ALGORITHMS = 13, EXT_APPLICATION_LAYER_PROTOCOL_NEGOTIATION = 16, EXT_SUPPORTED_VERSIONS = 43, EXT_PSK_KEY_EXCHANGE_MODES = 45, EXT_KEY_SHARE = 51;

const ALERT_CLOSE_NOTIFY = 0, ALERT_LEVEL_WARNING = 1, ALERT_UNRECOGNIZED_NAME = 112;
const shouldIgnoreTlsAlert = fragment => fragment?.[0] === ALERT_LEVEL_WARNING && fragment?.[1] === ALERT_UNRECOGNIZED_NAME;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const EMPTY_BYTES = new Uint8Array(0);

const CIPHER_SUITES_BY_ID = new Map([
	[4865, { id: 4865, keyLen: 16, ivLen: 12, hash: "SHA-256", tls13: !0 }],
	[4866, { id: 4866, keyLen: 32, ivLen: 12, hash: "SHA-384", tls13: !0 }],
	[4867, { id: 4867, keyLen: 32, ivLen: 12, hash: "SHA-256", tls13: !0, chacha: !0 }],
	[49199, { id: 49199, keyLen: 16, ivLen: 4, hash: "SHA-256", kex: "ECDHE" }],
	[49200, { id: 49200, keyLen: 32, ivLen: 4, hash: "SHA-384", kex: "ECDHE" }],
	[52392, { id: 52392, keyLen: 32, ivLen: 12, hash: "SHA-256", kex: "ECDHE", chacha: !0 }],
	[49195, { id: 49195, keyLen: 16, ivLen: 4, hash: "SHA-256", kex: "ECDHE" }],
	[49196, { id: 49196, keyLen: 32, ivLen: 4, hash: "SHA-384", kex: "ECDHE" }],
	[52393, { id: 52393, keyLen: 32, ivLen: 12, hash: "SHA-256", kex: "ECDHE", chacha: !0 }]
]);
const GROUPS_BY_ID = new Map([[29, "X25519"], [23, "P-256"]]);
const SUPPORTED_SIGNATURE_ALGORITHMS = [2052, 2053, 2054, 1025, 1281, 1537, 1027, 1283, 1539];

const tlsBytes = (...parts) => {
	const flattenBytes = values => values.flatMap(value => value instanceof Uint8Array ? [...value] : Array.isArray(value) ? flattenBytes(value) : "number" == typeof value ? [value] : []);
	return new Uint8Array(flattenBytes(parts))
};
const uint16be = value => [value >> 8 & 255, 255 & value];
const readUint16 = (buffer, offset) => buffer[offset] << 8 | buffer[offset + 1];
const readUint24 = (buffer, offset) => buffer[offset] << 16 | buffer[offset + 1] << 8 | buffer[offset + 2];
const randomBytes = length => crypto.getRandomValues(new Uint8Array(length));
const constantTimeEqual = (left, right) => {
	if (!left || !right || left.length !== right.length) return !1;
	let diff = 0; for (let index = 0; index < left.length; index++) diff |= left[index] ^ right[index];
	return 0 === diff
};
const hashByteLength = hash => "SHA-512" === hash ? 64 : "SHA-384" === hash ? 48 : 32;
async function hmac(hash, key, data) {
	const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash }, !1, ["sign"]);
	return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, data))
}
async function digestBytes(hash, data) { return new Uint8Array(await crypto.subtle.digest(hash, data)) }
async function tls12Prf(secret, label, seed, length, hash = "SHA-256") {
	const labelSeed = concatBytes(textEncoder.encode(label), seed);
	let output = new Uint8Array(0),
		currentA = labelSeed;
	for (; output.length < length;) {
		currentA = await hmac(hash, secret, currentA);
		const block = await hmac(hash, secret, concatBytes(currentA, labelSeed));
		output = concatBytes(output, block)
	}
	return output.slice(0, length)
}
async function hkdfExtract(hash, salt, inputKeyMaterial) {
	return salt && salt.length || (salt = new Uint8Array(hashByteLength(hash))), hmac(hash, salt, inputKeyMaterial)
}
async function hkdfExpandLabel(hash, secret, label, context, length) {
	const fullLabel = textEncoder.encode("tls13 " + label);
	return async function (hash, secret, info, length) {
		const hashLen = hashByteLength(hash),
			roundCount = Math.ceil(length / hashLen);
		let output = new Uint8Array(0),
			previousBlock = new Uint8Array(0);
		for (let round = 1; round <= roundCount; round++) previousBlock = await hmac(hash, secret, concatBytes(previousBlock, info, [round])), output = concatBytes(output, previousBlock);
		return output.slice(0, length)
	}(hash, secret, tlsBytes(uint16be(length), fullLabel.length, fullLabel, context.length, context), length)
}
async function generateKeyShare(group = "P-256") {
	const algorithm = "X25519" === group ? { name: "X25519" } : { name: "ECDH", namedCurve: group };
	const keyPair = /** @type {CryptoKeyPair} */ (await crypto.subtle.generateKey(algorithm, !0, ["deriveBits"]));
	const publicKeyRaw = /** @type {ArrayBuffer} */ (await crypto.subtle.exportKey("raw", keyPair.publicKey));
	return { keyPair, publicKeyRaw: new Uint8Array(publicKeyRaw) }
}
async function deriveSharedSecret(privateKey, peerPublicKey, group = "P-256") {
	const algorithm = "X25519" === group ? { name: "X25519" } : { name: "ECDH", namedCurve: group },
		peerKey = await crypto.subtle.importKey("raw", peerPublicKey, algorithm, !1, []),
		bits = "P-384" === group ? 384 : "P-521" === group ? 528 : 256;
	return new Uint8Array(await crypto.subtle.deriveBits(/** @type {any} */({ name: algorithm.name, public: peerKey }), privateKey, bits))
}
async function importAesGcmKey(key, usages) { return crypto.subtle.importKey("raw", key, { name: "AES-GCM" }, !1, usages) }
async function aesGcmEncryptWithKey(cryptoKey, initializationVector, plaintext, additionalData) {
	return new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: initializationVector, additionalData, tagLength: 128 }, cryptoKey, plaintext))
}
async function aesGcmDecryptWithKey(cryptoKey, initializationVector, ciphertext, additionalData) {
	return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: initializationVector, additionalData, tagLength: 128 }, cryptoKey, ciphertext))
}

function rotateLeft32(value, bits) { return (value << bits | value >>> 32 - bits) >>> 0 }

function chachaQuarterRound(state, indexA, indexB, indexC, indexD) {
	state[indexA] = state[indexA] + state[indexB] >>> 0, state[indexD] = rotateLeft32(state[indexD] ^ state[indexA], 16), state[indexC] = state[indexC] + state[indexD] >>> 0, state[indexB] = rotateLeft32(state[indexB] ^ state[indexC], 12), state[indexA] = state[indexA] + state[indexB] >>> 0, state[indexD] = rotateLeft32(state[indexD] ^ state[indexA], 8), state[indexC] = state[indexC] + state[indexD] >>> 0, state[indexB] = rotateLeft32(state[indexB] ^ state[indexC], 7)
}

function chacha20Block(key, counter, nonce) {
	const state = new Uint32Array(16);
	state[0] = 1634760805, state[1] = 857760878, state[2] = 2036477234, state[3] = 1797285236;
	const keyView = new DataView(key.buffer, key.byteOffset, key.byteLength);
	for (let wordIndex = 0; wordIndex < 8; wordIndex++) state[4 + wordIndex] = keyView.getUint32(4 * wordIndex, !0);
	state[12] = counter;
	const nonceView = new DataView(nonce.buffer, nonce.byteOffset, nonce.byteLength);
	state[13] = nonceView.getUint32(0, !0), state[14] = nonceView.getUint32(4, !0), state[15] = nonceView.getUint32(8, !0);
	const workingState = new Uint32Array(state);
	for (let round = 0; round < 10; round++) chachaQuarterRound(workingState, 0, 4, 8, 12), chachaQuarterRound(workingState, 1, 5, 9, 13), chachaQuarterRound(workingState, 2, 6, 10, 14), chachaQuarterRound(workingState, 3, 7, 11, 15), chachaQuarterRound(workingState, 0, 5, 10, 15), chachaQuarterRound(workingState, 1, 6, 11, 12), chachaQuarterRound(workingState, 2, 7, 8, 13), chachaQuarterRound(workingState, 3, 4, 9, 14);
	for (let wordIndex = 0; wordIndex < 16; wordIndex++) workingState[wordIndex] = workingState[wordIndex] + state[wordIndex] >>> 0;
	return new Uint8Array(workingState.buffer.slice(0))
}

function chacha20Xor(key, nonce, data) {
	const output = new Uint8Array(data.length);
	let counter = 1;
	for (let offset = 0; offset < data.length; offset += 64) {
		const block = chacha20Block(key, counter++, nonce),
			blockLength = Math.min(64, data.length - offset);
		for (let index = 0; index < blockLength; index++) output[offset + index] = data[offset + index] ^ block[index]
	}
	return output
}

function poly1305Mac(key, message) {
	const rKey = function (rBytes) {
		const clamped = new Uint8Array(rBytes);
		return clamped[3] &= 15, clamped[7] &= 15, clamped[11] &= 15, clamped[15] &= 15, clamped[4] &= 252, clamped[8] &= 252, clamped[12] &= 252, clamped
	}(key.slice(0, 16)),
		sKey = key.slice(16, 32);
	let accumulator = [0n, 0n, 0n, 0n, 0n];
	const rLimbs = [0x3ffffffn & BigInt(rKey[0] | rKey[1] << 8 | rKey[2] << 16 | rKey[3] << 24), 0x3ffffffn & BigInt(rKey[3] >> 2 | rKey[4] << 6 | rKey[5] << 14 | rKey[6] << 22), 0x3ffffffn & BigInt(rKey[6] >> 4 | rKey[7] << 4 | rKey[8] << 12 | rKey[9] << 20), 0x3ffffffn & BigInt(rKey[9] >> 6 | rKey[10] << 2 | rKey[11] << 10 | rKey[12] << 18), 0x3ffffffn & BigInt(rKey[13] | rKey[14] << 8 | rKey[15] << 16)];
	for (let offset = 0; offset < message.length; offset += 16) {
		const chunk = message.slice(offset, offset + 16),
			paddedChunk = new Uint8Array(17);
		paddedChunk.set(chunk), paddedChunk[chunk.length] = 1, accumulator[0] += BigInt(paddedChunk[0] | paddedChunk[1] << 8 | paddedChunk[2] << 16 | (3 & paddedChunk[3]) << 24), accumulator[1] += BigInt(paddedChunk[3] >> 2 | paddedChunk[4] << 6 | paddedChunk[5] << 14 | (15 & paddedChunk[6]) << 22), accumulator[2] += BigInt(paddedChunk[6] >> 4 | paddedChunk[7] << 4 | paddedChunk[8] << 12 | (63 & paddedChunk[9]) << 20), accumulator[3] += BigInt(paddedChunk[9] >> 6 | paddedChunk[10] << 2 | paddedChunk[11] << 10 | paddedChunk[12] << 18), accumulator[4] += BigInt(paddedChunk[13] | paddedChunk[14] << 8 | paddedChunk[15] << 16 | paddedChunk[16] << 24);
		const product = [0n, 0n, 0n, 0n, 0n];
		for (let accIndex = 0; accIndex < 5; accIndex++)
			for (let rIndex = 0; rIndex < 5; rIndex++) {
				const limbIndex = accIndex + rIndex;
				limbIndex < 5 ? product[limbIndex] += accumulator[accIndex] * rLimbs[rIndex] : product[limbIndex - 5] += accumulator[accIndex] * rLimbs[rIndex] * 5n
			}
		let carry = 0n;
		for (let index = 0; index < 5; index++) product[index] += carry, accumulator[index] = 0x3ffffffn & product[index], carry = product[index] >> 26n;
		accumulator[0] += 5n * carry, carry = accumulator[0] >> 26n, accumulator[0] &= 0x3ffffffn, accumulator[1] += carry
	}
	let tagValue = accumulator[0] | accumulator[1] << 26n | accumulator[2] << 52n | accumulator[3] << 78n | accumulator[4] << 104n;
	tagValue = tagValue + sKey.reduce(((total, byte, index) => total + (BigInt(byte) << BigInt(8 * index))), 0n) & (1n << 128n) - 1n;
	const tag = new Uint8Array(16);
	for (let index = 0; index < 16; index++) tag[index] = Number(tagValue >> BigInt(8 * index) & 0xffn);
	return tag
}

function chacha20Poly1305Encrypt(key, nonce, plaintext, additionalData) {
	const polyKey = chacha20Block(key, 0, nonce).slice(0, 32),
		ciphertext = chacha20Xor(key, nonce, plaintext),
		aadPadding = (16 - additionalData.length % 16) % 16,
		ciphertextPadding = (16 - ciphertext.length % 16) % 16,
		macData = new Uint8Array(additionalData.length + aadPadding + ciphertext.length + ciphertextPadding + 16);
	macData.set(additionalData, 0), macData.set(ciphertext, additionalData.length + aadPadding);
	const lengthView = new DataView(macData.buffer, additionalData.length + aadPadding + ciphertext.length + ciphertextPadding);
	lengthView.setBigUint64(0, BigInt(additionalData.length), !0), lengthView.setBigUint64(8, BigInt(ciphertext.length), !0);
	const tag = poly1305Mac(polyKey, macData);
	return concatBytes(ciphertext, tag)
}

function chacha20Poly1305Decrypt(key, nonce, ciphertext, additionalData) {
	if (ciphertext.length < 16) throw new Error("Ciphertext too short");
	const tag = ciphertext.slice(-16),
		encryptedData = ciphertext.slice(0, -16),
		polyKey = chacha20Block(key, 0, nonce).slice(0, 32),
		aadPadding = (16 - additionalData.length % 16) % 16,
		ciphertextPadding = (16 - encryptedData.length % 16) % 16,
		macData = new Uint8Array(additionalData.length + aadPadding + encryptedData.length + ciphertextPadding + 16);
	macData.set(additionalData, 0), macData.set(encryptedData, additionalData.length + aadPadding);
	const lengthView = new DataView(macData.buffer, additionalData.length + aadPadding + encryptedData.length + ciphertextPadding);
	lengthView.setBigUint64(0, BigInt(additionalData.length), !0), lengthView.setBigUint64(8, BigInt(encryptedData.length), !0);
	const expectedTag = poly1305Mac(polyKey, macData);
	let diff = 0;
	for (let index = 0; index < 16; index++) diff |= tag[index] ^ expectedTag[index];
	if (0 !== diff) throw new Error("ChaCha20-Poly1305 authentication failed");
	return chacha20Xor(key, nonce, encryptedData)
}

const TLS_MAX_PLAINTEXT_FRAGMENT = 16 * 1024;
function buildTlsRecord(contentType, fragment, version = TLS_VERSION_12) {
	const data = toBytes(fragment);
	const record = new Uint8Array(5 + data.byteLength);
	record[0] = contentType;
	record[1] = version >> 8 & 255;
	record[2] = version & 255;
	record[3] = data.byteLength >> 8 & 255;
	record[4] = data.byteLength & 255;
	record.set(data, 5);
	return record;
}
function buildHandshakeMessage(handshakeType, body) { return tlsBytes(handshakeType, (length => [length >> 16 & 255, length >> 8 & 255, 255 & length])(body.length), body) }
class TlsRecordParser {
	constructor() { this.buffer = new Uint8Array(0) }
	feed(chunk) {
		const bytes = toBytes(chunk);
		this.buffer = this.buffer.length ? concatBytes(this.buffer, bytes) : bytes
	}
	next() {
		if (this.buffer.length < 5) return null;
		const contentType = this.buffer[0],
			version = readUint16(this.buffer, 1),
			length = readUint16(this.buffer, 3);
		if (this.buffer.length < 5 + length) return null;
		const fragment = this.buffer.subarray(5, 5 + length);
		return this.buffer = this.buffer.subarray(5 + length), { type: contentType, version, length, fragment }
	}
}
class TlsHandshakeParser {
	constructor() { this.buffer = new Uint8Array(0) }
	feed(chunk) {
		const bytes = toBytes(chunk);
		this.buffer = this.buffer.length ? concatBytes(this.buffer, bytes) : bytes
	}
	next() {
		if (this.buffer.length < 4) return null;
		const handshakeType = this.buffer[0],
			length = readUint24(this.buffer, 1);
		if (this.buffer.length < 4 + length) return null;
		const body = this.buffer.subarray(4, 4 + length),
			raw = this.buffer.subarray(0, 4 + length);
		return this.buffer = this.buffer.subarray(4 + length), { type: handshakeType, length, body, raw }
	}
}

function parseServerHello(body) {
	let offset = 0;
	const legacyVersion = readUint16(body, offset);
	offset += 2;
	const serverRandom = body.slice(offset, offset + 32);
	offset += 32;
	const sessionIdLength = body[offset++],
		sessionId = body.slice(offset, offset + sessionIdLength);
	offset += sessionIdLength;
	const cipherSuite = readUint16(body, offset);
	offset += 2;
	const compression = body[offset++];
	let selectedVersion = legacyVersion,
		keyShare = null,
		alpn = null;
	if (offset < body.length) {
		const extensionsLength = readUint16(body, offset);
		offset += 2;
		const extensionsEnd = offset + extensionsLength;
		for (; offset + 4 <= extensionsEnd;) {
			const extensionType = readUint16(body, offset);
			offset += 2;
			const extensionLength = readUint16(body, offset);
			offset += 2;
			const extensionData = body.slice(offset, offset + extensionLength);
			if (offset += extensionLength, extensionType === EXT_SUPPORTED_VERSIONS && extensionLength >= 2) selectedVersion = readUint16(extensionData, 0);
			else if (extensionType === EXT_KEY_SHARE && extensionLength >= 4) {
				const group = readUint16(extensionData, 0),
					keyLength = readUint16(extensionData, 2);
				keyShare = { group, key: extensionData.slice(4, 4 + keyLength) }
			} else extensionType === EXT_APPLICATION_LAYER_PROTOCOL_NEGOTIATION && extensionLength >= 3 && (alpn = textDecoder.decode(extensionData.slice(3, 3 + extensionData[2])))
		}
	}
	const helloRetryRequestRandom = new Uint8Array([207, 33, 173, 116, 229, 154, 97, 17, 190, 29, 140, 2, 30, 101, 184, 145, 194, 162, 17, 22, 122, 187, 140, 94, 7, 158, 9, 226, 200, 168, 51, 156]);
	return { version: legacyVersion, serverRandom, sessionId, cipherSuite, compression, selectedVersion, keyShare, alpn, isHRR: constantTimeEqual(serverRandom, helloRetryRequestRandom), isTls13: selectedVersion === TLS_VERSION_13 }
}

function parseServerKeyExchange(body) {
	let offset = 1;
	const namedCurve = readUint16(body, offset);
	offset += 2;
	const keyLength = body[offset++];
	return { namedCurve, serverPublicKey: body.slice(offset, offset + keyLength) }
}

function extractLeafCertificate(body, hasContext = 0) {
	let offset = 0;
	if (hasContext) {
		const contextLength = body[offset++];
		offset += contextLength
	}
	if (offset + 3 > body.length) return null;
	const certificateListLength = readUint24(body, offset);
	if (offset += 3, !certificateListLength || offset + 3 > body.length) return null;
	const certificateLength = readUint24(body, offset);
	return offset += 3, certificateLength ? body.slice(offset, offset + certificateLength) : null
}

function parseEncryptedExtensions(body) {
	const parsed = { alpn: null };
	let offset = 2;
	const extensionsEnd = 2 + readUint16(body, 0);
	for (; offset + 4 <= extensionsEnd;) {
		const extensionType = readUint16(body, offset);
		offset += 2;
		const extensionLength = readUint16(body, offset);
		if (offset += 2, extensionType === EXT_APPLICATION_LAYER_PROTOCOL_NEGOTIATION && extensionLength >= 3) {
			const protocolLength = body[offset + 2];
			protocolLength > 0 && offset + 3 + protocolLength <= offset + extensionLength && (parsed.alpn = textDecoder.decode(body.slice(offset + 3, offset + 3 + protocolLength)))
		}
		offset += extensionLength
	}
	return parsed
}

function buildClientHello(clientRandom, serverName, keyShares, { tls13: enableTls13 = !0, tls12: enableTls12 = !0, alpn = null, chacha = !0 } = {}) {
	const cipherIds = [];
	enableTls13 && cipherIds.push(4865, 4866, ...(chacha ? [4867] : [])), enableTls12 && cipherIds.push(49199, 49200, 49195, 49196, ...(chacha ? [52392, 52393] : []));
	const cipherBytes = tlsBytes(...cipherIds.flatMap(uint16be)),
		extensions = [tlsBytes(255, 1, 0, 1, 0)];
	if (serverName) {
		const serverNameBytes = textEncoder.encode(serverName),
			serverNameList = tlsBytes(0, uint16be(serverNameBytes.length), serverNameBytes);
		extensions.push(tlsBytes(uint16be(EXT_SERVER_NAME), uint16be(serverNameList.length + 2), uint16be(serverNameList.length), serverNameList))
	}
	extensions.push(tlsBytes(uint16be(EXT_EC_POINT_FORMATS), 0, 2, 1, 0)), extensions.push(tlsBytes(uint16be(EXT_SUPPORTED_GROUPS), 0, 6, 0, 4, 0, 29, 0, 23));
	const signatureBytes = tlsBytes(...SUPPORTED_SIGNATURE_ALGORITHMS.flatMap(uint16be));
	extensions.push(tlsBytes(uint16be(EXT_SIGNATURE_ALGORITHMS), uint16be(signatureBytes.length + 2), uint16be(signatureBytes.length), signatureBytes));
	const protocols = Array.isArray(alpn) ? alpn.filter(Boolean) : alpn ? [alpn] : [];
	if (protocols.length) {
		const alpnBytes = concatBytes(...protocols.map((protocol => { const protocolBytes = textEncoder.encode(protocol); return tlsBytes(protocolBytes.length, protocolBytes) })));
		extensions.push(tlsBytes(uint16be(EXT_APPLICATION_LAYER_PROTOCOL_NEGOTIATION), uint16be(alpnBytes.length + 2), uint16be(alpnBytes.length), alpnBytes))
	}
	if (enableTls13 && keyShares) {
		let keyShareBytes;
		if (extensions.push(enableTls12 ? tlsBytes(uint16be(EXT_SUPPORTED_VERSIONS), 0, 5, 4, 3, 4, 3, 3) : tlsBytes(uint16be(EXT_SUPPORTED_VERSIONS), 0, 3, 2, 3, 4)), extensions.push(tlsBytes(uint16be(EXT_PSK_KEY_EXCHANGE_MODES), 0, 2, 1, 1)), keyShares?.x25519 && keyShares?.p256) keyShareBytes = concatBytes(tlsBytes(0, 29, uint16be(keyShares.x25519.length), keyShares.x25519), tlsBytes(0, 23, uint16be(keyShares.p256.length), keyShares.p256));
		else if (keyShares?.x25519) keyShareBytes = tlsBytes(0, 29, uint16be(keyShares.x25519.length), keyShares.x25519);
		else if (keyShares?.p256) keyShareBytes = tlsBytes(0, 23, uint16be(keyShares.p256.length), keyShares.p256);
		else {
			if (!(keyShares instanceof Uint8Array)) throw new Error("Invalid keyShares");
			keyShareBytes = tlsBytes(0, 23, uint16be(keyShares.length), keyShares)
		}
		extensions.push(tlsBytes(uint16be(EXT_KEY_SHARE), uint16be(keyShareBytes.length + 2), uint16be(keyShareBytes.length), keyShareBytes))
	}
	const extensionsBytes = concatBytes(...extensions);
	return buildHandshakeMessage(HANDSHAKE_TYPE_CLIENT_HELLO, tlsBytes(uint16be(TLS_VERSION_12), clientRandom, 0, uint16be(cipherBytes.length), cipherBytes, 1, 0, uint16be(extensionsBytes.length), extensionsBytes))
}
const uint64be = sequenceNumber => { const bytes = new Uint8Array(8); return new DataView(bytes.buffer).setBigUint64(0, sequenceNumber, !1), bytes },
	xorSequenceIntoIv = (initializationVector, sequenceNumber) => {
		const nonce = initializationVector.slice(),
			sequenceBytes = uint64be(sequenceNumber);
		for (let index = 0; index < 8; index++) nonce[nonce.length - 8 + index] ^= sequenceBytes[index];
		return nonce
	},
	deriveTrafficKeys = (hash, secret, keyLen, ivLen) => Promise.all([hkdfExpandLabel(hash, secret, "key", EMPTY_BYTES, keyLen), hkdfExpandLabel(hash, secret, "iv", EMPTY_BYTES, ivLen)]);
class TlsClient {
	constructor(socket, options = {}) {
		if (this.socket = socket, this.serverName = options.serverName || "", this.supportTls13 = !1 !== options.tls13, this.supportTls12 = !1 !== options.tls12, !this.supportTls13 && !this.supportTls12) throw new Error("At least one TLS version must be enabled");
		this.alpnProtocols = Array.isArray(options.alpn) ? options.alpn : options.alpn ? [options.alpn] : null, this.allowChacha = options.allowChacha !== false, this.timeout = options.timeout ?? 3e4, this.clientRandom = randomBytes(32), this.serverRandom = null, this.handshakeChunks = [], this.handshakeComplete = !1, this.negotiatedAlpn = null, this.cipherSuite = null, this.cipherConfig = null, this.isTls13 = !1, this.masterSecret = null, this.handshakeSecret = null, this.clientWriteKey = null, this.serverWriteKey = null, this.clientWriteIv = null, this.serverWriteIv = null, this.clientHandshakeKey = null, this.serverHandshakeKey = null, this.clientHandshakeIv = null, this.serverHandshakeIv = null, this.clientAppKey = null, this.serverAppKey = null, this.clientAppIv = null, this.serverAppIv = null, this.clientWriteCryptoKey = null, this.serverWriteCryptoKey = null, this.clientHandshakeCryptoKey = null, this.serverHandshakeCryptoKey = null, this.clientAppCryptoKey = null, this.serverAppCryptoKey = null, this.clientSeqNum = 0n, this.serverSeqNum = 0n, this.recordParser = new TlsRecordParser, this.handshakeParser = new TlsHandshakeParser, this.keyPairs = new Map, this.ecdhKeyPair = null, this.sawCert = !1
	}
	recordHandshake(chunk) { this.handshakeChunks.push(chunk) }
	transcript() { return 1 === this.handshakeChunks.length ? this.handshakeChunks[0] : concatBytes(...this.handshakeChunks) }
	getCipherConfig(cipherSuite) { return CIPHER_SUITES_BY_ID.get(cipherSuite) || null }
	async readChunk(reader) { return this.timeout ? Promise.race([reader.read(), new Promise(((resolve, reject) => setTimeout((() => reject(new Error("TLS read timeout"))), this.timeout)))]) : reader.read() }
	async readRecordsUntil(reader, predicate, closedError) {
		for (; ;) {
			let record;
			for (; record = this.recordParser.next();)
				if (await predicate(record)) return;
			const { value, done } = await this.readChunk(reader);
			if (done) throw new Error(closedError);
			this.recordParser.feed(value)
		}
	}
	async readHandshakeUntil(reader, predicate, closedError) {
		for (let message; message = this.handshakeParser.next();)
			if (await predicate(message)) return;
		return this.readRecordsUntil(reader, (async record => {
			if (record.type === CONTENT_TYPE_ALERT) {
				if (shouldIgnoreTlsAlert(record.fragment)) return;
				throw new Error(`TLS Alert: ${record.fragment[1]}`);
			}
			if (record.type === CONTENT_TYPE_HANDSHAKE) {
				this.handshakeParser.feed(record.fragment);
				for (let message; message = this.handshakeParser.next();)
					if (await predicate(message)) return 1
			}
		}), closedError)
	}
	async acceptCertificate(certificate) { if (!certificate?.length) throw new Error("Empty certificate"); this.sawCert = !0 }
	async handshake() {
		const [p256Share, x25519Share] = await Promise.all([generateKeyShare("P-256"), generateKeyShare("X25519")]);
		this.keyPairs = new Map([[23, p256Share], [29, x25519Share]]), this.ecdhKeyPair = p256Share.keyPair;
		const reader = this.socket.readable.getReader(),
			writer = this.socket.writable.getWriter();
		try {
			const clientHello = buildClientHello(this.clientRandom, this.serverName, { x25519: x25519Share.publicKeyRaw, p256: p256Share.publicKeyRaw }, { tls13: this.supportTls13, tls12: this.supportTls12, alpn: this.alpnProtocols, chacha: this.allowChacha });
			this.recordHandshake(clientHello), await writer.write(buildTlsRecord(CONTENT_TYPE_HANDSHAKE, clientHello, TLS_VERSION_10));
			const serverHello = await this.receiveServerHello(reader);
			if (serverHello.isHRR) throw new Error("HelloRetryRequest is not supported by TLSClientMini");
			if (serverHello.keyShare?.group && this.keyPairs.has(serverHello.keyShare.group)) {
				const selectedKeyPair = this.keyPairs.get(serverHello.keyShare.group);
				this.ecdhKeyPair = selectedKeyPair.keyPair
			}
			serverHello.isTls13 ? await this.handshakeTls13(reader, writer, serverHello) : await this.handshakeTls12(reader, writer), this.handshakeComplete = !0
		} finally {
			reader.releaseLock(), writer.releaseLock()
		}
	}
	async receiveServerHello(reader) {
		for (; ;) {
			const { value, done } = await this.readChunk(reader);
			if (done) throw new Error("Connection closed waiting for ServerHello");
			let record;
			for (this.recordParser.feed(value); record = this.recordParser.next();) {
				if (record.type === CONTENT_TYPE_ALERT) {
					if (shouldIgnoreTlsAlert(record.fragment)) continue;
					throw new Error(`TLS Alert: level=${record.fragment[0]}, desc=${record.fragment[1]}`);
				}
				if (record.type !== CONTENT_TYPE_HANDSHAKE) continue;
				let message;
				for (this.handshakeParser.feed(record.fragment); message = this.handshakeParser.next();) {
					if (message.type !== HANDSHAKE_TYPE_SERVER_HELLO) continue;
					this.recordHandshake(message.raw);
					const serverHello = parseServerHello(message.body);
					if (this.serverRandom = serverHello.serverRandom, this.cipherSuite = serverHello.cipherSuite, this.cipherConfig = this.getCipherConfig(serverHello.cipherSuite), this.isTls13 = serverHello.isTls13, this.negotiatedAlpn = serverHello.alpn || null, !this.cipherConfig) throw new Error(`Unsupported cipher suite: 0x${serverHello.cipherSuite.toString(16)}`);
					return serverHello
				}
			}
		}
	}
	async handshakeTls12(reader, writer) {
		/** @type {{ namedCurve: number, serverPublicKey: Uint8Array } | null} */
		let serverKeyExchange = null;
		let sawServerHelloDone = !1;
		if (await this.readHandshakeUntil(reader, (async message => {
			switch (message.type) {
				case HANDSHAKE_TYPE_CERTIFICATE: {
					this.recordHandshake(message.raw);
					const certificate = extractLeafCertificate(message.body, 1);
					if (!certificate) throw new Error("Missing TLS 1.2 certificate");
					await this.acceptCertificate(certificate);
					break
				}
				case HANDSHAKE_TYPE_SERVER_KEY_EXCHANGE:
					this.recordHandshake(message.raw), serverKeyExchange = parseServerKeyExchange(message.body);
					break;
				case HANDSHAKE_TYPE_SERVER_HELLO_DONE:
					return this.recordHandshake(message.raw), sawServerHelloDone = !0, 1;
				case HANDSHAKE_TYPE_CERTIFICATE_REQUEST:
					throw new Error("Client certificate is not supported");
				default:
					this.recordHandshake(message.raw)
			}
		}), "Connection closed during TLS 1.2 handshake"), !this.sawCert) throw new Error("Missing TLS 1.2 leaf certificate");
		const serverKeyExchangeData = /** @type {{ namedCurve: number, serverPublicKey: Uint8Array } | null} */ (serverKeyExchange);
		if (!serverKeyExchangeData) throw new Error("Missing TLS 1.2 ServerKeyExchange");
		const curveName = GROUPS_BY_ID.get(serverKeyExchangeData.namedCurve);
		if (!curveName) throw new Error(`Unsupported named curve: 0x${serverKeyExchangeData.namedCurve.toString(16)}`);
		const keyShare = this.keyPairs.get(serverKeyExchangeData.namedCurve);
		if (!keyShare) throw new Error(`Missing key pair for curve: 0x${serverKeyExchangeData.namedCurve.toString(16)}`);
		const preMasterSecret = await deriveSharedSecret(keyShare.keyPair.privateKey, serverKeyExchangeData.serverPublicKey, curveName),
			clientKeyExchange = buildHandshakeMessage(HANDSHAKE_TYPE_CLIENT_KEY_EXCHANGE, tlsBytes(keyShare.publicKeyRaw.length, keyShare.publicKeyRaw));
		this.recordHandshake(clientKeyExchange);
		const hashName = this.cipherConfig.hash;
		this.masterSecret = await tls12Prf(preMasterSecret, "master secret", concatBytes(this.clientRandom, this.serverRandom), 48, hashName);
		const keyLen = this.cipherConfig.keyLen,
			ivLen = this.cipherConfig.ivLen,
			keyBlock = await tls12Prf(this.masterSecret, "key expansion", concatBytes(this.serverRandom, this.clientRandom), 2 * keyLen + 2 * ivLen, hashName);
		this.clientWriteKey = keyBlock.slice(0, keyLen), this.serverWriteKey = keyBlock.slice(keyLen, 2 * keyLen), this.clientWriteIv = keyBlock.slice(2 * keyLen, 2 * keyLen + ivLen), this.serverWriteIv = keyBlock.slice(2 * keyLen + ivLen, 2 * keyLen + 2 * ivLen);
		if (!this.cipherConfig.chacha) [this.clientWriteCryptoKey, this.serverWriteCryptoKey] = await Promise.all([importAesGcmKey(this.clientWriteKey, ["encrypt"]), importAesGcmKey(this.serverWriteKey, ["decrypt"])]);
		await writer.write(buildTlsRecord(CONTENT_TYPE_HANDSHAKE, clientKeyExchange)), await writer.write(buildTlsRecord(CONTENT_TYPE_CHANGE_CIPHER_SPEC, tlsBytes(1)));
		const clientVerifyData = await tls12Prf(this.masterSecret, "client finished", await digestBytes(hashName, this.transcript()), 12, hashName),
			finishedMessage = buildHandshakeMessage(HANDSHAKE_TYPE_FINISHED, clientVerifyData);
		this.recordHandshake(finishedMessage), await writer.write(buildTlsRecord(CONTENT_TYPE_HANDSHAKE, await this.encryptTls12(finishedMessage, CONTENT_TYPE_HANDSHAKE)));
		let sawChangeCipherSpec = !1;
		await this.readRecordsUntil(reader, (async record => {
			if (record.type === CONTENT_TYPE_ALERT) {
				if (shouldIgnoreTlsAlert(record.fragment)) return;
				throw new Error(`TLS Alert: ${record.fragment[1]}`);
			}
			if (record.type === CONTENT_TYPE_CHANGE_CIPHER_SPEC) return void (sawChangeCipherSpec = !0);
			if (record.type !== CONTENT_TYPE_HANDSHAKE || !sawChangeCipherSpec) return;
			const decrypted = await this.decryptTls12(record.fragment, CONTENT_TYPE_HANDSHAKE);
			if (decrypted[0] !== HANDSHAKE_TYPE_FINISHED) return;
			const verifyLength = readUint24(decrypted, 1),
				verifyData = decrypted.slice(4, 4 + verifyLength),
				expectedVerifyData = await tls12Prf(this.masterSecret, "server finished", await digestBytes(hashName, this.transcript()), 12, hashName);
			if (!constantTimeEqual(verifyData, expectedVerifyData)) throw new Error("TLS 1.2 server Finished verify failed");
			return 1
		}), "Connection closed waiting for TLS 1.2 Finished")
	}
	async handshakeTls13(reader, writer, serverHello) {
		const groupName = GROUPS_BY_ID.get(serverHello.keyShare?.group);
		if (!groupName || !serverHello.keyShare?.key?.length) throw new Error("Missing TLS 1.3 key_share");
		const hashName = this.cipherConfig.hash,
			hashLen = hashByteLength(hashName),
			keyLen = this.cipherConfig.keyLen,
			ivLen = this.cipherConfig.ivLen,
			sharedSecret = await deriveSharedSecret(this.ecdhKeyPair.privateKey, serverHello.keyShare.key, groupName),
			earlySecret = await hkdfExtract(hashName, null, new Uint8Array(hashLen)),
			derivedSecret = await hkdfExpandLabel(hashName, earlySecret, "derived", await digestBytes(hashName, EMPTY_BYTES), hashLen);
		this.handshakeSecret = await hkdfExtract(hashName, derivedSecret, sharedSecret);
		const transcriptHash = await digestBytes(hashName, this.transcript()),
			clientHandshakeTrafficSecret = await hkdfExpandLabel(hashName, this.handshakeSecret, "c hs traffic", transcriptHash, hashLen),
			serverHandshakeTrafficSecret = await hkdfExpandLabel(hashName, this.handshakeSecret, "s hs traffic", transcriptHash, hashLen);
		[this.clientHandshakeKey, this.clientHandshakeIv] = await deriveTrafficKeys(hashName, clientHandshakeTrafficSecret, keyLen, ivLen), [this.serverHandshakeKey, this.serverHandshakeIv] = await deriveTrafficKeys(hashName, serverHandshakeTrafficSecret, keyLen, ivLen);
		if (!this.cipherConfig.chacha) [this.clientHandshakeCryptoKey, this.serverHandshakeCryptoKey] = await Promise.all([importAesGcmKey(this.clientHandshakeKey, ["encrypt"]), importAesGcmKey(this.serverHandshakeKey, ["decrypt"])]);
		const serverFinishedKey = await hkdfExpandLabel(hashName, serverHandshakeTrafficSecret, "finished", EMPTY_BYTES, hashLen);
		let serverFinishedReceived = !1;
		const handleHandshakeMessage = async message => {
			switch (message.type) {
				case HANDSHAKE_TYPE_ENCRYPTED_EXTENSIONS: {
					const encryptedExtensions = parseEncryptedExtensions(message.body);
					encryptedExtensions.alpn && (this.negotiatedAlpn = encryptedExtensions.alpn), this.recordHandshake(message.raw);
					break
				}
				case HANDSHAKE_TYPE_CERTIFICATE: {
					const certificate = extractLeafCertificate(message.body);
					if (!certificate) throw new Error("Missing TLS 1.3 certificate");
					await this.acceptCertificate(certificate), this.recordHandshake(message.raw);
					break
				}
				case HANDSHAKE_TYPE_CERTIFICATE_REQUEST:
					throw new Error("Client certificate is not supported");
				case HANDSHAKE_TYPE_CERTIFICATE_VERIFY:
					this.recordHandshake(message.raw);
					break;
				case HANDSHAKE_TYPE_FINISHED: {
					const expectedVerifyData = await hmac(hashName, serverFinishedKey, await digestBytes(hashName, this.transcript()));
					if (!constantTimeEqual(expectedVerifyData, message.body)) throw new Error("TLS 1.3 server Finished verify failed");
					this.recordHandshake(message.raw), serverFinishedReceived = !0;
					break
				}
				default:
					this.recordHandshake(message.raw)
			}
		};
		await this.readRecordsUntil(reader, (async record => {
			if (record.type === CONTENT_TYPE_CHANGE_CIPHER_SPEC || record.type === CONTENT_TYPE_HANDSHAKE) return;
			if (record.type === CONTENT_TYPE_ALERT) {
				if (shouldIgnoreTlsAlert(record.fragment)) return;
				throw new Error(`TLS Alert: ${record.fragment[1]}`);
			}
			if (record.type !== CONTENT_TYPE_APPLICATION_DATA) return;
			const decrypted = await this.decryptTls13Handshake(record.fragment),
				innerType = decrypted[decrypted.length - 1],
				plaintext = decrypted.slice(0, -1);
			if (innerType === CONTENT_TYPE_HANDSHAKE) {
				this.handshakeParser.feed(plaintext);
				for (let message; message = this.handshakeParser.next();)
					if (await handleHandshakeMessage(message), serverFinishedReceived) return 1
			}
		}), "Connection closed during TLS 1.3 handshake");
		const applicationTranscriptHash = await digestBytes(hashName, this.transcript()),
			masterDerivedSecret = await hkdfExpandLabel(hashName, this.handshakeSecret, "derived", await digestBytes(hashName, EMPTY_BYTES), hashLen),
			masterSecret = await hkdfExtract(hashName, masterDerivedSecret, new Uint8Array(hashLen)),
			clientAppTrafficSecret = await hkdfExpandLabel(hashName, masterSecret, "c ap traffic", applicationTranscriptHash, hashLen),
			serverAppTrafficSecret = await hkdfExpandLabel(hashName, masterSecret, "s ap traffic", applicationTranscriptHash, hashLen);
		[this.clientAppKey, this.clientAppIv] = await deriveTrafficKeys(hashName, clientAppTrafficSecret, keyLen, ivLen), [this.serverAppKey, this.serverAppIv] = await deriveTrafficKeys(hashName, serverAppTrafficSecret, keyLen, ivLen);
		if (!this.cipherConfig.chacha) [this.clientAppCryptoKey, this.serverAppCryptoKey] = await Promise.all([importAesGcmKey(this.clientAppKey, ["encrypt"]), importAesGcmKey(this.serverAppKey, ["decrypt"])]);
		const clientFinishedKey = await hkdfExpandLabel(hashName, clientHandshakeTrafficSecret, "finished", EMPTY_BYTES, hashLen),
			clientFinishedVerifyData = await hmac(hashName, clientFinishedKey, await digestBytes(hashName, this.transcript())),
			clientFinishedMessage = buildHandshakeMessage(HANDSHAKE_TYPE_FINISHED, clientFinishedVerifyData);
		this.recordHandshake(clientFinishedMessage), await writer.write(buildTlsRecord(CONTENT_TYPE_APPLICATION_DATA, await this.encryptTls13Handshake(concatBytes(clientFinishedMessage, [CONTENT_TYPE_HANDSHAKE])))), this.clientSeqNum = 0n, this.serverSeqNum = 0n
	}
	async encryptTls12(plaintext, contentType) {
		const sequenceNumber = this.clientSeqNum++,
			sequenceBytes = uint64be(sequenceNumber),
			additionalData = concatBytes(sequenceBytes, [contentType], uint16be(TLS_VERSION_12), uint16be(plaintext.length));
		if (this.cipherConfig.chacha) {
			const nonce = xorSequenceIntoIv(this.clientWriteIv, sequenceNumber);
			return chacha20Poly1305Encrypt(this.clientWriteKey, nonce, plaintext, additionalData)
		}
		const explicitNonce = randomBytes(8);
		if (!this.clientWriteCryptoKey) this.clientWriteCryptoKey = await importAesGcmKey(this.clientWriteKey, ["encrypt"]);
		return concatBytes(explicitNonce, await aesGcmEncryptWithKey(this.clientWriteCryptoKey, concatBytes(this.clientWriteIv, explicitNonce), plaintext, additionalData))
	}
	async decryptTls12(ciphertext, contentType) {
		const sequenceNumber = this.serverSeqNum++,
			sequenceBytes = uint64be(sequenceNumber);
		if (this.cipherConfig.chacha) {
			const nonce = xorSequenceIntoIv(this.serverWriteIv, sequenceNumber);
			return chacha20Poly1305Decrypt(this.serverWriteKey, nonce, ciphertext, concatBytes(sequenceBytes, [contentType], uint16be(TLS_VERSION_12), uint16be(ciphertext.length - 16)))
		}
		const explicitNonce = ciphertext.subarray(0, 8),
			encryptedData = ciphertext.subarray(8);
		if (!this.serverWriteCryptoKey) this.serverWriteCryptoKey = await importAesGcmKey(this.serverWriteKey, ["decrypt"]);
		return aesGcmDecryptWithKey(this.serverWriteCryptoKey, concatBytes(this.serverWriteIv, explicitNonce), encryptedData, concatBytes(sequenceBytes, [contentType], uint16be(TLS_VERSION_12), uint16be(encryptedData.length - 16)))
	}
	async encryptTls13Handshake(plaintext) {
		const nonce = xorSequenceIntoIv(this.clientHandshakeIv, this.clientSeqNum++),
			additionalData = tlsBytes(CONTENT_TYPE_APPLICATION_DATA, 3, 3, uint16be(plaintext.length + 16));
		if (this.cipherConfig.chacha) return chacha20Poly1305Encrypt(this.clientHandshakeKey, nonce, plaintext, additionalData);
		if (!this.clientHandshakeCryptoKey) this.clientHandshakeCryptoKey = await importAesGcmKey(this.clientHandshakeKey, ["encrypt"]);
		return aesGcmEncryptWithKey(this.clientHandshakeCryptoKey, nonce, plaintext, additionalData)
	}
	async decryptTls13Handshake(ciphertext) {
		const nonce = xorSequenceIntoIv(this.serverHandshakeIv, this.serverSeqNum++),
			additionalData = tlsBytes(CONTENT_TYPE_APPLICATION_DATA, 3, 3, uint16be(ciphertext.length));
		const decrypted = this.cipherConfig.chacha ? await chacha20Poly1305Decrypt(this.serverHandshakeKey, nonce, ciphertext, additionalData) : await aesGcmDecryptWithKey(this.serverHandshakeCryptoKey || (this.serverHandshakeCryptoKey = await importAesGcmKey(this.serverHandshakeKey, ["decrypt"])), nonce, ciphertext, additionalData);
		let innerTypeIndex = decrypted.length - 1;
		for (; innerTypeIndex >= 0 && !decrypted[innerTypeIndex];) innerTypeIndex--;
		return innerTypeIndex < 0 ? EMPTY_BYTES : decrypted.slice(0, innerTypeIndex + 1)
	}
	async encryptTls13(data) {
		const plaintext = concatBytes(data, [CONTENT_TYPE_APPLICATION_DATA]),
			nonce = xorSequenceIntoIv(this.clientAppIv, this.clientSeqNum++),
			additionalData = tlsBytes(CONTENT_TYPE_APPLICATION_DATA, 3, 3, uint16be(plaintext.length + 16));
		if (this.cipherConfig.chacha) return chacha20Poly1305Encrypt(this.clientAppKey, nonce, plaintext, additionalData);
		if (!this.clientAppCryptoKey) this.clientAppCryptoKey = await importAesGcmKey(this.clientAppKey, ["encrypt"]);
		return aesGcmEncryptWithKey(this.clientAppCryptoKey, nonce, plaintext, additionalData)
	}
	async decryptTls13(ciphertext) {
		const nonce = xorSequenceIntoIv(this.serverAppIv, this.serverSeqNum++),
			additionalData = tlsBytes(CONTENT_TYPE_APPLICATION_DATA, 3, 3, uint16be(ciphertext.length)),
			plaintext = this.cipherConfig.chacha ? await chacha20Poly1305Decrypt(this.serverAppKey, nonce, ciphertext, additionalData) : await aesGcmDecryptWithKey(this.serverAppCryptoKey || (this.serverAppCryptoKey = await importAesGcmKey(this.serverAppKey, ["decrypt"])), nonce, ciphertext, additionalData);
		let innerTypeIndex = plaintext.length - 1;
		for (; innerTypeIndex >= 0 && !plaintext[innerTypeIndex];) innerTypeIndex--;
		if (innerTypeIndex < 0) return {
			data: EMPTY_BYTES,
			type: 0
		};
		return {
			data: plaintext.slice(0, innerTypeIndex),
			type: plaintext[innerTypeIndex]
		}
	}
	async write(data) {
		if (!this.handshakeComplete) throw new Error("Handshake not complete");
		const plaintext = toBytes(data);
		if (!plaintext.byteLength) return;
		const writer = this.socket.writable.getWriter();
		try {
			const records = [];
			for (let offset = 0; offset < plaintext.byteLength; offset += TLS_MAX_PLAINTEXT_FRAGMENT) {
				const chunk = plaintext.subarray(offset, Math.min(offset + TLS_MAX_PLAINTEXT_FRAGMENT, plaintext.byteLength));
				const encrypted = this.isTls13 ? await this.encryptTls13(chunk) : await this.encryptTls12(chunk, CONTENT_TYPE_APPLICATION_DATA);
				records.push(buildTlsRecord(CONTENT_TYPE_APPLICATION_DATA, encrypted));
			}
			await writer.write(records.length === 1 ? records[0] : concatBytes(...records))
		} finally {
			writer.releaseLock()
		}
	}
	async read() {
		for (; ;) {
			let record;
			for (; record = this.recordParser.next();) {
				if (record.type === CONTENT_TYPE_ALERT) {
					if (record.fragment[1] === ALERT_CLOSE_NOTIFY) return null;
					throw new Error(`TLS Alert: ${record.fragment[1]}`)
				}
				if (record.type !== CONTENT_TYPE_APPLICATION_DATA) continue;
				if (!this.isTls13) return this.decryptTls12(record.fragment, CONTENT_TYPE_APPLICATION_DATA);
				const { data, type } = await this.decryptTls13(record.fragment);
				if (type === CONTENT_TYPE_APPLICATION_DATA) return data;
				if (type === CONTENT_TYPE_ALERT) {
					if (data[1] === ALERT_CLOSE_NOTIFY) return null;
					throw new Error(`TLS Alert: ${data[1]}`)
				}
				if (type !== CONTENT_TYPE_HANDSHAKE) continue;
				let message;
				for (this.handshakeParser.feed(data); message = this.handshakeParser.next();)
					if (message.type !== HANDSHAKE_TYPE_NEW_SESSION_TICKET && message.type === HANDSHAKE_TYPE_KEY_UPDATE) throw new Error("TLS 1.3 KeyUpdate is not supported by TLSClientMini")
			}
			const reader = this.socket.readable.getReader();
			try {
				const { value, done } = await this.readChunk(reader);
				if (done) return null;
				this.recordParser.feed(value)
			} finally {
				reader.releaseLock()
			}
		}
	}
	close() { this.socket.close() }
}


// ====== src/stream/connect-streams.js ======
// stream/connect-streams.js — 双向管道桥接
// 对应原文件: connectStreams (行 2447-2486)


async function connectStreams(remoteSocket, webSocket, headerData, retryFunc) {
  let header = headerData;
  let hasData = false;
  let reader;
  let useBYOB = false;
  const BYOB_MAX = 64 * 1024;
  const sender = createGrainSender(webSocket, header);
  header = null;

  try { reader = remoteSocket.readable.getReader({ mode: 'byob' }); useBYOB = true; }
  catch (_) { reader = remoteSocket.readable.getReader(); }

  try {
    if (!useBYOB) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || value.byteLength === 0) continue;
        hasData = true;
        await sender.send(value);
      }
    } else {
      let buf = new ArrayBuffer(BYOB_MAX);
      while (true) {
        const { done, value } = await reader.read(new Uint8Array(buf, 0, BYOB_MAX));
        if (done) break;
        if (!value || value.byteLength === 0) continue;
        hasData = true;
        if (value.byteLength >= 32 * 1024) {
          await sender.flush();
          await sender.sendDirect(value);
          buf = new ArrayBuffer(BYOB_MAX);
        } else {
          await sender.send(value);
          buf = value.buffer.byteLength >= BYOB_MAX ? value.buffer : new ArrayBuffer(BYOB_MAX);
        }
      }
    }
    await sender.flush();
  } catch (_) {
    closeSocketQuietly(webSocket);
  } finally {
    try { reader.cancel(); } catch (_) {}
    try { reader.releaseLock(); } catch (_) {}
  }
  if (!hasData && retryFunc) await retryFunc();
}

// ====== src/stream/grain-sender.js ======
// stream/grain-sender.js — 下行 Grain 发送器（尾部阈值 + 微任务调度）
// 对应原文件: 创建下行Grain发送器 (行 2342-2445)


function createGrainSender(webSocket, headerData = null) {
  const packetCap = DOWNSTREAM_GRAIN_PACKET;
  const tailBytes = DOWNSTREAM_GRAIN_TAIL_THRESHOLD;
  const lowWaterBytes = Math.max(4096, tailBytes << 3);
  let header = headerData;
  let pendingBuffer = new Uint8Array(packetCap);
  let pendingBytes = 0;
  let flushTimer = null;
  let microtaskQueued = false;
  let generation = 0;
  let scheduledGeneration = 0;
  let waitRounds = 0;
  let flushPromise = null;

  const sendRaw = async (chunk) => {
    if (webSocket.readyState !== 1 /* OPEN */) throw new Error('ws not open');
    await wsSend(webSocket, chunk);
  };

  const attachHeader = (chunk) => {
    if (!header) return chunk;
    const merged = new Uint8Array(header.length + chunk.byteLength);
    merged.set(header, 0);
    merged.set(chunk, header.length);
    header = null;
    return merged;
  };

  const flush = async () => {
    while (flushPromise) await flushPromise;
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = null;
    microtaskQueued = false;
    if (!pendingBytes) return;
    const output = pendingBuffer.subarray(0, pendingBytes).slice();
    pendingBuffer = new Uint8Array(packetCap);
    pendingBytes = 0;
    waitRounds = 0;
    flushPromise = sendRaw(output).finally(() => { flushPromise = null; });
    return flushPromise;
  };

  const scheduleFlush = () => {
    if (flushTimer || microtaskQueued) return;
    microtaskQueued = true;
    scheduledGeneration = generation;
    queueMicrotask(() => {
      microtaskQueued = false;
      if (!pendingBytes || flushTimer) return;
      if (packetCap - pendingBytes < tailBytes) {
        flush().catch(() => closeSocketQuietly(webSocket));
        return;
      }
      flushTimer = setTimeout(() => {
        flushTimer = null;
        if (!pendingBytes) return;
        if (packetCap - pendingBytes < tailBytes) {
          flush().catch(() => closeSocketQuietly(webSocket));
          return;
        }
        if (waitRounds < 2 && (generation !== scheduledGeneration || pendingBytes < lowWaterBytes)) {
          waitRounds++;
          scheduledGeneration = generation;
          scheduleFlush();
          return;
        }
        flush().catch(() => closeSocketQuietly(webSocket));
      }, Math.max(DOWNSTREAM_GRAIN_SILENCE_MS, 1));
    });
  };

  return {
    async sendDirect(data) {
      let chunk = toBytes(data);
      if (!chunk.byteLength) return;
      chunk = attachHeader(chunk);
      await sendRaw(chunk);
    },
    async send(data) {
      let chunk = toBytes(data);
      if (!chunk.byteLength) return;
      chunk = attachHeader(chunk);
      let offset = 0;
      const total = chunk.byteLength;
      while (offset < total) {
        if (!pendingBytes && total - offset >= packetCap) {
          const n = Math.min(packetCap, total - offset);
          await sendRaw(offset === 0 && n === total ? chunk : chunk.subarray(offset, offset + n));
          offset += n;
          continue;
        }
        const copy = Math.min(packetCap - pendingBytes, total - offset);
        pendingBuffer.set(chunk.subarray(offset, offset + copy), pendingBytes);
        pendingBytes += copy;
        offset += copy;
        generation++;
        if (pendingBytes === packetCap || packetCap - pendingBytes < tailBytes) await flush();
        else scheduleFlush();
      }
    },
    flush,
  };
}