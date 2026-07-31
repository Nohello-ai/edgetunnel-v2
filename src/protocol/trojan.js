import { sha224Text } from '../utils/crypto.js';
import { parseSocksAddress, readUint16 } from './address.js';

const TROJAN_HASH_HEX_LENGTH = 56;
const CR = 0x0d;
const LF = 0x0a;
const TROJAN_CMD_TCP = 1;
const TROJAN_CMD_UDP = 3;

const textDecoder = new TextDecoder();

export function parseTrojanPacket(packet, session) {
  const user = session.user;
  const length = packet.byteLength;

  if (length < TROJAN_HASH_HEX_LENGTH + 2) return { status: 'need_more' };
  if (packet[TROJAN_HASH_HEX_LENGTH] !== CR || packet[TROJAN_HASH_HEX_LENGTH + 1] !== LF) return { status: 'invalid' };

  const passwordHash = textDecoder.decode(packet.subarray(0, TROJAN_HASH_HEX_LENGTH));
  if (!constantTimeEqual(passwordHash, sha224Text(user.userID))) return { status: 'invalid' };

  const socksStart = TROJAN_HASH_HEX_LENGTH + 2;
  if (length < socksStart + 2) return { status: 'need_more' };

  const command = packet[socksStart];
  if (command !== TROJAN_CMD_TCP && command !== TROJAN_CMD_UDP) return { status: 'invalid' };

  const address = parseSocksAddress(packet, socksStart + 1);
  if (address.status !== 'ok') return address;
  if (length < address.offset + 4) return { status: 'need_more' };

  const port = readUint16(packet, address.offset);
  if (packet[address.offset + 2] !== CR || packet[address.offset + 3] !== LF) return { status: 'invalid' };

  return {
    status: 'ok',
    result: {
      protocol: 'trojan',
      user,
      hostname: address.hostname,
      port,
      isUDP: command === TROJAN_CMD_UDP,
      payload: packet.subarray(address.offset + 4),
      responseHeader: null,
      originalPacket: packet,
      udpHeader: buildTrojanUdpHeader(address.addressType, address.hostname, port),
    },
  };
}

function buildTrojanUdpHeader(addressType, hostname, port) {
  const header = [addressType];
  if (addressType === 3) {
    const domain = new TextEncoder().encode(String(hostname));
    header.push(domain.byteLength, ...domain);
  }
  header.push((port >>> 8) & 0xff, port & 0xff, 0x00, 0x00, 0x0d, 0x0a);
  return new Uint8Array(header);
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;

  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return diff === 0;
}
