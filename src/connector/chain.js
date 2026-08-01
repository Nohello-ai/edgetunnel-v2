/**
 * 连接器链。
 *
 * 按反代模式选择连接策略。
 *  - proxyip：直连 → ProxyIP 降级
 *  - socks5：全局模式走代理，否则直连 → 代理降级
 *  - auto：自动检测，目标为 Cloudflare 则走反代，否则直连
 */
import { socks5Connect } from './socks5.js';
import { httpConnect } from './http.js';
import { proxyIPConnect } from './proxyip.js';
import { isCloudflareIP } from '../net/ip-pool.js';

/**
 * 创建带反代策略的连接器。
 *
 * @param {Function} directConnect - 直连 TCP 连接函数
 * @param {object} proxyConfig - 反代配置
 * @returns {Function} connect({ hostname, port }) → socket
 */
export function createFallbackConnector(directConnect, proxyConfig) {
  const mode = proxyConfig?.模式;

  return {
    connect: async function connect(target) {
      // auto 模式：检测目标是否在 Cloudflare 上
      if (mode === 'auto') {
        if (isCloudflareIP(target.hostname)) return proxyConnect(directConnect, target, proxyConfig);
        const socket = directConnect.connect(target);
        if (socket.opened) await socket.opened;
        return socket;
      }

      // socks5 全局模式：不走直连，直接走代理
      if (mode === 'socks5' && proxyConfig?.SOCKS5?.全局) {
        return proxyConnect(directConnect, target, proxyConfig);
      }

      // 其他模式：先直连，失败走反代
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
        return proxyConnect(directConnect, target, proxyConfig);
      }
    },
  };
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

async function proxyConnect(directConnect, target, proxyConfig) {
  const errors = [];

  // SOCKS5/HTTP/HTTPS 代理
  const socksConfig = proxyConfig?.SOCKS5;
  if (socksConfig?.启用) {
    try {
      const addr = parseAccount(socksConfig.账号);
      const socket = directConnect.connect({ hostname: addr.hostname || '127.0.0.1', port: addr.port || 1080 });
      if (socket.opened) await socket.opened;
      const type = socksConfig.启用;
      if (type === 'socks5') await socks5Connect(socket, target, addr);
      else if (type === 'http') await httpConnect(socket, target, addr, false);
      else if (type === 'https') await httpConnect(socket, target, addr, true);
      return socket;
    } catch (err) {
      errors.push(`${socksConfig.启用}: ${err.message}`);
    }
  }

  // ProxyIP
  const proxyIP = proxyConfig?.PROXYIP;
  if (proxyIP && proxyIP !== 'none') {
    try {
      return await proxyIPConnect(directConnect, target, proxyIP);
    } catch (err) {
      errors.push(`proxyip: ${err.message}`);
    }
  }

  throw new Error(`Proxy failed: ${errors.join('; ')}`);
}