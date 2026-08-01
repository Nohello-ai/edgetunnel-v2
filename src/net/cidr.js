/**
 * CIDR 优选 IP 管理。
 *
 * 根据运营商从 cmliu 的社区仓库拉取对应 CIDR 段，
 * 内存缓存 1 小时，失败时使用内置兜底。
 */

const CACHE_TTL_MS = 3600_000;
const cache = new Map();

const GITHUB_RAW = 'https://raw.githubusercontent.com/cmliu/cmliu/main';

const FALLBACK_CIDRS = Object.freeze([
  '104.16.0.0/13',
  '172.64.0.0/13',
  '162.158.0.0/15',
  '198.41.128.0/17',
]);

const OPERATOR_FILE = Object.freeze({
  ct: 'CF-CIDR/ct.txt',
  cu: 'CF-CIDR/cu.txt',
  cmcc: 'CF-CIDR/cmcc.txt',
  cf: 'CF-CIDR.txt',
});

/**
 * 获取指定运营商的 CIDR 段列表。
 *
 * @param {'ct'|'cu'|'cmcc'|'cf'} operator
 * @param {object} [options]
 * @param {typeof fetch} [options.fetch] - 可注入的 fetch 实现，用于测试
 * @returns {Promise<string[]>} CIDR 字符串数组
 */
export async function getCIDRList(operator, options = {}) {
  const key = OPERATOR_FILE[operator];
  if (!key) return [...FALLBACK_CIDRS];

  const now = Date.now();
  const entry = cache.get(key);
  if (entry && now - entry.timestamp < CACHE_TTL_MS) return entry.cidrs;

  try {
    const fetcher = options.fetch || globalThis.fetch;
    const url = `${GITHUB_RAW}/${key}`;
    const res = await fetcher(url);

    if (!res.ok) return await useFallback(key, entry);

    const text = await res.text();
    const cidrs = parseCIDRText(text);
    if (cidrs.length === 0) return await useFallback(key, entry);

    cache.set(key, { cidrs, timestamp: now });
    return cidrs;
  } catch {
    return await useFallback(key, entry);
  }
}

function parseCIDRText(text) {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#') && /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}$/.test(line));
}

async function useFallback(key, entry) {
  if (entry) {
    // 不更新时间戳，保持原有过期时间，给下次 fetch 留机会
    return entry.cidrs;
  }
  return [...FALLBACK_CIDRS];
}

/**
 * 清除内存缓存，用于测试或手动刷新。
 */
export function clearCIDRCache() {
  cache.clear();
}