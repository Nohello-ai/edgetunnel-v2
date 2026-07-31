import assert from 'node:assert/strict';
import test from 'node:test';
import { createVlessParser } from '../src/protocol-v2/vless.js';
import { createTrojanParser } from '../src/protocol-v2/trojan.js';
import { sha224Text } from '../src/utils/crypto.js';

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const uuidBytes = Uint8Array.from(UUID.replaceAll('-', '').match(/../g), (pair) => parseInt(pair, 16));

test('VLESS parser is incremental and preserves payload', () => {
  const packet = Uint8Array.from([1, ...uuidBytes, 0, 1, 1, 187, 2, 11, ...new TextEncoder().encode('example.com'), 9, 8, 7]);
  for (let split = 0; split <= packet.length; split += 1) {
    const parser = createVlessParser({ userID: UUID });
    const first = parser.push(packet.slice(0, split));
    const tail = packet.slice(split);
    const result = first.status === 'ready' ? first : parser.push(tail);
    assert.equal(result.status, 'ready');
    assert.equal(result.request.hostname, 'example.com');
    assert.equal(result.request.port, 443);
    const remaining = first.status === 'ready'
      ? Uint8Array.from([...result.request.payload, ...tail])
      : result.request.payload;
    assert.deepEqual([...remaining], [9, 8, 7]);
  }
});

test('VLESS rejects wrong user and port zero', () => {
  const wrong = Uint8Array.from([1, ...new Uint8Array(16), 0, 1, 0, 80, 1, 1, 1, 1, 1]);
  assert.equal(createVlessParser({ userID: UUID }).push(wrong).code, 'INVALID_CREDENTIALS');
  const zero = Uint8Array.from([1, ...uuidBytes, 0, 1, 0, 0, 1, 1, 1, 1, 1]);
  assert.equal(createVlessParser({ userID: UUID }).push(zero).code, 'INVALID_PORT');
});

test('Trojan parser is incremental and uses independent secret', () => {
  const secret = 'private-secret';
  const auth = new TextEncoder().encode(sha224Text(secret));
  const host = new TextEncoder().encode('dns.example');
  const packet = Uint8Array.from([...auth, 13, 10, 3, 3, host.length, ...host, 0, 53, 13, 10, 1, 2]);
  for (let split = 0; split <= packet.length; split += 1) {
    const parser = createTrojanParser({ secret });
    const first = parser.push(packet.slice(0, split));
    const tail = packet.slice(split);
    const result = first.status === 'ready' ? first : parser.push(tail);
    assert.equal(result.status, 'ready');
    assert.equal(result.request.isUDP, true);
    assert.equal(result.request.hostname, 'dns.example');
    const remaining = first.status === 'ready'
      ? Uint8Array.from([...result.request.payload, ...tail])
      : result.request.payload;
    assert.deepEqual([...remaining], [1, 2]);
  }
});
