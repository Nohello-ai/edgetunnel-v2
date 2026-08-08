/**
 * 连接器链。
 *
 * 按反代模式选择连接策略。
 *  - proxyip：直连 → ProxyIP 降级
 *  - socks5：全局模式走代理，否则直连 → 代理降级
 *  - auto：自动检测，目标为 Cloudflare 则走反代，否则直连
 */
import { socks5Connect } from './socks5.js';
import { proxyIPConnect } from './proxyip.js';

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
    connect: async function connect(target, options = {}) {
      const tryDirect = async () => {
        const socket = directConnect.connect(target);
        if (socket.opened) {
          let timer;
          const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('DIRECT_TIMEOUT')), 5000); });
          await Promise.race([socket.opened, timeout]);
          clearTimeout(timer);
        }
        return socket;
      };

      // socks5 全局模式：所有流量直接走 SOCKS5(不试直连)
      if (mode === 'socks5' && proxyConfig?.SOCKS5?.全局) {
        return proxyConnect(directConnect, target, proxyConfig, options, 1);
      }

      // 其他模式：先直连(普通网站),失败(CF 拒 HTTP 服务/超时)→ 按模式走代理
      try {
        return await tryDirect();
      } catch {
        if (mode === 'proxyip') {
          // Proxy:只走内置反代池
          return proxyConnect(directConnect, target, proxyConfig, options, 2);
        }
        if (mode === 'socks5') {
          // SOCKS5 非全局:只 CF 流量走 SOCKS5
          return proxyConnect(directConnect, target, proxyConfig, options, 1);
        }
        // auto:有 SOCKS5 用 SOCKS5,没有则用 Proxy
        return proxyConnect(directConnect, target, proxyConfig, options, 0);
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

async function proxyConnect(directConnect, target, proxyConfig, options = {}, only = 0) {
  const errors = [];
  // only: 0=先 SOCKS5 再 Proxy, 1=只 SOCKS5, 2=只 Proxy
  const socksConfig = proxyConfig?.SOCKS5;
  const hasSocks = socksConfig?.账号 && String(socksConfig.账号).trim();
  if (hasSocks && only !== 2) {
    try {
      const addr = parseAccount(socksConfig.账号);
      const socket = directConnect.connect({ hostname: addr.hostname || '127.0.0.1', port: addr.port || 1080 });
      if (socket.opened) await socket.opened;
      await socks5Connect(socket, target, addr);
      return socket;
    } catch (err) {
      errors.push('socks5: ' + err.message);
    }
  }
  // ProxyIP(内置反代池)
  if (only !== 1) {
    const proxyIP = proxyConfig?.PROXYIP;
    if (proxyIP && proxyIP !== 'none') {
      try {
        return await proxyIPConnect(directConnect, target, proxyIP, options);
      } catch (err) {
        errors.push('proxyip: ' + err.message);
      }
    }
  }
  throw new Error('Proxy failed: ' + errors.join('; '));
}

