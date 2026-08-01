const DEFAULT_TRANSPORT = 'websocket';
const DEFAULT_PROTOCOL = 'vless';
const TRANSPORTS = new Set(['websocket', 'grpc', 'xhttp']);
const PROTOCOLS = new Set(['vless', 'trojan']);
const DEFAULT_ECH_DNS = 'https://odvr.nic.cz/doh';
const DEFAULT_ECH_SNI = 'cloudflare-ech.com';

export function normalizeUserConfig(input, fallback = {}) {
  const config = input && typeof input === 'object' ? input : {};
  const now = new Date().toISOString();

  return {
    ...fallback,
    userID: String(config.userID || fallback.userID || ''),
    username: String(config.username || fallback.username || '').trim().toLowerCase(),
    password: String(config.password || fallback.password || ''),
    disabled: Boolean(config.disabled ?? fallback.disabled ?? false),
    settings: normalizeObject(config.settings ?? fallback.settings),
    createdAt: fallback.createdAt || now,
    updatedAt: now,
  };
}

export function normalizeGlobalConfig(input, fallback = {}) {
  const config = input && typeof input === 'object' ? input : {};
  const hosts = normalizeHosts(config.HOSTS ?? fallback.HOSTS ?? [fallback.siteName || 'edgetunnel']);
  const proxyGroup = normalizeProxyGroup(config.反代, fallback.反代);
  const nodeGroup = normalizeNodeGroup(config.节点参数, fallback.节点参数);

  const protocol = normalizeEnum(config.protocol || config.defaultProtocol, PROTOCOLS, fallback.protocol || fallback.defaultProtocol || DEFAULT_PROTOCOL);
  const transport = normalizeEnum(config.transport || config.defaultTransport, TRANSPORTS, fallback.transport || fallback.defaultTransport || DEFAULT_TRANSPORT);

  return {
    ...fallback,
    siteName: String(config.siteName || fallback.siteName || 'edgetunnel'),
    transport,
    transports: normalizeEnums(config.transports ?? fallback.transports ?? [transport], TRANSPORTS, [transport]),
    protocol,
    protocols: normalizeEnums(config.protocols ?? fallback.protocols ?? [protocol], PROTOCOLS, [protocol]),
    HOST: String(config.HOST || fallback.HOST || hosts[0] || 'edgetunnel'),
    HOSTS: hosts,
    订阅参数: String(config.订阅参数 ?? fallback.订阅参数 ?? ''),
    订阅转换: normalizeSubConverter(config.订阅转换, fallback.订阅转换),
    反代: proxyGroup,
    节点参数: nodeGroup,
    ECH: Boolean(config.ECH ?? fallback.ECH ?? false),
    ECHConfig: normalizeECHConfig(config.ECHConfig, fallback.ECHConfig),
    settings: normalizeObject(config.settings ?? fallback.settings),
    updatedAt: new Date().toISOString(),
  };
}

export function normalizeBan(input) {
  const ban = input && typeof input === 'object' ? input : {};

  return {
    reason: String(ban.reason || ''),
    until: ban.until || null,
    createdAt: new Date().toISOString(),
  };
}

function normalizeEnum(value, allowed, fallback) {
  return allowed.has(value) ? value : fallback;
}

function normalizeEnums(value, allowed, fallback) {
  const values = Array.isArray(value) ? value : [value];
  const normalized = [...new Set(values.filter((item) => allowed.has(item)))];
  return normalized.length ? normalized : fallback;
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeHosts(value) {
  const items = Array.isArray(value) ? value : [value];
  const hosts = items
    .flatMap((item) => String(item || '').split(/[\n,，]/g))
    .map((item) => item.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0].split(':')[0])
    .filter(Boolean);

  return hosts.length ? [...new Set(hosts)] : ['edgetunnel'];
}

function normalizeProxyGroup(value, fallback) {
  const config = normalizeObject(value);
  const base = normalizeObject(fallback);
  const MODES = new Set(['', 'proxyip', 'socks5', 'auto']);
  const mode = normalizeEnum(config.模式 ?? base.模式, MODES, '');
  return {
    模式: mode,
    PROXYIP: mode ? String(config.PROXYIP || base.PROXYIP || 'auto') : '',
    SOCKS5: mode === 'socks5' || mode === 'auto' ? normalizeSocks5Config(config.SOCKS5, base.SOCKS5) : { 启用: null, 全局: false, 账号: '', 白名单: [] },
  };
}

function normalizeNodeGroup(value, fallback) {
  const config = normalizeObject(value);
  const base = normalizeObject(fallback);
  return {
    Fingerprint: normalizeFingerprint(config.Fingerprint ?? base.Fingerprint),
    随机路径: Boolean(config.随机路径 ?? base.随机路径 ?? false),
    启用0RTT: Boolean(config.启用0RTT ?? base.启用0RTT ?? false),
    TLS分片: normalizeTlsFragment(config.TLS分片 ?? base.TLS分片),
    节点数量: normalizeInt(config.节点数量 ?? base.节点数量, 16, 1, 64),
    优选IP: normalizeOptimizedIP(config.优选IP, base.优选IP),
  };
}

function normalizeOptimizedIP(value, fallback) {
  const config = normalizeObject(value);
  const base = normalizeObject(fallback);
  const MODES = new Set(['', 'optimized', 'random', 'custom']);
  const mode = normalizeEnum(config.模式 ?? base.模式, MODES, '');
  return {
    模式: mode,
    随机端口: Boolean(config.随机端口 ?? base.随机端口 ?? true),
    自定义IP源: mode === 'custom' ? String(config.自定义IP源 ?? base.自定义IP源 ?? '').trim() : '',
    优选网站URL: mode === 'custom' ? String(config.优选网站URL ?? base.优选网站URL ?? '').trim() : '',
  };
}

function normalizeInt(value, fallback, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY) {
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeFingerprint(value) {
  const text = String(value || '').trim();
  return text || 'chrome';
}

function normalizeTlsFragment(value) {
  const text = String(value || '').trim();
  return text || null;
}

function normalizeSocks5Config(value, fallback) {
  const config = normalizeObject(value);
  const base = normalizeObject(fallback);
  const 白名单 = config.白名单 ?? base.白名单;
  return {
    启用: config.启用 ?? base.启用 ?? null,
    全局: Boolean(config.全局 ?? base.全局 ?? false),
    账号: String(config.账号 ?? base.账号 ?? ''),
    白名单: Array.isArray(白名单) ? 白名单.map((item) => String(item || '').trim()).filter(Boolean) : [],
  };
}

function normalizeSubConverter(value, fallback) {
  const config = normalizeObject(value);
  const base = normalizeObject(fallback);
  return {
    SUBAPI: String(config.SUBAPI || config.subapi || base.SUBAPI || base.subapi || '').trim() || 'https://SUBAPI.cmliussss.net',
    emoji: Boolean(config.emoji ?? base.emoji ?? true),
    list: Boolean(config.list ?? base.list ?? false),
    udp: Boolean(config.udp ?? base.udp ?? true),
    xudp: Boolean(config.xudp ?? base.xudp ?? false),
    tls13: Boolean(config.tls13 ?? base.tls13 ?? true),
    append_type: Boolean(config.append_type ?? base.append_type ?? false),
    sort: Boolean(config.sort ?? base.sort ?? false),
    config: String(config.config ?? base.config ?? ''),
  };
}

function normalizeECHConfig(value, fallback = {}) {
  const config = normalizeObject(value);
  const normalizedDNS = normalizeECHDNS(config.dns ?? config.DNS ?? fallback.dns ?? fallback.DNS);
  const normalizedDomain = normalizeECHDomain(config.domain ?? config.sni ?? config.SNI ?? fallback.domain ?? fallback.sni ?? fallback.SNI);

  return {
    dns: normalizedDNS,
    domain: normalizedDomain,
    dnsService: normalizedDNS,
    sni: normalizedDomain,
    DNS: normalizedDNS,
    SNI: normalizedDomain,
  };
}

function normalizeECHDNS(value) {
  const text = String(value || '').trim();
  return text || DEFAULT_ECH_DNS;
}

function normalizeECHDomain(value) {
  const text = String(value ?? '').trim();

  if (!text) {
    return DEFAULT_ECH_SNI;
  }

  if (text === '0') {
    return '0';
  }

  return text;
}
