import { AppError } from '../core/errors.js';
import { DEFAULT_TRANSPORT_LIMITS } from './limits.js';

export function openWebSocketTransport(request, limits = {}, runtime = globalThis) {
  if (request.method !== 'GET' || request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
    throw new AppError('INVALID_WEBSOCKET_REQUEST', 400);
  }
  const Pair = runtime.WebSocketPair;
  if (!Pair) throw new AppError('WEBSOCKET_UNAVAILABLE', 501);
  const pair = new Pair();
  const client = pair[0];
  const server = pair[1];
  server.binaryType = 'arraybuffer';
  server.accept();

  const maxFrameBytes = Number(limits?.maxFrameBytes || DEFAULT_TRANSPORT_LIMITS.maxFrameBytes);
  const maxQueuedBytes = Number(limits?.maxQueuedBytes || DEFAULT_TRANSPORT_LIMITS.maxQueuedBytes);
  const queue = [];
  let queuedBytes = 0;
  let controller;
  let closed = false;
  const readable = new ReadableStream({
    start(value) { controller = value; },
    pull() {
      const chunk = queue.shift();
      if (chunk) { queuedBytes -= chunk.byteLength; controller.enqueue(chunk); }
    },
    cancel() { try { server.close(1000, 'cancelled'); } catch {} },
  });
  server.addEventListener('message', async (event) => {
    if (typeof event.data === 'string') {
      controller.error(new AppError('WEBSOCKET_TEXT_UNSUPPORTED', 400));
      try { server.close(1003, 'binary only'); } catch {}
      return;
    }
    const chunk = event.data instanceof Blob ? new Uint8Array(await event.data.arrayBuffer()) : toBytes(event.data);
    if (chunk.byteLength > maxFrameBytes || queuedBytes + chunk.byteLength > maxQueuedBytes) {
      closed = true;
      try { controller.error(new AppError('WEBSOCKET_BUFFER_LIMIT', 413)); } catch {}
      try { server.close(1009, 'message too large'); } catch {}
      return;
    }
    if (controller.desiredSize > 0 && queue.length === 0) controller.enqueue(chunk);
    else { queue.push(chunk); queuedBytes += chunk.byteLength; }
  });
  server.addEventListener('close', () => { closed = true; try { controller.close(); } catch {} });
  server.addEventListener('error', (event) => { closed = true; try { controller.error(event.error || new Error('websocket error')); } catch {} });

  const earlyData = readEarlyData(request.headers.get('sec-websocket-protocol'));
  if (earlyData.bytes.byteLength) controller.enqueue(earlyData.bytes);

  return {
    readable,
    async write(chunk) { if (!closed) server.send(toBytes(chunk)); },
    async close(reason) {
      if (closed) return;
      closed = true;
      try { server.close(reason ? 1011 : 1000, reason ? 'pipeline error' : 'done'); } catch {}
    },
    response: new runtime.Response(null, {
      status: 101,
      webSocket: client,
      headers: earlyData.protocol ? { 'sec-websocket-protocol': earlyData.protocol } : undefined,
    }),
    metadata: Object.freeze({ name: 'websocket' }),
  };
}

function readEarlyData(header) {
  const protocol = String(header || '').split(',')[0].trim();
  // 只识别 ed. 前缀的 early-data，避免普通子协议被误解析
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
