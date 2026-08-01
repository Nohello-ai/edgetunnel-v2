import { createProxyRequest } from '../core/types.js';
import { sha224Text } from '../utils/crypto.js';
import { parseSocksAddress } from './address.js';
import { appendBytes, equalBytes } from './helpers.js';
import { NEED_MORE, protocolError, ready } from './types.js';

const encoder = new TextEncoder();

export function createTrojanParser(credentials, limits = {}) {
  if (!credentials?.secret && !credentials?.trojanSecret) {
    return { push: () => ({ status: 'error', code: 'INVALID_CREDENTIALS' }) };
  }
  const expected = encoder.encode(sha224Text(credentials?.secret || credentials?.trojanSecret));
  const maxBytes = Number(limits.maxFirstPacketBytes || 64 * 1024);
  let buffer = new Uint8Array();
  let finished = false;

  return {
    push(chunk) {
      if (finished) return protocolError('PARSER_FINISHED');
      buffer = appendBytes(buffer, chunk);
      if (buffer.byteLength > maxBytes) return protocolError('FIRST_PACKET_TOO_LARGE');
      if (buffer.byteLength < 59) return NEED_MORE;
      if (!equalBytes(buffer.slice(0, 56), expected)) return protocolError('INVALID_CREDENTIALS');
      if (buffer[56] !== 13 || buffer[57] !== 10) return protocolError('INVALID_TROJAN_HEADER');
      const command = buffer[58];
      if (command !== 1 && command !== 3) return protocolError('UNSUPPORTED_COMMAND');
      const address = parseSocksAddress(buffer, 59);
      if (address.needMore) return NEED_MORE;
      if (address.error) return protocolError(address.error);
      if (buffer.byteLength < address.offset + 4) return NEED_MORE;
      const port = (buffer[address.offset] << 8) | buffer[address.offset + 1];
      if (port === 0) return protocolError('INVALID_PORT');
      if (buffer[address.offset + 2] !== 13 || buffer[address.offset + 3] !== 10) {
        return protocolError('INVALID_TROJAN_HEADER');
      }

      finished = true;
      const payload = buffer.slice(address.offset + 4);
      return ready(createProxyRequest({
        hostname: address.hostname,
        port,
        isUDP: command === 3,
        payload,
        responseHeader: new Uint8Array(0),
      }), payload);
    },
  };
}
