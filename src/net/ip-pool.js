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
 * 解析自定义 IP 源文本，返回 IP 条目数组。
 *
 * 支持格式（每行一个）：
 *   IP:port#名称
 *   IP#名称
 *   IP:port
 *   IP
 *   空行和 # 开头的注释行会被忽略
 *
 * 端口规则：
 *   行内指定了端口 → 使用该端口
 *   行内没指定端口 → port 为 null，由调用方按随机端口开关决定
 *
 * @param {string} text - 自定义 IP 文本
 * @returns {Array<{ address: string, port: number|null, name?: string }> | null}
 */
export function parseCustomIPs(text) {
  if (!text) return null;
  const results = [];

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const hashIndex = trimmed.indexOf('#');
    const namePart = hashIndex !== -1 ? trimmed.slice(hashIndex + 1).trim() : '';
    const ipPart = hashIndex !== -1 ? trimmed.slice(0, hashIndex).trim() : trimmed;

    if (!ipPart) continue;

    const entry = parseIPEntry(ipPart);
    if (!entry) continue;

    if (namePart) results.push({ ...entry, name: namePart });
    else results.push(entry);
  }

  return results.length ? results : null;
}

/**
 * 解析单行 IP:port 或 IP。
 * 有端口 → port 为数字，无端口 → port 为 null。
 */
function parseIPEntry(text) {
  if (!text) return null;
  const m = text.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(?::(\d{1,5}))?$/);
  if (!m) return null;
  const octets = m[1].split('.').map(Number);
  if (octets.some((o) => o < 0 || o > 255)) return null;
  if (m[2]) {
    const port = parseInt(m[2], 10);
    if (port < 1 || port > 65535) return null;
    return { address: m[1], port };
  }
  return { address: m[1], port: null };
}

/**
 * 从 URL 获取自定义 IP 列表。
 *
 * @param {string} url
 * @param {object} [options]
 * @param {typeof fetch} [options.fetch]
 * @returns {Promise<Array<{ address: string, port: number|null, name?: string }> | null>}
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
  return parseCustomIPs(text);
}

/**
 * 根据随机端口开关返回一个端口。
 * true → 从 CF 端口池随机选，false → 443。
 *
 * @param {boolean} useRandomPort
 * @returns {number}
 */
export function pickPort(useRandomPort) {
  if (useRandomPort) return CF_PORTS[Math.floor(Math.random() * CF_PORTS.length)];
  return 443;
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