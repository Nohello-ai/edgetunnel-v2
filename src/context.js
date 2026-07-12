// context.js — 请求上下文工厂（线程安全，替代原版全局变量）
// 原版行 1-16：全局变量 Version/反代IP/SOCKS5白名单 等

export const VERSION = '2026-06-17 01:41:21';
export const PAGES_STATIC = 'https://edt-pages.github.io';

// ---- 特征码字典（原版行 12-16） ----
export const FINGERPRINT_DICT = [
  (Proxy.name + 'IP').toUpperCase(),
  (String.fromCharCode(67, 109) + URL.name[2] + 'i' + URL.name[0]).toLowerCase(),
  String(2407 * 300 - 10).split('').reverse().join(''),
];

// ---- 常量（原版行 7-10） ----
export const WS_EARLY_DATA_MAX_BYTES = 8 * 1024;
export const WS_EARLY_DATA_MAX_HEADER_LEN = Math.ceil(WS_EARLY_DATA_MAX_BYTES * 4 / 3) + 4;
export const UPSTREAM_BUNDLE_TARGET = 16 * 1024;
export const UPSTREAM_QUEUE_MAX_BYTES = 16 * 1024 * 1024;
export const UPSTREAM_QUEUE_MAX_ITEMS = 4096;
export const DOWNSTREAM_GRAIN_PACKET = 32 * 1024;
export const DOWNSTREAM_GRAIN_TAIL_THRESHOLD = 512;
export const DOWNSTREAM_GRAIN_SILENCE_MS = 0;

// ---- SOCKS5 白名单（原版行 4） ----
export const DEFAULT_SOCKS5_WHITELIST = [
  '*tapecontent.net',
  '*cloudatacdn.com',
  '*loadshare.org',
  '*cdn-centaurus.com',
  'scholar.google.com',
];

// ---- 代理默认端口 ----
export const DEFAULT_PROXY_PORTS = {
  socks5: 1080, http: 80, https: 443, turn: 3478, sstp: 443,
};

// ---- 请求上下文 ----
export function createRequestContext(request, env, url) {
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