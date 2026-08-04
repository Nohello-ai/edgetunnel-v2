import { socks5Connect } from './socks5.js';
import { httpConnect } from './http.js';
import { proxyIPConnect } from './proxyip.js';
import { isCloudflareIP } from '../net/ip-pool.js';

export function createFallbackConnector(directConnect, proxyConfig, options = {}) {
  const mode = proxyConfig?.模式;
  const colo = options.colo || '';

  return {
    connect: async function connect(target) {
      if (!mode) return directConnect.connect(target);

      // auto 模式：检测目标是否为 CF IP（仅对 IP 地址有效）
      if (mode === 'auto') {
        if (isCloudflareIP(target.hostname)) return proxyConnect(directConnect, target, proxyConfig, colo);
        return tryDirectWithFallback(directConnect, target, proxyConfig, colo);
      }

      // socks5/http 全局模式：不走直连，直接走代理
      if ((mode === 'socks5' || mode === 'http') && proxyConfig?.SOCKS5?.全局) {
        return proxyConnect(directConnect, target, proxyConfig, colo);
      }

      // 其他模式（proxyip / socks5 / http 非全局）：先直连，失败走反代
      return tryDirectWithFallback(directConnect, target, proxyConfig, colo);
    },
  };
}

async function tryDirectWithFallback(directConnect, target, proxyConfig, colo) {
  try {
    const socket = directConnect.connect(target);
    if (socket.opened) {
      let timer;
      const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('DIRECT_TIMEOUT')), 5000); });
      await Promise.race([socket.opened, timeout]);
      clearTimeout(timer);
    }
    return socket;
  } catch {
    return proxyConnect(directConnect, target, proxyConfig, colo);
  }
}

async function proxyConnect(directConnect, target, proxyConfig, colo) {
  const errors = [];

  // SOCKS5/HTTP 代理
  const socksConfig = proxyConfig?.SOCKS5;
  if (socksConfig?.启用) {
    try {
      const addr = parseAccount(socksConfig.账号);
      const socket = directConnect.connect({ hostname: addr.hostname || '127.0.0.1', port: addr.port || 1080 });
      if (socket.opened) await socket.opened;
      const type = socksConfig.启用;
      if (type === 'socks5') await socks5Connect(socket, target, addr);
      else if (type === 'http') await httpConnect(socket, target, addr, false);
      return socket;
    } catch (err) {
      errors.push(`${socksConfig.启用}: ${err.message}`);
    }
  }

  // ProxyIP
  const proxyIP = proxyConfig?.PROXYIP || 'auto';
  if (proxyIP && proxyIP !== 'none') {
    try {
      return await proxyIPConnect(directConnect, target, proxyIP, { colo });
    } catch (err) {
      errors.push(`proxyip: ${err.message}`);
    }
  }

  throw new Error(`Proxy failed: ${errors.join('; ')}`);
}

function parseAccount(text) {
  if (!text) return {};
  let username = '', password = '';
  const atIdx = text.lastIndexOf('@');
  if (atIdx !== -1) {
    const userPart = text.slice(0, atIdx);
    text = text.slice(atIdx + 1);
    const sep = userPart.indexOf(':');
    if (sep !== -1) { username = userPart.slice(0, sep); password = userPart.slice(sep + 1); }
    else { username = userPart; }
  }
  const [hostname, port] = text.split(':');
  return { hostname, port: port ? parseInt(port) : 1080, username, password };
}