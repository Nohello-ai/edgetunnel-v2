import { parseTrojanPacket } from './trojan.js';
import { parseVlessPacket } from './vless.js';

export function parseProxyPacket(packet, session) {
  if (session.protocol === 'vless') return parseVlessPacket(packet, session);
  if (session.protocol === 'trojan') return parseTrojanPacket(packet, session);

  return { status: 'invalid' };
}
