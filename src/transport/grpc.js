import { readFirstProxyPacket } from '../protocol/parse.js';
import { createTcpConnector } from '../connector/tcp.js';
import { resolveDataFlowSession } from '../proxy/session.js';
import { createStreamBridge } from '../stream/bridge.js';
import { forwardTcpSession } from '../stream/forward.js';
import { handleUdpSession } from '../stream/udp.js';

const GRPC_RESPONSE_HEADERS = {
  'content-type': 'application/grpc',
  'grpc-status': '0',
  'cache-control': 'no-store',
  'x-accel-buffering': 'no',
};

export async function handleGrpcRequest(request, env, ctx, options = {}) {
  if (!request.body) {
    return new Response('Bad Request', { status: 400 });
  }

  const session = await resolveDataFlowSession(request, env);
  if (!session.ok) return session.response;

  if (session.transport !== 'grpc') {
    return new Response('Transport is not enabled for this user', { status: 403 });
  }

  const reader = request.body.getReader();
  let firstFrame;

  try {
    firstFrame = await readGrpcFrame(reader);
  } catch (error) {
    releaseReader(reader);
    return new Response(error?.message || 'Invalid request', { status: 400 });
  }

  if (!firstFrame) {
    releaseReader(reader);
    return new Response('Invalid request', { status: 400 });
  }

  const packetReader = createGrpcPayloadReader(reader, firstFrame.remainder);
  let firstPacket;

  try {
    firstPacket = await readFirstProxyPacket(packetReader, session, options);
  } catch (error) {
    releaseReader(reader);
    return new Response(error?.message || 'Invalid request', { status: 400 });
  }

  if (!firstPacket) {
    releaseReader(reader);
    return new Response('Invalid request', { status: 400 });
  }

  if (firstPacket.isUDP && firstPacket.port !== 53) {
    releaseReader(reader);
    return new Response('UDP is not supported', { status: 400 });
  }

  return new Response(new ReadableStream({
    async start(controller) {
      const bridge = createGrpcBridge(createStreamBridge(controller));

      try {
        await runGrpcSession({
          request,
          session,
          reader: packetReader,
          firstPacket,
          bridge,
        });
      } catch (error) {
        bridge.close(error);
      } finally {
        releaseReader(reader);
        bridge.close();
      }
    },
    cancel() {
      cancelReader(reader);
    },
  }), {
    status: 200,
    headers: GRPC_RESPONSE_HEADERS,
  });
}

async function runGrpcSession({ request, session, reader, firstPacket, bridge }) {
  await writeProtocolResponseHeader(firstPacket, bridge);

  if (firstPacket.isUDP) {
    await handleUdpSession({
      firstPacket,
      bridge,
      connectTcp: createTcpConnector(request),
      session,
    });
    return;
  }

  await forwardTcpSession({
    firstPacket,
    reader,
    bridge,
    connectTcp: createTcpConnector(request),
  });
}

async function readGrpcFrame(reader) {
  const header = await readExact(reader, 5);
  if (!header) return null;
  if (header[0] !== 0) throw new Error('gRPC compression is not supported');

  const payloadLength = new DataView(header.buffer, header.byteOffset, 5).getUint32(1);
  if (payloadLength === 0) {
    return { payload: new Uint8Array(0), remainder: new Uint8Array(0) };
  }

  const payload = await readExact(reader, payloadLength);
  if (!payload) throw new Error('Truncated gRPC frame');

  return { payload, remainder: new Uint8Array(0) };
}

async function readExact(reader, size) {
  if (size === 0) return new Uint8Array(0);

  const chunks = [];
  let total = 0;
  while (total < size) {
    const { done, value } = await reader.read();
    if (done) return null;
    const chunk = toUint8Array(value);
    if (!chunk.byteLength) continue;
    chunks.push(chunk);
    total += chunk.byteLength;
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged.length > size ? merged.slice(0, size) : merged;
}

function createGrpcPayloadReader(reader, initialPayload) {
  let initial = toUint8Array(initialPayload);
  return {
    async read() {
      if (initial && initial.byteLength > 0) {
        const value = initial;
        initial = new Uint8Array(0);
        return { done: false, value };
      }
      return reader.read();
    },
    releaseLock() {
      try {
        reader.releaseLock();
      } catch {
        // Ignore release races.
      }
    },
  };
}

function createGrpcBridge(baseBridge) {
  return {
    get closed() {
      return baseBridge.closed;
    },
    send(value) {
      const chunk = toUint8Array(value);
      if (!chunk.byteLength) return false;
      const framed = new Uint8Array(5 + chunk.byteLength);
      framed[0] = 0;
      framed[1] = (chunk.byteLength >>> 24) & 0xff;
      framed[2] = (chunk.byteLength >>> 16) & 0xff;
      framed[3] = (chunk.byteLength >>> 8) & 0xff;
      framed[4] = chunk.byteLength & 0xff;
      framed.set(chunk, 5);
      return baseBridge.send(framed);
    },
    close(error) {
      baseBridge.close(error);
    },
  };
}

async function writeProtocolResponseHeader(firstPacket, bridge) {
  if (firstPacket.responseHeader?.byteLength) {
    bridge.send(firstPacket.responseHeader);
  }
}

function releaseReader(reader) {
  try {
    reader.releaseLock();
  } catch {
    // Ignore close races.
  }
}

function cancelReader(reader) {
  try {
    const cancelled = reader.cancel();
    if (cancelled?.catch) cancelled.catch(() => {});
  } catch {
    // Ignore close races.
  }
}

function toUint8Array(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (typeof value === 'string') return new TextEncoder().encode(value);
  return new Uint8Array(value || 0);
}
