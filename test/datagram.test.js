import assert from 'node:assert/strict';
import test from 'node:test';
import { createDatagramCodec } from '../src/protocol-v2/datagram.js';

test('VLESS UDP codec parses and restores length framing', () => {
  const codec = createDatagramCodec('vless', { hostname: 'dns.example', port: 53 });
  assert.deepEqual(codec.push(Uint8Array.of(0, 3, 1)), []);
  const frames = codec.push(Uint8Array.of(2, 3, 0, 1, 9));
  assert.deepEqual(frames.map((item) => [...item.payload]), [[1, 2, 3], [9]]);
  assert.deepEqual([...codec.encode({ payload: Uint8Array.of(7, 8) })], [0, 2, 7, 8]);
  codec.finish();
});

test('Trojan UDP codec parses SOCKS address and restores envelope', () => {
  const host = new TextEncoder().encode('dns.example');
  const packet = Uint8Array.from([3, host.length, ...host, 0, 53, 0, 2, 13, 10, 1, 2]);
  const codec = createDatagramCodec('trojan');
  const [datagram] = codec.push(packet);
  assert.equal(datagram.hostname, 'dns.example');
  assert.equal(datagram.port, 53);
  assert.deepEqual([...datagram.payload], [1, 2]);
  assert.deepEqual([...codec.encode({ ...datagram, payload: Uint8Array.of(8, 9, 10) })], [3, host.length, ...host, 0, 53, 0, 3, 13, 10, 8, 9, 10]);
  codec.finish();
});
