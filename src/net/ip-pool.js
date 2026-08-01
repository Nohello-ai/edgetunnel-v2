/**
 * 优选 IP 随机生成。
 *
 * 从 CIDR 段列表中随机生成 IP:端口组合。
 * 纯计算，无 I/O，无状态。
 */

const CF_PORTS = Object.freeze([443, 2053, 2083, 2087, 2096, 8443]);

/**
 * 从 CIDR 段列表中随机生成指定数量的 IP:端口。
 *
 * @param {string[]} cidrs - CIDR 段数组，如 ["104.16.0.0/13", "172.64.0.0/13"]
 * @param {number} count - 生成数量
 * @param {object} [options]
 * @param {number[]} [options.ports] - 可选端口列表，默认 CF_PORTS
 * @param {number} [options.fixedPort] - 固定端口（覆盖随机端口）
 * @returns {string[]} ["IP:port", "IP:port", ...]
 */
export function generateIPs(cidrs, count, options = {}) {
  if (!Array.isArray(cidrs) || cidrs.length === 0) return [];
  if (!Number.isInteger(count) || count < 1) return [];

  const ports = options.fixedPort != null
    ? [options.fixedPort]
    : (options.ports || CF_PORTS);

  const results = [];
  for (let i = 0; i < count; i++) {
    const cidr = cidrs[Math.floor(Math.random() * cidrs.length)];
    const range = parseCIDR(cidr);
    if (!range) continue;

    const ip = randomIPInRange(range.baseIP, range.hostBits);
    const port = ports[Math.floor(Math.random() * ports.length)];
    results.push(`${ip}:${port}`);
  }
  return results;
}

/**
 * 根据端口配置返回端口值。
 * 随机端口=true 时从 CF 端口池随机选，false 时固定 443。
 *
 * @param {boolean} randomPort
 * @returns {number}
 */
export function pickPort(randomPort) {
  if (randomPort) return CF_PORTS[Math.floor(Math.random() * CF_PORTS.length)];
  return 443;
}

/**
 * 解析自定义 IP 源，返回 IP:port 数组。
 *
 * 支持三种输入：
 *   - 空字符串 → null（走 CIDR 自动生成）
 *   - IP 或 IP:port → 解析为单元素数组
 *   - URL（http/https）→ 请求后按行解析
 *
 * @param {string} source - 自定义IP源
 * @param {object} [options]
 * @param {typeof fetch} [options.fetch] - 可注入的 fetch，用于测试
 * @param {number} [options.defaultPort] - 默认端口，默认 443
 * @returns {Promise<string[] | null>}
 */
export async function resolveIPSource(source, options = {}) {
  if (!source) return null;

  const trimmed = source.trim();
  const defaultPort = options.defaultPort ?? 443;

  // 判断是否为 URL
  if (/^https?:\/\//i.test(trimmed)) {
    return fetchIPList(trimmed, options.fetch);
  }

  // 单 IP 或 IP:port
  const entry = normalizeIPEntry(trimmed, defaultPort);
  return entry ? [entry] : null;
}

async function fetchIPList(url, fetchImpl) {
  const fetcher = fetchImpl || globalThis.fetch;
  let text;
  try {
    const res = await fetcher(url);
    if (!res.ok) return null;
    text = await res.text();
  } catch {
    return null;
  }

  const results = [];
  const defaultPort = new URL(url).searchParams.get('port') || 443;

  for (const line of text.split('\n')) {
    const entry = normalizeIPEntry(line.trim(), Number(defaultPort));
    if (entry) results.push(entry);
  }

  return results.length ? results : null;
}

function normalizeIPEntry(text, defaultPort) {
  if (!text) return null;
  // 去掉 # 注释
  const clean = text.split('#')[0].trim();
  if (!clean) return null;

  if (clean.includes(':')) {
    const parts = clean.split(':');
    const port = parseInt(parts[parts.length - 1], 10);
    if (Number.isInteger(port) && port >= 1 && port <= 65535) return clean;
    // 有冒号但不是端口（如 IPv6），忽略
    return null;
  }

  // 纯 IP，加默认端口
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(clean)) return `${clean}:${defaultPort}`;
  return null;
}

/**
 * 解析 CIDR 为范围信息。
 *
 * @param {string} cidr - "104.16.0.0/13"
 * @returns {{ baseIP: number, hostBits: number } | null}
 */
export function parseCIDR(cidr) {
  const parts = cidr.split('/');
  if (parts.length !== 2) return null;

  const prefix = parseInt(parts[1], 10);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;

  const baseIP = ipToInt(parts[0]);
  if (baseIP == null) return null;

  return { baseIP, hostBits: 32 - prefix };
}

function ipToInt(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    const octet = parseInt(part, 10);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    result = (result << 8) | octet;
  }
  return result >>> 0;
}

function intToIP(value) {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ].join('.');
}

function randomIPInRange(baseIP, hostBits) {
  if (hostBits <= 0) return intToIP(baseIP);
  const maxOffset = 2 ** hostBits;
  const offset = Math.floor(Math.random() * maxOffset);
  return intToIP((baseIP + offset) >>> 0);
}