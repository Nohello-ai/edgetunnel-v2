import { createTrojanParser } from './trojan.js';
import { createVlessParser } from './vless.js';
import { AppError } from '../core/errors.js';

const FACTORIES = Object.freeze({ vless: createVlessParser, trojan: createTrojanParser });

export function createProtocolParser(protocol, credentials, limits) {
  const factory = FACTORIES[protocol];
  if (!factory) throw new AppError('UNSUPPORTED_PROTOCOL', 501, `unsupported protocol: ${protocol}`);
  return factory(credentials, limits);
}
