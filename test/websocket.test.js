import assert from 'node:assert/strict';
import test from 'node:test';
import { openWebSocketTransport } from '../src/transport-v2/websocket.js';

test('WebSocket transport accepts ArrayBuffer binary frames and early data', async () => {
  const listeners = new Map();
  const server = {
    binaryType: 'blob',
    accept() {},
    addEventListener(type, listener) { listeners.set(type, listener); },
    send() {},
    close() {},
  };
  const client = {};
  class Pair { constructor() { this[0] = client; this[1] = server; } }
  const early = btoa(String.fromCharCode(7, 8)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  const request = new Request('https://example.com/ws/id/vless', { method: 'GET', headers: { upgrade: 'websocket', 'sec-websocket-protocol': early } });
  const transport = openWebSocketTransport(request, {}, {
    WebSocketPair: Pair,
    Response: class { constructor(body, init) { this.body = body; Object.assign(this, init); } },
  });
  const reader = transport.readable.getReader();
  assert.deepEqual([...((await reader.read()).value)], [7, 8]);
  listeners.get('message')({ data: new Blob([Uint8Array.of(9, 10)]) });
  assert.deepEqual([...((await reader.read()).value)], [9, 10]);
  await reader.cancel();
});
