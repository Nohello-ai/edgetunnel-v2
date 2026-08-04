import { createTrojanParser } from './trojan.js';
import { createVlessParser } from './vless.js';
import { AppError } from '../core/errors.js';
import { uuidToBytes, equalBytes } from './helpers.js';

const FACTORIES = Object.freeze({ vless: createVlessParser, trojan: createTrojanParser });

export function createProtocolParser(protocol, credentials, limits) {
  const factory = FACTORIES[protocol];
  if (!factory) throw new AppError('UNSUPPORTED_PROTOCOL', 501, `unsupported protocol: ${protocol}`);
  return factory(credentials, limits);
}

export function detectProtocol(buffer, credentials) {
  if (buffer.byteLength < 18) return null;
  const version = buffer[0];
  if ((version === 0x00 || version === 0x01) && equalBytes(buffer.slice(1, 17), uuidToBytes(credentials.userID))) {
    return 'vless';
  }
  return 'trojan';
}
