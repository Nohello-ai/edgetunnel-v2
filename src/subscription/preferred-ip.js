// subscription/preferred-ip.js — 优选IP生成 & 优选API请求
// 功能：本地随机IP生成、远程优选API请求、反代IP轮询
// 按照运营商(ct/cu/cmcc/cf)从远程IP库获取并随机选择

import { detectISP } from '../utils.js';
import { FINGERPRINT_DICT } from '../context.js';

// 运营商远程IP库基础URL
const ISP_IP_BASE = 'https://raw.githubusercontent.com/' + FINGERPRINT_DICT[1] + '/cf-cdn-ip/refs/heads/master/';

/**
 * 从远程运营商IP库生成随机优选IP
 * @param {Request} request - Cloudflare Worker request
 * @param {number} count - 生成的IP数量，默认16
 * @param {number} port - 指定端口，-1表示使用默认端口
 * @returns {Promise<[string, string]>} [ipv4列表(换行分隔), ipv6列表(换行分隔)]
 */
export async function generateRandomIP(request, count = 16, port = -1) {
  const url = new URL(request.url);
  const ispParam = String(url.searchParams.get('cnIspCode') || '').toLowerCase();
  const isp = (['ct', 'cu', 'cmcc', 'cf'].includes(ispParam) ? ispParam : null) || detectISP(request) || 'cf';

  const portStr = port > 0 ? ':' + port : '';

  try {
    // 并发获取 IPv4 和 IPv6 列表
    const [v4Resp, v6Resp] = await Promise.all([
      fetch(ISP_IP_BASE + isp + '.txt').catch(() => null),
      fetch(ISP_IP_BASE + isp + '6.txt').catch(() => null),
    ]);

    const v4Text = v4Resp?.ok ? await v4Resp.text() : '';
    const v6Text = v6Resp?.ok ? await v6Resp.text() : '';

    const v4Lines = v4Text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    const v6Lines = v6Text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));

    const pickRandom = (arr, n) => {
      const shuffled = [...arr].sort(() => Math.random() - 0.5);
      return shuffled.slice(0, n).map(ip => ip + portStr);
    };

    const v4Result = pickRandom(v4Lines, count).join('\n');
    const v6Result = pickRandom(v6Lines, count).join('\n');

    return [v4Result, v6Result];
  } catch (_) {
    return ['', ''];
  }
}

/**
 * 请求远程优选API获取测速后的IP列表
 * @param {string[]} urls - 优选API的URL列表
 * @param {string} port - 默认端口
 * @param {number} timeout - 超时毫秒
 * @returns {Promise<[string[], string[], string[], string[]]>}
 *   [IPv4列表, IPv6列表, 反代IP池, 订阅链接明文LINK]
 */
export async function requestPreferredAPI(urls, port = '443', timeout = 3000) {
  if (!urls || urls.length === 0) return [[], [], [], []];

  const results = new Set();
  const proxyIPSet = new Set();
  let plainLinkContent = '';
  const subUrls = [];

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  const fetchPromises = urls.map(async (u) => {
    try {
      const resp = await fetch(u, { signal: controller.signal });
      const text = await resp.text();

      if (resp.headers.get('content-type')?.includes('text/plain') || text.includes('://')) {
        // 可能是订阅链接
        if (text.includes('://')) {
          subUrls.push(u);
          plainLinkContent += text + '\n';
        }
      }

      // 解析IP行（格式：ip:port#remark）
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        // 匹配 IP:端口 格式
        if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+/.test(trimmed)
            || /^\[?[0-9a-f:]+]?:\d+/i.test(trimmed)) {
          results.add(trimmed);
        }
        // 匹配反代IP格式
        if (trimmed.includes('.' + FINGERPRINT_DICT[1] + 'SsSs.nEt')) {
          proxyIPSet.add(trimmed);
        }
      }
    } catch (_) {
      // 单个URL失败不影响其他
    }
  });

  await Promise.allSettled(fetchPromises);
  clearTimeout(timeoutId);

  const all = [...results];
  const ipv4 = all.filter(ip => /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+/.test(ip));
  const ipv6 = all.filter(ip => ip.includes(':') && !ip.startsWith('[') && !/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(ip));

  return [ipv4, ipv6, [...proxyIPSet], subUrls];
}

/**
 * 获取下一个反代IP（轮询）
 * @param {object} ctx_ - 请求上下文
 * @returns {string}
 */
export function getNextProxyIP(ctx_) {
  if (!ctx_.cachedProxyIPArray || ctx_.cachedProxyIPArray.length === 0) {
    return ctx_.proxyIP;
  }
  const ip = ctx_.cachedProxyIPArray[ctx_.cachedProxyIPIndex % ctx_.cachedProxyIPArray.length];
  ctx_.cachedProxyIPIndex = (ctx_.cachedProxyIPIndex + 1) % ctx_.cachedProxyIPArray.length;
  return ip;
}