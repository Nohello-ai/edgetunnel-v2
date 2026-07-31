import { parseVlessAddress, readUint16 } from './address.js';

const VLESS_CMD_TCP = 1;
const VLESS_CMD_UDP = 2;

export function parseVlessPacket(packet, session) {
  const user = session.user;
  const length = packet.byteLength;

  if (length < 18) return { status: 'need_more' };
  if (!uuidBytesMatch(packet, 1, user.userID)) return { status: 'invalid' };

  const version = packet[0];
  const optLength = packet[17];
  const commandIndex = 18 + optLength;
  if (length < commandIndex + 4) return { status: 'need_more' };

  const command = packet[commandIndex];
  if (command !== VLESS_CMD_TCP && command !== VLESS_CMD_UDP) return { status: 'invalid' };

  const portIndex = commandIndex + 1;
  const port = readUint16(packet, portIndex);
  const address = parseVlessAddress(packet, portIndex + 2);
  if (address.status !== 'ok') return address;

  return {
    status: 'ok',
    result: {
      protocol: 'vless',
      user,
      hostname: address.hostname,
      port,
      isUDP: command === VLESS_CMD_UDP,
      payload: packet.subarray(address.offset),
      responseHeader: new Uint8Array([version, 0]),
      originalPacket: null,
      udpHeader: buildVlessUdpHeader(packet, address.offset, address.addressType, port, address.hostname),
    },
  };
}

function buildVlessUdpHeader(packet, payloadOffset, addressType, port, hostname) {
  if (packet[0] === undefined) return new Uint8Array(0);
  const header = [];
  header.push(addressType);
  if (addressType === 2) {
    const domain = new TextEncoder().encode(String(hostname));
    header.push(domain.byteLength);
    header.push(...domain);
  } else if (addressType === 1 || addressType === 3) {
    // The address is already encoded in the packet; no extra bytes needed here.
  }
  header.push((port >>> 8) & 0xff, port & 0xff, 0x00, 0x00, 0x0d, 0x0a);
  return new Uint8Array(header);
}

function uuidBytesMatch(data, offset, uuid) {
  const expected = uuidToBytes(uuid);
  if (!expected || data.byteLength < offset + 16) return false;

  for (let index = 0; index < 16; index += 1) {
    if (data[offset + index] !== expected[index]) return false;
  }

  return true;
}

function uuidToBytes(uuid) {
  const clean = String(uuid || '').replace(/-/g, '');
  if (clean.length !== 32) return null;

  const bytes = new Uint8Array(16);
  for (let index = 0; index < 16; index += 1) {
    const high = hexNibble(clean.charCodeAt(index * 2));
    const low = hexNibble(clean.charCodeAt(index * 2 + 1));
    if (high < 0 || low < 0) return null;
    bytes[index] = (high << 4) | low;
  }

  return bytes;
}

function hexNibble(code) {
  if (code >= 48 && code <= 57) return code - 48;
  const lower = code | 32;
  if (lower >= 97 && lower <= 102) return lower - 87;
  return -1;
}
