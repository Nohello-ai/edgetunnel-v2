import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFallbackConnector } from '../src/connector/chain.js';

function mockSocket({ closed = true } = {}) {
  return {
    opened: Promise.resolve(),
    closed: closed ? Promise.resolve() : undefined,
    readable: new ReadableStream({ start(controller) { controller.close(); } }),
    writable: new WritableStream(),
    close() { return Promise.resolve(); },
  };
}

function makeDirect() {
  const calls = [];
  const direct = { connect: (target) => { calls.push(target); return mockSocket(); } };
  return { direct, calls };
}

// 104.16.0.1 在 Cloudflare 网段（同源），8.8.8.8 不是
test('无模式时直接返回直连 socket（同步返回）', async () => {
  const { direct, calls } = makeDirect();
  const connector = createFallbackConnector(direct, { 模式: '' });
  const socket = connector.connect({ hostname: '8.8.8.8', port: 443 });
  assert.deepEqual(calls, [{ hostname: '8.8.8.8', port: 443 }]);
  assert.equal(typeof socket.opened?.then, 'function');
  await socket.opened;
});

test('proxyip 模式 + 同源目标 → 走选定反代地址', async () => {
  const { direct, calls } = makeDirect();
  const connector = createFallbackConnector(direct, { 模式: 'proxyip', PROXYIP: '1.1.1.1:8443' });
  const socket = connector.connect({ hostname: '104.16.0.1', port: 443 });
  await socket.opened;
  assert.deepEqual(calls, [{ hostname: '1.1.1.1', port: 8443 }]);
});

test('proxyip 模式 + 非同源目标 → 直连目标本身', async () => {
  const { direct, calls } = makeDirect();
  const connector = createFallbackConnector(direct, { 模式: 'proxyip', PROXYIP: '1.1.1.1:8443' });
  const socket = connector.connect({ hostname: '8.8.8.8', port: 443 });
  await socket.opened;
  assert.deepEqual(calls, [{ hostname: '8.8.8.8', port: 443 }]);
});

test('socks5 模式 + 同源目标 → 反代握手失败时 opened 直接 reject（不降级）', async () => {
  const { direct } = makeDirect();
  const connector = createFallbackConnector(direct, {
    模式: 'socks5',
    SOCKS5: { 账号: 'u:p@1.2.3.4:1080' },
  });
  const socket = connector.connect({ hostname: '104.16.0.1', port: 443 });
  await assert.rejects(() => socket.opened, /closed prematurely|SOCKS5/i);
});
