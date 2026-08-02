import { AppError } from '../core/errors.js';
import { resolveDnsOverTcp } from '../dns/service.js';
import { createProtocolParser } from '../protocol-v2/registry.js';
import { createDatagramCodec } from '../protocol-v2/datagram.js';
import { openTransport } from '../transport-v2/registry.js';
import { createUsageMeter } from '../usage/meter.js';

export function startDataFlowPipeline({ request, session, connector, quotaDO, userAdmin, ctx, runtime }) {
  const transport = openTransport(session.transport, request, undefined, runtime);
  const remaining = session.quotaBytes > 0 ? Math.max(0, session.quotaBytes - Number(session.usage.total || 0)) : 0;
  if (session.quotaBytes > 0 && remaining <= 0) {
    transport.close(new AppError('TRAFFIC_QUOTA_EXHAUSTED', 403)).catch(() => {});
    throw new AppError('TRAFFIC_QUOTA_EXHAUSTED', 403);
  }
  const meter = createUsageMeter({
    userID: session.userID,
    quotaDO: quotaDO || null,
    userAdmin: userAdmin || null,
    ctx,
    stopVersion: session.resetVersion,
    onLimit: () => transport.close(new AppError('TRAFFIC_QUOTA_EXHAUSTED', 403)).catch(() => {}),
  });
  const task = runPipeline({ transport, session, connector, meter })
    .catch(async (error) => { try { await transport.close(error); } catch {} })
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
    const headerTimeout = new Promise((_, reject) => {
      setTimeout(() => reject(new AppError('PROTOCOL_HEADER_TIMEOUT', 408)), 10000);
    });
    while (!parsed) {
      const { done, value } = await Promise.race([reader.read(), headerTimeout]);
      if (done) throw new AppError('INCOMPLETE_PROTOCOL_HEADER', 400);
      meter.addUpload(value.byteLength);
      const result = parser.push(value);
      if (result.status === 'error') throw new AppError(result.code, 400);
      if (result.status === 'ready') {
        parsed = result.request;
      }
      if (result.status !== 'need-more' && result.status !== 'ready' && result.status !== 'error') {
        throw new AppError('UNEXPECTED_PARSER_STATUS', 500);
      }
    }

    if (parsed.isUDP) return forwardDnsDatagrams({ reader, transport, connector, request: parsed, protocol: session.protocol, meter });
    await forwardTcp({ reader, transport, connector, request: parsed, meter });
  } finally {
    try { reader.releaseLock(); } catch {}
  }
}

async function forwardDnsDatagrams({ reader, transport, connector, request, protocol, meter }) {
  const codec = createDatagramCodec(protocol, request);
  let responseHeaderPending = request.responseHeader || new Uint8Array();
  let chunk = request.payload;
  while (true) {
    const datagrams = codec.push(chunk);
    if (datagrams.length > 0) {
      for (const d of datagrams) {
        if (d.port !== 53) throw new AppError('UDP_UNSUPPORTED', 400);
      }
      const responses = await Promise.all(datagrams.map(async (datagram) => {
        const dnsPromise = resolveDnsOverTcp({ payload: datagram.payload, connector, hostname: datagram.hostname, port: 53 });
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new AppError('DNS_TIMEOUT', 504)), 5000));
        const payload = await Promise.race([dnsPromise, timeout]);
        return codec.encode({ ...datagram, payload });
      }));
      for (const response of responses) {
        if (responseHeaderPending.byteLength) {
          await transport.write(responseHeaderPending);
          meter.addDownload(responseHeaderPending.byteLength);
          responseHeaderPending = new Uint8Array();
        }
        meter.addDownload(response.byteLength);
        await transport.write(response);
      }
    }
    const next = await reader.read();
    if (next.done) break;
    chunk = next.value;
    meter.addUpload(chunk.byteLength);
  }
  codec.finish();
  try { await transport.close(); } catch {}
}

async function forwardTcp({ reader, transport, connector, request, meter }) {
  const socket = connector.connect({ hostname: request.hostname, port: request.port });

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
      if (request.responseHeader?.byteLength) {
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
    }
  })();

  try {
    const results = await Promise.allSettled([upload, download]);
    const failure = results.find((result) => result.status === 'rejected');
    if (failure) throw failure.reason;
    try { await transport.close(); } catch {}
  } finally {
    try { remoteWriter.releaseLock(); } catch {}
    try { remoteReader.releaseLock(); } catch {}
    try { await socket.close(); } catch {}
  }
}