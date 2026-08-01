/**
 * 优选 IP 随机生成和自定义 IP 解析。
 *
 * 从 CIDR 段列表中随机生成 IP:端口，或解析自定义 IP 列表。
 * 自定义 IP 支持 #名称 后缀，无名称时自动生成带国旗的节点名。
 */

const CF_PORTS = Object.freeze([443, 2053, 2083, 2087, 2096, 8443]);

const OPERATOR_LABEL = Object.freeze({
  cmcc: '🇨🇳 中国移动优选',
  ct: '🇨🇳 中国电信优选',
  cu: '🇨🇳 中国联通优选',
  cf: '🌐 国际优选',
});

/**
 * 从 CIDR 段列表中随机生成指定数量的 IP:端口。
 *
 * @param {string[]} cidrs
 * @param {number} count
 * @param {object} [options]
 * @param {number[]} [options.ports] - 可选端口列表，默认 CF_PORTS
 * @returns {string[]} ["IP:port", ...]
 */
export function generateIPs(cidrs, count, options = {}) {
  if (!Array.isArray(cidrs) || cidrs.length === 0) return [];
  if (!Number.isInteger(count) || count < 1) return [];

  const ports = options.ports || CF_PORTS;
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
 * 解析自定义 IP 源文本，返回 IP:port 数组。
 *
 * 支持格式（每行一个）：
 *   IP:port#名称
 *   IP#名称
 *   IP:port
 *   IP
 *   空行和 # 开头的注释行会被忽略
 *
 * 端口规则：
 *   如果行内指定了端口 → 使用该端口
 *   如果行内没指定端口 → 使用 defaultPort
 *
 * @param {string} text - 自定义 IP 文本
 * @param {object} [options]
 * @param {number} [options.defaultPort] - 默认端口，默认 443
 * @returns {Array<{ address: string, port: number, name?: string }> | null}
 */
export function parseCustomIPs(text, options = {}) {
  if (!text) return null;
  const defaultPort = options.defaultPort ?? 443;
  const results = [];

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // 提取 #名称
    const hashIndex = trimmed.indexOf('#');
    const namePart = hashIndex !== -1 ? trimmed.slice(hashIndex + 1).trim() : '';
    const ipPart = hashIndex !== -1 ? trimmed.slice(0, hashIndex).trim() : trimmed;

    if (!ipPart) continue;

    // 提取 IP 和端口
    const entry = parseIPEntry(ipPart, defaultPort);
    if (!entry) continue;

    if (namePart) {
      results.push({ ...entry, name: namePart });
    } else {
      results.push(entry);
    }
  }

  return results.length ? results : null;
}

/**
 * 解析单行 IP:port。
 *
 * @param {string} text - "IP:port" 或 "IP"
 * @param {number} defaultPort
 * @returns {{ address: string, port: number } | null}
 */
function parseIPEntry(text, defaultPort) {
  if (!text) return null;

  // IPv4:port
  const ipv4Match = text.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(?::(\d{1,5}))?$/);
  if (ipv4Match) {
    const octets = ipv4Match[1].split('.').map(Number);
    if (octets.some((o) => o < 0 || o > 255)) return null;
    const port = ipv4Match[2] ? parseInt(ipv4Match[2], 10) : defaultPort;
    if (port < 1 || port > 65535) return null;
    return { address: ipv4Match[1], port };
  }

  // IPv6 暂不支持
  return null;
}

/**
 * 从 URL 获取自定义 IP 列表。
 *
 * @param {string} url
 * @param {object} [options]
 * @param {typeof fetch} [options.fetch]
 * @param {number} [options.defaultPort]
 * @returns {Promise<Array<{ address: string, port: number, name?: string }> | null>}
 */
export async function fetchCustomIPs(url, options = {}) {
  const fetcher = options.fetch || globalThis.fetch;
  let text;
  try {
    const res = await fetcher(url);
    if (!res.ok) return null;
    text = await res.text();
  } catch {
    return null;
  }
  return parseCustomIPs(text, options);
}

/**
 * 生成节点名称。
 * 无名称时自动生成 "🇨🇳 中国移动优选1" 格式。
 *
 * @param {string} [name] - 已有的名称
 * @param {string} operator - 运营商代号
 * @param {number} index - 序号
 * @returns {string}
 */
export function generateNodeName(name, operator, index) {
  if (name) return name;
  const label = OPERATOR_LABEL[operator] || OPERATOR_LABEL.cf;
  return `${label}${index}`;
}

/**
 * 解析 CIDR。
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