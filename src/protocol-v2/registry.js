import { createTrojanParser } from './trojan.js';
import { createVlessParser } from './vless.js';

const FACTORIES = Object.freeze({ vless: createVlessParser, trojan: createTrojanParser });

export function createProtocolParser(protocol, credentials, limits) {
  const factory = FACTORIES[protocol];
  if (!factory) throw new TypeError(`unsupported protocol: ${protocol}`);
  return factory(credentials, limits);
}
