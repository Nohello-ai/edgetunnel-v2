import { readFirstProxyPacket } from '../protocol/parse.js';
import { createTcpConnector } from '../connector/tcp.js';
import { resolveDataFlowSession } from '../proxy/session.js';
import { forwardTcpSession } from '../stream/forward.js';
import { handleUdpSession } from '../stream/udp.js';

const WS_RESPONSE_HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'application/octet-stream',
};

export async function handleWebSocketRequest(request, env, ctx, options = {}) {
  const upgradeHeader = request.headers.get('upgrade') || '';
  if (upgradeHeader.toLowerCase() !== 'websocket') {
    return new Response('Bad Request', { status: 400 });
  }

  const session = await resolveDataFlowSession(request, env);
  if (!session.ok) return session.response;

  if (session.transport !== 'ws') {
    return new Response('Transport is not enabled for this user', { status: 403 });
  }

  const pair = new WebSocketPair();
  const client = pair[0];
  const server = pair[1];

  server.accept();
  server.binaryType = 'arraybuffer';

  let firstPacketReader;
  let bridge;
  let stopped = false;
  const inboundQueue = createWebSocketChunkQueue();
  const inboundReader = inboundQueue.reader();

  server.addEventListener('message', (event) => {
    if (stopped) return;
    inboundQueue.push(event.data);
  });

  server.addEventListener('close', () => {
    stopped = true;
    inboundQueue.close();
    bridge?.close();
  });

  server.addEventListener('error', () => {
    stopped = true;
    inboundQueue.close();
    bridge?.close();
  });

  firstPacketReader = inboundReader;

  let firstPacket;
  try {
    firstPacket = await readFirstProxyPacket(firstPacketReader, session, options);
  } catch (error) {
    inboundQueue.close();
    try {
      server.close(1002, error?.message || 'Invalid request');
    } catch {
      // Ignore close races.
    }
    return new Response(null, { status: 101, webSocket: client, headers: WS_RESPONSE_HEADERS });
  }

  if (!firstPacket) {
    inboundQueue.close();
    try {
      server.close(1002, 'Invalid request');
    } catch {
      // Ignore close races.
    }
    return new Response(null, { status: 101, webSocket: client, headers: WS_RESPONSE_HEADERS });
  }

  if (firstPacket.isUDP && firstPacket.protocol !== 'trojan' && firstPacket.port !== 53) {
    inboundQueue.close();
    try {
      server.close(1003, 'UDP is not supported');
    } catch {
      // Ignore close races.
    }
    return new Response(null, { status: 101, webSocket: client, headers: WS_RESPONSE_HEADERS });
  }

  bridge = createWebSocketBridge(server);

  queueMicrotask(async () => {
    try {
      await runWebSocketSession({ request, session, firstPacket, bridge, inboundQueue, reader: firstPacketReader, queueReader: inboundReader });
    } catch (error) {
      bridge.close(error);
    } finally {
      stopped = true;
      inboundQueue.close();
      try {
        server.close();
      } catch {
        // Ignore close races.
      }
    }
  });

  return new Response(null, {
    status: 101,
    webSocket: client,
    headers: WS_RESPONSE_HEADERS,
  });
}

async function runWebSocketSession({ request, session, firstPacket, bridge, inboundQueue, reader, queueReader }) {
  await writeProtocolResponseHeader(firstPacket, bridge);

  if (firstPacket.isUDP) {
    await handleUdpSession({
      firstPacket,
      bridge,
      connectTcp: createTcpConnector(request),
      request,
      session,
    });
    return;
  }

  const combinedReader = createCombinedReader(reader, queueReader);
  await forwardTcpSession({
    firstPacket,
    reader: combinedReader,
    bridge,
    connectTcp: createTcpConnector(request),
  });
}

async function writeProtocolResponseHeader(firstPacket, bridge) {
  if (firstPacket.responseHeader?.byteLength) {
    bridge.send(firstPacket.responseHeader);
  }
}

function createWebSocketBridge(socket) {
  let closed = false;

  return {
    get closed() {
      return closed;
    },
    send(value) {
      if (closed) return false;
      try {
        socket.send(toUint8Array(value));
        return true;
      } catch {
        closed = true;
        return false;
      }
    },
    close(error) {
      if (closed) return;
      closed = true;
      try {
        if (error) {
          socket.close(1011, error?.message || 'internal error');
        } else {
          socket.close();
        }
      } catch {
        // Ignore close races.
      }
    },
  };
}

function createWebSocketChunkQueue() {
  const chunks = [];
  const waiters = [];
  let closed = false;

  return {
    push(value) {
      if (closed) return;
      const chunk = toUint8Array(value);
      if (chunk.byteLength === 0) return;
      if (waiters.length > 0) {
        const waiter = waiters.shift();
        waiter({ done: false, value: chunk });
        return;
      }
      chunks.push(chunk);
    },
    close() {
      if (closed) return;
      closed = true;
      while (waiters.length > 0) {
        const waiter = waiters.shift();
        waiter({ done: true });
      }
    },
    reader() {
      return {
        read() {
          if (chunks.length > 0) {
            return Promise.resolve({ done: false, value: chunks.shift() });
          }
          if (closed) return Promise.resolve({ done: true });
          return new Promise((resolve) => {
            waiters.push(resolve);
          });
        },
        releaseLock() {
          // Queue-backed reader has no lock to release.
        },
      };
    },
  };
}

function createCombinedReader(initialReader, queueReader) {
  let initialDone = false;

  return {
    async read() {
      if (!initialDone) {
        const first = await initialReader.read();
        if (!first.done) return first;
        initialDone = true;
      }
      return queueReader.read();
    },
    releaseLock() {
      try {
        initialReader.releaseLock();
      } catch {
        // Ignore release races.
      }
    },
  };
}

function toUint8Array(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (typeof value === 'string') return new TextEncoder().encode(value);
  return new Uint8Array(value || 0);
}
