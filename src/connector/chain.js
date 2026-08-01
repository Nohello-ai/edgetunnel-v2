/**
 * 连接器链。
 *
 * 按顺序尝试多个连接策略，返回第一个成功的连接。
 * 用于：直连 → SOCKS5 → ProxyIP 的降级逻辑。
 */
import { socks5Connect } from './socks5.js';
import { httpConnect } from './http.js';
import { proxyIPConnect } from './proxyip.js';

/**
 * 创建带反代降级的连接器。
 *
 * @param {Function} directConnect - 直连 TCP 连接函数
 * @param {object} proxyConfig - 反代配置
 * @returns {Function} connect({ hostname, port }) → socket
 */
export function createFallbackConnector(directConnect, proxyConfig) {
  return async function connect(target) {
    const errors = [];

    // 1. 尝试直连
    try {
      const socket = directConnect(target);
      if (socket.opened) {
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('DIRECT_TIMEOUT')), 5000));
        await Promise.race([socket.opened, timeout]);
      }
      return socket;
    } catch (err) {
      errors.push(`direct: ${err.message}`);
    }

    // 2. 尝试 SOCKS5/HTTP/HTTPS 代理
    const socksConfig = proxyConfig?.SOCKS5;
    if (socksConfig?.启用) {
      try {
        const socket = directConnect({
          hostname: socksConfig.账号?.hostname || socksConfig.账号,
          port: socksConfig.账号?.port || 1080,
        });
        if (socket.opened) await socket.opened;

        const type = socksConfig.启用;
        const credentials = socksConfig.账号 || {};
        if (type === 'socks5') await socks5Connect(socket, target, credentials);
        else if (type === 'http') await httpConnect(socket, target, credentials, false);
        else if (type === 'https') await httpConnect(socket, target, credentials, true);
        return socket;
      } catch (err) {
        errors.push(`${socksConfig.启用}: ${err.message}`);
      }
    }

    // 3. 尝试 ProxyIP
    const proxyIP = proxyConfig?.PROXYIP;
    if (proxyIP && proxyIP !== 'auto' && proxyIP !== 'none') {
      try {
        return await proxyIPConnect(directConnect, target, proxyIP);
      } catch (err) {
        errors.push(`proxyip: ${err.message}`);
      }
    }

    throw new Error(`All connections failed: ${errors.join('; ')}`);
  };
}