import { readFirstProxyPacket } from '../protocol/parse.js';
import { createTcpConnector } from '../connector/tcp.js';
import { resolveDataFlowSession } from '../proxy/session.js';
import { createStreamBridge } from '../stream/bridge.js';
import { forwardTcpSession } from '../stream/forward.js';
import { handleUdpSession } from '../stream/udp.js';

const XHTTP_RESPONSE_HEADERS = {
  'content-type': 'application/octet-stream',
  'x-accel-buffering': 'no',
  'cache-control': 'no-store',
};

export async function handleXhttpRequest(request, env, ctx, options = {}) {
  if (!request.body) {
    return new Response('Bad Request', { status: 400 });
  }

  const session = await resolveDataFlowSession(request, env);
  if (!session.ok) return session.response;

  if (session.transport !== 'xhttp') {
    return new Response('Transport is not enabled for this user', { status: 403 });
  }

  const reader = request.body.getReader();
  let firstPacket;

  try {
    firstPacket = await readFirstProxyPacket(reader, session, options);
  } catch (error) {
    releaseReader(reader);
    return new Response(error?.message || 'Invalid request', { status: 400 });
  }

  if (!firstPacket) {
    releaseReader(reader);
    return new Response('Invalid request', { status: 400 });
  }

  if (firstPacket.isUDP && firstPacket.protocol !== 'trojan' && firstPacket.port !== 53) {
    releaseReader(reader);
    return new Response('UDP is not supported', { status: 400 });
  }

  return new Response(new ReadableStream({
    async start(controller) {
      const bridge = createStreamBridge(controller);

      try {
        await runXhttpSession({
          request,
          env,
          ctx,
          session,
          reader,
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
    headers: XHTTP_RESPONSE_HEADERS,
  });
}

async function runXhttpSession({ request, session, reader, firstPacket, bridge }) {
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

  await forwardTcpSession({
    firstPacket,
    reader,
    bridge,
    connectTcp: createTcpConnector(request),
  });
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
    // The stream may already be locked by a pending read or closed by the runtime.
  }
}

function cancelReader(reader) {
  try {
    const cancelled = reader.cancel();
    if (cancelled?.catch) cancelled.catch(() => {});
  } catch {
    // Ignore close races from client disconnects.
  }
}
