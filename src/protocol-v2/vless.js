import { createProxyRequest } from '../core/types.js';
import { parseAddress } from './address.js';
import { appendBytes, equalBytes, uuidToBytes } from './helpers.js';
import { NEED_MORE, protocolError, ready } from './types.js';

export function createVlessParser(credentials, limits = {}) {
  const expectedUser = uuidToBytes(credentials?.userID || credentials?.uuid);
  const maxBytes = Number(limits.maxFirstPacketBytes || 64 * 1024);
  let buffer = new Uint8Array();
  let finished = false;

  return {
    push(chunk) {
      if (finished) return protocolError('PARSER_FINISHED');
      buffer = appendBytes(buffer, chunk);
      if (buffer.byteLength > maxBytes) return protocolError('FIRST_PACKET_TOO_LARGE');
      if (buffer.byteLength < 18) return NEED_MORE;
      if (!expectedUser || !equalBytes(buffer.slice(1, 17), expectedUser)) return protocolError('INVALID_CREDENTIALS');

      const version = buffer[0];
      const commandOffset = 18 + buffer[17];
      if (buffer.byteLength < commandOffset + 4) return NEED_MORE;
      const command = buffer[commandOffset];
      if (command !== 1 && command !== 2) return protocolError('UNSUPPORTED_COMMAND');
      const port = (buffer[commandOffset + 1] << 8) | buffer[commandOffset + 2];
      if (port === 0) return protocolError('INVALID_PORT');
      const address = parseAddress(buffer, commandOffset + 3);
      if (address.needMore) return NEED_MORE;
      if (address.error) return protocolError(address.error);

      finished = true;
      const payload = buffer.slice(address.offset);
      return ready(createProxyRequest({
        hostname: address.hostname,
        port,
        isUDP: command === 2,
        payload,
        responseHeader: Uint8Array.of(version, 0),
      }), payload);
    },
  };
}
