// proxy/proxy-config.js — Proxy parameter parsing from URL
// Extracted from original: 反代参数获取 (line 5481+)
import { splitToArray, log } from '../utils.js';
import { DEFAULT_SOCKS5_WHITELIST } from '../context.js';

/** Default proxy ports */
const DEFAULT_PORTS = { socks5: 1080, http: 80, https: 443, turn: 3478, sstp: 443 };

/**
 * Parse proxy config from URL search params and env.
 * Sets global proxy state on the context object.
 */
export async function parseProxyConfig(url, userID, env, ctx) {
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
export function parseProxyAddress(raw, defaultPort) {
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