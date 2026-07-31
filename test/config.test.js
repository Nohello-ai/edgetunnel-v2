import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeGlobalConfig } from '../src/config/schema.js';

test('config keeps protocol and transport lists independent', () => {
  const config = normalizeGlobalConfig({ protocols: ['vless', 'trojan', 'bad'], transports: ['websocket', 'grpc', 'xhttp'], ECHConfig: { DNS: 'https://dns.example/doh', SNI: '0' } });
  assert.deepEqual(config.protocols, ['vless', 'trojan']);
  assert.deepEqual(config.transports, ['websocket', 'grpc', 'xhttp']);
  assert.equal(config.ECHConfig.dns, 'https://dns.example/doh');
  assert.equal(config.ECHConfig.domain, '0');
});
