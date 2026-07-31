const ADDRESS_TYPE_IPV4 = 1;
const ADDRESS_TYPE_DOMAIN = 2;
const ADDRESS_TYPE_IPV6 = 3;
const SOCKS_ADDRESS_TYPE_DOMAIN = 3;
const SOCKS_ADDRESS_TYPE_IPV6 = 4;

const textDecoder = new TextDecoder();

export function parseVlessAddress(packet, offset) {
  if (packet.byteLength < offset + 1) return { status: 'need_more' };

  const addressType = packet[offset];
  let cursor = offset + 1;

  if (addressType === ADDRESS_TYPE_IPV4) {
    if (packet.byteLength < cursor + 4) return { status: 'need_more' };
    return {
      status: 'ok',
      addressType,
      hostname: `${packet[cursor]}.${packet[cursor + 1]}.${packet[cursor + 2]}.${packet[cursor + 3]}`,
      offset: cursor + 4,
    };
  }

  if (addressType === ADDRESS_TYPE_DOMAIN) {
    return parseDomainAddress(packet, cursor, addressType);
  }

  if (addressType === ADDRESS_TYPE_IPV6) {
    return parseIpv6Address(packet, cursor, addressType);
  }

  return { status: 'invalid' };
}

export function parseSocksAddress(packet, offset) {
  if (packet.byteLength < offset + 1) return { status: 'need_more' };

  const addressType = packet[offset];
  let cursor = offset + 1;

  if (addressType === ADDRESS_TYPE_IPV4) {
    if (packet.byteLength < cursor + 4) return { status: 'need_more' };
    return {
      status: 'ok',
      addressType,
      hostname: `${packet[cursor]}.${packet[cursor + 1]}.${packet[cursor + 2]}.${packet[cursor + 3]}`,
      offset: cursor + 4,
    };
  }

  if (addressType === SOCKS_ADDRESS_TYPE_DOMAIN) {
    return parseDomainAddress(packet, cursor, addressType);
  }

  if (addressType === SOCKS_ADDRESS_TYPE_IPV6) {
    return parseIpv6Address(packet, cursor, addressType);
  }

  return { status: 'invalid' };
}

export function readUint16(bytes, offset) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function parseDomainAddress(packet, cursor, addressType) {
  if (packet.byteLength < cursor + 1) return { status: 'need_more' };

  const length = packet[cursor];
  cursor += 1;

  if (length === 0) return { status: 'invalid' };
  if (packet.byteLength < cursor + length) return { status: 'need_more' };

  return {
    status: 'ok',
    addressType,
    hostname: textDecoder.decode(packet.subarray(cursor, cursor + length)),
    offset: cursor + length,
  };
}

function parseIpv6Address(packet, cursor, addressType) {
  if (packet.byteLength < cursor + 16) return { status: 'need_more' };

  return {
    status: 'ok',
    addressType,
    hostname: formatIpv6(packet.subarray(cursor, cursor + 16)),
    offset: cursor + 16,
  };
}

function formatIpv6(bytes) {
  const parts = [];
  for (let index = 0; index < 8; index += 1) {
    const base = index * 2;
    parts.push(readUint16(bytes, base).toString(16));
  }
  return parts.join(':');
}
