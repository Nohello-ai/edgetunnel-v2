const TRANSPORTS = Object.freeze({
  websocket: Object.freeze({ type: 'ws', hostKey: 'host', pathKey: 'path' }),
  ws: Object.freeze({ type: 'ws', hostKey: 'host', pathKey: 'path' }),
  grpc: Object.freeze({ type: 'grpc', hostKey: 'authority', pathKey: 'serviceName' }),
  xhttp: Object.freeze({ type: 'xhttp', hostKey: 'host', pathKey: 'path' }),
});

function required(input, keys, label) {
  for (const key of keys) {
    if (input[key] !== undefined && input[key] !== null && String(input[key]) !== '') {
      return String(input[key]);
    }
  }
  throw new TypeError(`${label} is required`);
}

function formatAddress(address) {
  const value = String(address).trim();
  if (value.includes(':') && !(value.startsWith('[') && value.endsWith(']'))) return `[${value}]`;
  return value;
}

function addQuery(query, source) {
  if (!source) return;
  const entries = source instanceof URLSearchParams
    ? source.entries()
    : typeof source === 'string'
      ? new URLSearchParams(source.replace(/^[?&]+/, '')).entries()
      : Object.entries(source);
  for (const [key, value] of entries) {
    if (value !== undefined && value !== null) query.set(String(key), String(value));
  }
}

/** Build one VLESS or Trojan raw URI from an already prepared NodeInput. */
export function buildNodeURI(node) {
  if (!node || typeof node !== 'object') throw new TypeError('node input is required');

  const protocol = required(node, ['protocol'], 'protocol').toLowerCase();
  if (protocol !== 'vless' && protocol !== 'trojan') {
    throw new TypeError(`unsupported protocol: ${protocol}`);
  }

  const transportName = required(node, ['transport'], 'transport').toLowerCase();
  const transport = TRANSPORTS[transportName];
  if (!transport) throw new TypeError(`unsupported transport: ${transportName}`);

  const credential = protocol === 'vless'
    ? required(node, ['credential', 'uuid', 'userID'], 'VLESS credential')
    : required(node, ['credential', 'password', 'secret'], 'Trojan credential');
  const address = formatAddress(required(node, ['address', 'server'], 'address'));
  const port = Number(required(node, ['port'], 'port'));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new TypeError('port must be between 1 and 65535');

  const host = required(node, ['host'], 'host');
  const sni = String(node.sni ?? host);
  const security = String(node.security ?? 'tls');
  const query = new URLSearchParams();
  query.set('security', security);
  query.set('type', transport.type);
  query.set(transport.hostKey, host);
  if (security === 'tls' && sni) query.set('sni', sni);

  const path = String(node.path || '/');
  query.set(transport.pathKey, path);
  if (protocol === 'vless') query.set('encryption', String(node.encryption ?? 'none'));
  if (transport.type === 'xhttp' && node.mode) query.set('mode', String(node.mode));
  if (node.fingerprint || node.fp) query.set('fp', String(node.fingerprint ?? node.fp));

  addQuery(query, node.query);

  const name = String(node.name ?? `${protocol}-${transportName}-${host}`);
  return `${protocol}://${encodeURIComponent(credential)}@${address}:${port}?${query.toString()}#${encodeURIComponent(name)}`;
}

export const buildNodeUri = buildNodeURI;
