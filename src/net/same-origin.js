import { isCloudflareIP } from './ip-pool.js';
import { resolveDnsOverHttps } from '../dns/service.js';

const DEFAULT_DOH = 'https://cloudflare-dns.com/dns-query';

/**
 * 判断 hostname 是否是 IPv4/IPv6 地址（去掉方括号）。
 */
export function isIPAddress(hostname) {
  const h = String(hostname || '').replace(/^\[|\]$/g, '');
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  return h.includes(':') && /^[0-9a-fA-F:]+$/.test(h);
}

/**
 * 判断目标是否位于 Cloudflare 网络（同源）。
 *
 * 域名会先经 DoH 解析成 IP，再判断是否落在 Cloudflare 网段。
 * 解析失败或超时时返回 false（按非同源处理）。
 *
 * @param {string} hostname - 目标主机名（域名或 IP）
 * @returns {Promise<boolean>}
 */
export async function isSameOriginCloudflare(hostname) {
  const h = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (!h) return false;

  if (isIPAddress(h)) return isCloudflareIP(h);

  try {
    const [aRecords, aaaaRecords] = await Promise.all([
      resolveDnsOverHttps(h, 'A', DEFAULT_DOH),
      resolveDnsOverHttps(h, 'AAAA', DEFAULT_DOH),
    ]);
    const ips = [
      ...aRecords,
      ...aaaaRecords.map(ip => String(ip).replace(/^\[|\]$/g, '')),
    ];
    return ips.some(ip => isCloudflareIP(ip));
  } catch {
    return false;
  }
}
