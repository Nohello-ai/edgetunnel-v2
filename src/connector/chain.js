/**
 * 连接器链。
 *
 * 按反代模式选择连接策略。
 *  - proxyip：直连 → ProxyIP 降级
 *  - socks5：直连 → SOCKS5/HTTP/HTTPS 降级
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

  return async function connect(target) {
    // auto 模式：检测目标是否在 Cloudflare 上
    if (mode === 'auto') {
      const isCF = isCloudflareIP(target.hostname);
      if (isCF) {
        // 同源，走反代跳板
        return proxyConnect(directConnect, target, proxyConfig);
      }
      // 非同源，直连
      const socket = directConnect(target);
      if (socket.opened) await socket.opened;
      return socket;
    }

    // proxyip 或 socks5 模式：先直连，失败走反代
    try {
      const socket = directConnect(target);
      if (socket.opened) {
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('DIRECT_TIMEOUT')), 5000));
        await Promise.race([socket.opened, timeout]);
      }
      return socket;
    } catch {
      return proxyConnect(directConnect, target, proxyConfig);
    }
  };
}

async function proxyConnect(directConnect, target, proxyConfig) {
  const errors = [];

  // SOCKS5/HTTP/HTTPS 代理
  const socksConfig = proxyConfig?.SOCKS5;
  if (socksConfig?.启用) {
    try {
      const addr = typeof socksConfig.账号 === 'object' ? socksConfig.账号 : {};
      const socket = directConnect({ hostname: addr.hostname || '127.0.0.1', port: addr.port || 1080 });
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