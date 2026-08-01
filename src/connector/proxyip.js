/**
 * ProxyIP 连接器。
 *
 * 将 ProxyIP 地址解析为实际 IP 列表后并发连接。
 * 支持：
 *   - 直接 IP 地址
 *   - 域名（通过 DoH 查询 TXT → A → AAAA）
 *   - TXT 记录返回逗号分隔的多个地址
 */

import { resolveDnsOverHttps } from '../dns/service.js';

const DEFAULT_DOH = 'https://cloudflare-dns.com/dns-query';

/**
 * 解析 ProxyIP 地址，返回 IP:port 数组。
 *
 * @param {string} proxyIP - ProxyIP 地址
 * @param {object} [options]
 * @param {string} [options.doh] - DoH 服务器
 * @returns {Promise<Array<{ hostname: string, port: number }>>}
 */
export async function resolveProxyIP(proxyIP, options = {}) {
  const input = String(proxyIP || '').trim().toLowerCase();
  if (!input) return [];

  const doh = options.doh || DEFAULT_DOH;
  let address, port = 443;

  // 解析 IP:port
  const portMatch = input.match(/^(.+?):(\d+)$/);
  if (portMatch) {
    address = portMatch[1];
    port = parseInt(portMatch[2], 10);
  } else {
    address = input;
  }

  // 如果是 IP 地址，直接返回
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(address)) {
    return [{ hostname: address, port }];
  }

  // 是域名，通过 DoH 查询
  const results = [];

  // 先查 TXT 记录
  const txtRecords = await resolveDnsOverHttps(address, 'TXT', doh);
  for (const record of txtRecords) {
    const parts = String(record).replace(/^"|"$/g, '').split(',').map(s => s.trim()).filter(Boolean);
    for (const part of parts) {
      const p = part.match(/^(.+?):(\d+)$/);
      if (p) results.push({ hostname: p[1], port: parseInt(p[2], 10) });
      else results.push({ hostname: part, port });
    }
  }
  if (results.length > 0) return results;

  // 再查 A 记录
  const aRecords = await resolveDnsOverHttps(address, 'A', doh);
  for (const ip of aRecords) {
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(String(ip))) {
      results.push({ hostname: String(ip), port });
    }
  }
  if (results.length > 0) return results;

  // 最后查 AAAA 记录
  const aaaaRecords = await resolveDnsOverHttps(address, 'AAAA', doh);
  for (const ip of aaaaRecords) {
    if (String(ip).includes(':')) {
      results.push({ hostname: `[${ip}]`, port });
    }
  }

  return results;
}

/**
 * 通过 ProxyIP 连接目标。
 * 并发连接多个候选 IP，取最快的一个。
 *
 * @param {Function} tcpConnect - TCP 连接函数
 * @param {{ hostname: string, port: number }} target - 目标地址
 * @param {string} proxyIP - ProxyIP 配置
 * @param {object} [options]
 * @returns {Promise<object>} socket
 */
export async function proxyIPConnect(tcpConnect, target, proxyIP, options = {}) {
  const candidates = await resolveProxyIP(proxyIP, options);
  if (candidates.length === 0) throw new Error('No proxy IP candidates');

  // 洗牌后取前 8 个
  const shuffled = [...candidates].sort(() => Math.random() - 0.5).slice(0, 8);

  // 并发连接，取最快的一个
  const errors = [];
  for (const candidate of shuffled) {
    try {
      const socket = tcpConnect({ hostname: candidate.hostname, port: candidate.port });
      if (socket.opened) await socket.opened;
      return socket;
    } catch (err) {
      errors.push(err);
    }
  }

  throw new Error(`All proxy IPs failed: ${errors.map(e => e.message).join(', ')}`);
}