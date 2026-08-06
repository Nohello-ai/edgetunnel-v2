import { AppError } from '../core/errors.js';
import { DEFAULT_TRANSPORT_LIMITS } from './limits.js';

/**
 * WebSocket 传输。
 *
 * runtime 参数仅用于测试注入(mock WebSocketPair/Response),默认取全局环境。
 * 生产调用链(registry → 本函数)不再传递 runtime,彻底避免把配置对象误当
 * 运行时导致 WS 一律 501 的问题。
 */
export function openWebSocketTransport(request, limits = {}, runtime = globalThis) {
  if (request.method !== 'GET' || request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
    throw new AppError('INVALID_WEBSOCKET_REQUEST', 400);
  }
  const Pair = runtime.WebSocketPair;
  const Resp = runtime.Response || globalThis.Response;
  if (!Pair || !Resp) throw new AppError('WEBSOCKET_UNAVAILABLE', 501);

  const maxFrameBytes = Math.max(1, Number(limits?.maxFrameBytes) || DEFAULT_TRANSPORT_LIMITS.maxFrameBytes);
  const maxQueuedBytes = Math.max(1024, Number(limits?.maxQueuedBytes) || DEFAULT_TRANSPORT_LIMITS.maxQueuedBytes);
  const maxQueueSize = Math.max(16, Number(limits?.maxQueueSize) || DEFAULT_TRANSPORT_LIMITS.maxQueueSize);

  const pair = new Pair();
  const client = pair[0];
  const server = pair[1];
  server.binaryType = 'arraybuffer';
  server.accept();

  const queue = [];
  let queuedBytes = 0;
  let controller;
  let closed = false;

  const readable = new ReadableStream({
    start(value) { controller = value; },
    pull() {
      const chunk = queue.shift();
      if (!chunk) return;
      queuedBytes -= chunk.byteLength;
      if (queuedBytes < 0) queuedBytes = 0;
      try { controller.enqueue(chunk); } catch {}
    },
    cancel() { try { server.close(1000, 'cancelled'); } catch {} },
  });

  server.addEventListener('message', async (event) => {
    if (closed) return;
    if (typeof event.data === 'string') {
      fail(new AppError('WEBSOCKET_TEXT_UNSUPPORTED', 400), 1003, 'binary only');
      return;
    }
    const chunk = event.data instanceof Blob ? new Uint8Array(await event.data.arrayBuffer()) : toBytes(event.data);
    if (chunk.byteLength > maxFrameBytes || queuedBytes + chunk.byteLength > maxQueuedBytes || queue.length >= maxQueueSize) {
      fail(new AppError('WEBSOCKET_BUFFER_LIMIT', 413), 1009, 'message too large');
      return;
    }
    if (controller?.desiredSize > 0 && queue.length === 0) controller.enqueue(chunk);
    else { queue.push(chunk); queuedBytes += chunk.byteLength; }
  });
  server.addEventListener('close', () => { closed = true; try { controller?.close(); } catch {} });
  server.addEventListener('error', (event) => {
    closed = true;
    try { controller?.error(event.error || new Error('websocket error')); } catch {}
  });

  const earlyData = readEarlyData(request.headers.get('sec-websocket-protocol'));
  if (earlyData.bytes.byteLength && controller) controller.enqueue(earlyData.bytes);

  return {
    readable,
    async write(chunk) {
      if (closed) return;
      try { server.send(toBytes(chunk)); } catch { closed = true; }
    },
    async close(reason) {
      if (closed) return;
      closed = true;
      try { server.close(reason ? 1011 : 1000, reason ? String(reason?.message || reason).slice(0, 120) : 'done'); } catch {}
    },
    response: new Resp(null, {
      status: 101,
      webSocket: client,
      headers: earlyData.protocol ? { 'sec-websocket-protocol': earlyData.protocol } : undefined,
    }),
    metadata: Object.freeze({ name: 'websocket' }),
  };

  function fail(error, code, reason) {
    closed = true;
    try { controller?.error(error); } catch {}
    try { server.close(code, reason); } catch {}
  }
}

function readEarlyData(header) {
  if (!header) return { protocol: '', bytes: new Uint8Array() };
  const protocol = String(header).split(',')[0].trim();
  if (!protocol.startsWith('ed.')) return { protocol: '', bytes: new Uint8Array() };
  const payload = protocol.slice(3);
  if (!/^[A-Za-z0-9_-]+$/.test(payload)) return { protocol: '', bytes: new Uint8Array() };
  try {
    const normalized = payload.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(payload.length / 4) * 4, '=');
    return { protocol, bytes: Uint8Array.from(atob(normalized), (char) => char.charCodeAt(0)) };
  } catch {
    return { protocol: '', bytes: new Uint8Array() };
  }
}

function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return new Uint8Array();
}
