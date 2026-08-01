export function parseAddress(bytes, offset) {
  return parseTypedAddress(bytes, offset, { domain: 2, ipv6: 3 });
}

export function parseSocksAddress(bytes, offset) {
  return parseTypedAddress(bytes, offset, { domain: 3, ipv6: 4 });
}

function parseTypedAddress(bytes, offset, types) {
  if (offset >= bytes.byteLength) return { needMore: true };
  const type = bytes[offset];
  if (type === 1) {
    if (bytes.byteLength < offset + 5) return { needMore: true };
    return { hostname: [...bytes.slice(offset + 1, offset + 5)].join('.'), offset: offset + 5 };
  }
  if (type === types.domain) {
    if (bytes.byteLength < offset + 2) return { needMore: true };
    const length = bytes[offset + 1];
    if (length === 0 || length > 253) return { error: 'INVALID_ADDRESS' };
    if (bytes.byteLength < offset + 2 + length) return { needMore: true };
    return { hostname: new TextDecoder().decode(bytes.slice(offset + 2, offset + 2 + length)), offset: offset + 2 + length };
  }
  if (type === types.ipv6) {
    if (bytes.byteLength < offset + 17) return { needMore: true };
    const groups = [];
    for (let index = offset + 1; index < offset + 17; index += 2) {
      groups.push(((bytes[index] << 8) | bytes[index + 1]).toString(16));
    }
    return { hostname: groups.join(':'), offset: offset + 17 };
  }
  return { error: 'UNSUPPORTED_ADDRESS_TYPE' };
}
