import assert from 'node:assert/strict';
import test from 'node:test';
import { openTransport } from '../src/transport-v2/registry.js';
import { startDataFlowPipeline } from '../src/proxy/pipeline.js';
import {
  createGrpcFrameParser,
  decodeGrpcHunk,
  encodeGrpcFrame,
  encodeGrpcHunk,
} from '../src/transport-v2/grpc-frame.js';

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const uuidBytes = Uint8Array.from(UUID.replaceAll('-', '').match(/../g), (v) => parseInt(v, 16));

// ── 工具 ──────────────────────────────────────────────

/** 构造 VLESS TCP 首包:version + uuid + addon(0) + command(1) + port + atyp(domain) + host + payload */
function vlessPacket(hostname = 'example.com', port = 80, payload = []) {
  const host = new TextEncoder().encode(hostname);
  return Uint8Array.of(1, ...uuidBytes, 0, 1, (port >> 8) & 0xff, port & 0xff, 2, host.length, ...host, ...payload);
}

function session(transport) {
  return {
    user: { userID: UUID, username: 'u', role: 'user', settings: {}, trojanSecret: '' },
    userID: UUID,
    protocol: 'vless',
    transport,
    usage: { upload: 0, download: 0, total: 0 },
    quotaBytes: 0,
    resetVersion: 0,
  };
}

function fakeSocket(downloads) {
  const writes = [];
  return {
    writes,
    writable: new WritableStream({ write(value) { writes.push([...value]); } }),
    readable: new ReadableStream({
      start(controller) { for (const item of downloads) controller.enqueue(item); controller.close(); },
    }),
    close() {},
  };
}

function waitFor(check, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (check()) return resolve();
      if (Date.now() - started > timeout) return reject(new Error('waitFor timeout'));
      setTimeout(tick, 10);
    };
    tick();
  });
}

function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return new Uint8Array();
}

/** 在 node 环境模拟 CF 的全局 WebSocketPair / Response(node 的 Response 不接受 status 101),测试结束后恢复 */
function installWebSocketGlobal() {
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
  class LooseResponse {
    constructor(body, init = {}) { this.body = body; Object.assign(this, init); }
  }
  const prevPair = globalThis.WebSocketPair;
  const prevResponse = globalThis.Response;
  globalThis.WebSocketPair = Pair;
  globalThis.Response = LooseResponse;
  return {
    server,
    listeners,
    restore() {
      if (prevPair === undefined) delete globalThis.WebSocketPair;
      else globalThis.WebSocketPair = prevPair;
      if (prevResponse === undefined) delete globalThis.Response;
      else globalThis.Response = prevResponse;
    },
  };
}

/** 读取并解析 gRPC 响应流,返回每个 hunk 的字节数组 */
async function readGrpcFrames(body) {
  const reader = body.getReader();
  const parser = createGrpcFrameParser();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const message of parser.push(value).messages) {
      chunks.push([...decodeGrpcHunk(message)]);
    }
  }
  return chunks;
}

/** 读取普通字节流(如 xhttp 响应),按 chunk 返回字节数组 */
async function readRawFrames(body) {
  const reader = body.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push([...value]);
  }
  return chunks;
}

// ── 回归测试:501 bug ─────────────────────────────────

test('回归:openTransport(websocket) 不再依赖调用方传 runtime,不再 501', () => {
  const ws = installWebSocketGlobal();
  try {
    const request = new Request(`https://example.com/ws/${UUID}/vless`, {
      method: 'GET',
      headers: { upgrade: 'websocket' },
    });
    const transport = openTransport('websocket', request);
    assert.equal(transport.response.status, 101);
    assert.equal(transport.metadata.name, 'websocket');
  } finally {
    ws.restore();
  }
});

// ── WS 全链路 ─────────────────────────────────────────

test('WS + VLESS 全链路:远端转发、响应回传、101 握手', async () => {
  const ws = installWebSocketGlobal();
  try {
    const packet = vlessPacket('example.com', 80, [1, 2]);
    const early = 'ed.' + btoa(String.fromCharCode(...packet)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
    const request = new Request(`https://example.com/ws/${UUID}/vless`, {
      method: 'GET',
      headers: { upgrade: 'websocket', 'sec-websocket-protocol': early },
    });

    const socket = fakeSocket([Uint8Array.of(8, 9)]);
    const sent = [];
    ws.server.send = (chunk) => sent.push([...toBytes(chunk)]);

    const tasks = [];
    const response = startDataFlowPipeline({
      request,
      session: session('websocket'),
      connector: { connect: () => socket },
      quotaDO: null,
      userAdmin: null,
      ctx: { waitUntil: (p) => { tasks.push(p); return p; } },
    });

    assert.equal(response.status, 101);
    await waitFor(() => sent.length >= 2);
    ws.listeners.get('close')(); // 模拟客户端关闭,结束 upload 半循环
    await Promise.all(tasks);

    // 远端收到首包 payload
    assert.deepEqual(socket.writes, [[1, 2]]);
    // 客户端收到 VLESS 响应头 + 远端回包
    assert.deepEqual(sent, [[1, 0], [8, 9]]);
  } finally {
    ws.restore();
  }
});

// ── gRPC 全链路 ───────────────────────────────────────

test('gRPC + VLESS 全链路:帧封装/解封装正确', async () => {
  const packet = vlessPacket('example.com', 80, [1, 2]);
  const request = new Request(`https://example.com/grpc/${UUID}/vless`, {
    method: 'POST',
    headers: { 'content-type': 'application/grpc' },
    body: encodeGrpcFrame(encodeGrpcHunk(packet)),
    duplex: 'half',
  });

  const socket = fakeSocket([Uint8Array.of(8, 9)]);
  const tasks = [];
  const response = startDataFlowPipeline({
    request,
    session: session('grpc'),
    connector: { connect: () => socket },
    quotaDO: null,
    userAdmin: null,
    ctx: { waitUntil: (p) => { tasks.push(p); return p; } },
  });

  // 先启动响应流消费(TransformStream 背压:不消费则 transport.write 挂起,与 CF 场景一致)
  const responseRead = readGrpcFrames(response.body);
  await Promise.all(tasks);
  assert.deepEqual(socket.writes, [[1, 2]]);
  assert.deepEqual(await responseRead, [[1, 0], [8, 9]]);
});

// ── XHTTP 全链路 ──────────────────────────────────────

test('XHTTP + VLESS 全链路:字节流转发正确', async () => {
  const packet = vlessPacket('example.com', 80, [1, 2]);
  const request = new Request(`https://example.com/xhttp/${UUID}/vless`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-http' },
    body: packet,
    duplex: 'half',
  });

  const socket = fakeSocket([Uint8Array.of(8, 9)]);
  const tasks = [];
  const response = startDataFlowPipeline({
    request,
    session: session('xhttp'),
    connector: { connect: () => socket },
    quotaDO: null,
    userAdmin: null,
    ctx: { waitUntil: (p) => { tasks.push(p); return p; } },
  });

  // 先启动响应流消费(TransformStream 背压)
  const responseRead = readRawFrames(response.body);
  await Promise.all(tasks);
  assert.deepEqual(socket.writes, [[1, 2]]);
  assert.deepEqual(await responseRead, [[1, 0], [8, 9]]);
});
