import { AppError } from '../core/errors.js';
import { resolveDnsOverTcp } from '../dns/service.js';
import { createProtocolParser } from '../protocol-v2/registry.js';
import { createDatagramCodec } from '../protocol-v2/datagram.js';
import { openTransport } from '../transport-v2/registry.js';
import { createUsageMeter } from '../usage/meter.js';

export function startDataFlowPipeline({ request, session, connector, usageRepository, ctx, runtime }) {
  const transport = openTransport(session.transport, request, undefined, runtime);
  const remaining = session.quotaBytes > 0 ? Math.max(0, session.quotaBytes - Number(session.usage.total || 0)) : 0;
  const meter = createUsageMeter({ userID: session.userID, repository: usageRepository, ctx, maxBytes: remaining });
  const task = runPipeline({ transport, session, connector, meter })
    .catch(async (error) => { await transport.close(error); })
    .finally(() => meter.flush());
  ctx?.waitUntil?.(task);
  return transport.response;
}

export async function runPipeline({ transport, session, connector, meter }) {
  const parser = createProtocolParser(session.protocol, {
    userID: session.userID,
    secret: session.user.trojanSecret,
  });
  const reader = transport.readable.getReader();
  let parsed;

  try {
    while (!parsed) {
      const { done, value } = await reader.read();
      if (done) throw new AppError('INCOMPLETE_PROTOCOL_HEADER', 400);
      meter.addUpload(value.byteLength);
      const result = parser.push(value);
      if (result.status === 'error') throw new AppError(result.code, 400);
      if (result.status === 'ready') parsed = result.request;
    }

    if (parsed.isUDP) return forwardDnsDatagrams({ reader, transport, connector, request: parsed, protocol: session.protocol, meter });

    await forwardTcp({ reader, transport, connector, request: parsed, meter });
  } finally {
    try { reader.releaseLock(); } catch {}
  }
}

async function forwardDnsDatagrams({ reader, transport, connector, request, protocol, meter }) {
  const codec = createDatagramCodec(protocol, request);
  let responseHeaderPending = request.responseHeader;
  let chunk = request.payload;
  while (true) {
    for (const datagram of codec.push(chunk)) {
      if (datagram.port !== 53) throw new AppError('UDP_UNSUPPORTED', 400);
      const payload = await resolveDnsOverTcp({ payload: datagram.payload, connector, hostname: datagram.hostname, port: 53 });
      const response = codec.encode({ ...datagram, payload });
      if (responseHeaderPending.byteLength) {
        await transport.write(responseHeaderPending);
        meter.addDownload(responseHeaderPending.byteLength);
        responseHeaderPending = new Uint8Array();
      }
      meter.addDownload(response.byteLength);
      await transport.write(response);
    }
    const next = await reader.read();
    if (next.done) break;
    chunk = next.value;
    meter.addUpload(chunk.byteLength);
  }
  codec.finish();
  await transport.close();
}

async function forwardTcp({ reader, transport, connector, request, meter }) {
  const socket = connector.connect({ hostname: request.hostname, port: request.port });

  // 建连超时 5 秒
  if (socket.opened) {
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new AppError('TCP_CONNECT_TIMEOUT', 408)), 5000); });
    await Promise.race([socket.opened, timeout]);
    clearTimeout(timer);
  }
  const remoteWriter = socket.writable.getWriter();
  const remoteReader = socket.readable.getReader();

  const upload = (async () => {
    try {
      if (request.payload.byteLength) await remoteWriter.write(request.payload);
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        meter.addUpload(value.byteLength);
        await remoteWriter.write(value);
      }
      await remoteWriter.close();
    } catch (error) {
      await remoteReader.cancel(error).catch(() => {});
      throw error;
    }
  })();

  const download = (async () => {
    try {
      if (request.responseHeader.byteLength) {
        await transport.write(request.responseHeader);
        meter.addDownload(request.responseHeader.byteLength);
      }
      while (true) {
        const { done, value } = await remoteReader.read();
        if (done) break;
        meter.addDownload(value.byteLength);
        await transport.write(value);
      }
    } catch (error) {
      await reader.cancel(error).catch(() => {});
      throw error;
    } finally {
      await reader.cancel('remote closed').catch(() => {});
    }
  })();

  try {
    const results = await Promise.allSettled([upload, download]);
    const failure = results.find((result) => result.status === 'rejected');
    if (failure) throw failure.reason;
    await transport.close();
  } finally {
    try { remoteWriter.releaseLock(); } catch {}
    try { remoteReader.releaseLock(); } catch {}
    try { await socket.close(); } catch {}
  }
}
