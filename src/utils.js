// ============================================================
// utils.js — 通用工具函数
// 对应原文件多处散布的工具函数
// ============================================================

// --- 数据类型转换 ---

/** 将任意数据转为 Uint8Array */
export function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return new Uint8Array(data || 0);
}

/** 计算有效数据长度 */
export function dataLength(data) {
  if (!data) return 0;
  if (typeof data.byteLength === 'number') return data.byteLength;
  if (typeof data.length === 'number') return data.length;
  return 0;
}

/** 拼接多个字节块 */
export function concatBytes(...chunks) {
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

export function isIPv4(value) {
  const parts = String(value || '').split('.');
  return parts.length === 4 && parts.every(p => /^\d{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255);
}

export function stripIPv6Brackets(hostname = '') {
  const host = String(hostname || '').trim();
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

export function isIPHostname(hostname = '') {
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
export async function md5md5(text) {
  const encoder = new TextEncoder();
  const first = await crypto.subtle.digest('MD5', encoder.encode(text));
  const second = await crypto.subtle.digest('MD5', first);
  return [...new Uint8Array(second)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** SHA-224（纯 JS 同步实现，与原文件完全一致） */
export function sha224str(s) {
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
export function base64SecretEncode(plaintext, secret) {
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
export function replaceStars(str) {
  if (typeof str !== 'string' || !str.includes('*')) return str;
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return str.replace(/\*/g, () => chars[Math.floor(Math.random() * chars.length)]);
}

/** 生成随机子路径 */
export function randomPath(fullPath = '/') {
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
export async function splitToArray(input) {
  if (!input) return [];
  if (Array.isArray(input)) return input;
  const str = String(input);
  if (str.includes('\n')) return str.split('\n').map(s => s.trim()).filter(Boolean);
  if (str.includes(',')) return str.split(',').map(s => s.trim()).filter(Boolean);
  return [str.trim()].filter(Boolean);
}

// --- 日志 ---

/** 调试日志（DEBUG=true 时打印） */
export function log(debug, ...args) {
  // 由调用方传入 debug 标志；这里简单打印所有参数
  if (debug) console.log(...args);
}

// --- 运营商识别 ---

export function detectISP(request) {
  const asn = request?.cf?.asn;
  if (asn === 56044 || asn === 56046 || asn === 56047 || asn === 24547 || asn === 56040) return 'cmcc';
  return '';
}

// --- 超时封装 ---

export async function withTimeout(promise, timeoutMs, message = 'timeout') {
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

export function closeSocketQuietly(socket) {
  try {
    if (socket.readyState === 1 /* OPEN */ || socket.readyState === 2 /* CLOSING */) {
      socket.close();
    }
  } catch (_) {}
}

// --- WebSocket 发送并等待 ---

export async function wsSend(webSocket, payload) {
  const result = webSocket.send(payload);
  if (result && typeof result.then === 'function') await result;
}

// --- ID 格式化 ---

export function formatUUID(arr, offset = 0) {
  const hex = [...arr.slice(offset, offset + 16)].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// --- 传输协议配置 ---

export function getTransportConfig(config = {}) {
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

export function getTransportPathValue(config = {}, nodePath = '/', isSubGenerator = false) {
  const pathValue = isSubGenerator ? '/' : (config.随机路径 ? randomPath(nodePath) : nodePath);
  if (config.传输协议 !== 'grpc') return pathValue;
  return pathValue.split('?')[0] || '/';
}