import { AppError } from '../core/errors.js';
import { resolveDnsOverTcp } from '../dns/service.js';
import { createProtocolParser, detectProtocol } from '../protocol-v2/registry.js';
import { createDatagramCodec } from '../protocol-v2/datagram.js';
import { openTransport } from '../transport-v2/registry.js';
import { createUsageMeter } from '../usage/meter.js';
import { appendBytes } from '../protocol-v2/helpers.js';

export function startDataFlowPipeline({ request, session, connector, quotaDO, userAdmin, ctx, runtime }) {
  console.log(`[pipeline:1] startDataFlowPipeline: transport=${session.transport} userID=${session.userID}`);
  console.log('[pipeline:1] calling openTransport...');
  const transport = openTransport(session.transport, request, undefined, runtime);
  console.log(`[pipeline:1] openTransport succeeded: response.status=${transport.response.status} ws=${!!transport.response.webSocket}`);

  const remaining = session.quotaBytes > 0 ? Math.max(0, session.quotaBytes - Number(session.usage.total || 0)) : 0;
  console.log(`[pipeline:2] quota check: quotaBytes=${session.quotaBytes} used=${session.usage.total} remaining=${remaining}`);
  if (session.quotaBytes > 0 && remaining <= 0) {
    console.log('[pipeline:2] QUOTA EXHAUSTED, closing transport');
    transport.close(new AppError('TRAFFIC_QUOTA_EXHAUSTED', 403)).catch(() => {});
    throw new AppError('TRAFFIC_QUOTA_EXHAUSTED', 403);
  }

  console.log('[pipeline:3] creating usage meter...');
  const meter = createUsageMeter({
    userID: session.userID,
    quotaDO: quotaDO || null,
    userAdmin: userAdmin || null,
    ctx,
    stopVersion: session.resetVersion,
    onLimit: () => transport.close(new AppError('TRAFFIC_QUOTA_EXHAUSTED', 403)).catch(() => {}),
  });
  console.log('[pipeline:3] meter created, starting runPipeline...');

  const task = runPipeline({ transport, session, connector, meter })
    .catch(async (error) => {
      console.error(`[pipeline:ERR] runPipeline error: ${error.constructor?.name} code=${error.code} message=${error.message}`);
      try { await transport.close(error); } catch {}
    })
    .finally(() => {
      console.log('[pipeline:finally] flushing meter');
      meter.flush();
    });
  ctx?.waitUntil?.(task);
  console.log('[pipeline:4] returning transport.response');
  return transport.response;
}

export async function runPipeline({ transport, session, connector, meter }) {
  console.log(`[runPipeline:1] entry: userID=${session.userID} transport=${session.transport}`);
  const reader = transport.readable.getReader();
  let parsed;
  let detectedProtocol;
  let parser;
  let buffer = new Uint8Array();

  try {
    console.log('[runPipeline:2] waiting for protocol header (10s timeout)...');
    const headerTimeout = new Promise((_, reject) => {
      setTimeout(() => reject(new AppError('PROTOCOL_HEADER_TIMEOUT', 408)), 10000);
    });
    let loopCount = 0;
    while (!parsed) {
      loopCount++;
      console.log(`[runPipeline:2] loop ${loopCount}: reading from transport...`);
      const { done, value } = await Promise.race([reader.read(), headerTimeout]);
      if (done) {
        console.log('[runPipeline:2] transport stream ended before header parsed');
        throw new AppError('INCOMPLETE_PROTOCOL_HEADER', 400);
      }
      console.log(`[runPipeline:2] got ${value.byteLength} bytes from transport`);
      meter.addUpload(value.byteLength);

      if (!detectedProtocol) {
        buffer = appendBytes(buffer, value);
        detectedProtocol = detectProtocol(buffer, session.user);
        if (detectedProtocol) {
          console.log(`[runPipeline:2] detected protocol: ${detectedProtocol}`);
          parser = createProtocolParser(detectedProtocol, {
            userID: session.userID,
            secret: session.user.trojanSecret,
          });
        }
      } else {
        buffer = value;
      }

      if (parser) {
        const result = parser.push(buffer);
        console.log(`[runPipeline:2] parser status: ${result.status}${result.code ? ' code=' + result.code : ''}`);
        if (result.status === 'error') throw new AppError(result.code, 400);
        if (result.status === 'ready') {
          parsed = result.request;
          console.log(`[runPipeline:2] parsed: ${parsed.hostname}:${parsed.port} isUDP=${parsed.isUDP} payload=${parsed.payload.byteLength}b`);
        }
      }
    }

    if (parsed.isUDP) {
      console.log('[runPipeline:3] UDP DNS resolution, forwarding datagrams...');
      return forwardDnsDatagrams({ reader, transport, connector, request: parsed, protocol: detectedProtocol, meter });
    }
    console.log(`[runPipeline:3] TCP forward to ${parsed.hostname}:${parsed.port}...`);
    await forwardTcp({ reader, transport, connector, request: parsed, meter });
    console.log('[runPipeline:4] TCP forward completed');
  } finally {
    console.log('[runPipeline:finally] releasing reader lock');
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
  console.log(`[forwardTcp:1] connecting to ${request.hostname}:${request.port}...`);
  const socket = connector.connect({ hostname: request.hostname, port: request.port });
  console.log(`[forwardTcp:1] socket created: opened=${!!socket.opened} closed=${!!socket.closed}`);

  if (socket.opened) {
    console.log('[forwardTcp:2] waiting for socket open (5s timeout)...');
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new AppError('TCP_CONNECT_TIMEOUT', 408)), 5000); });
    try {
      await Promise.race([socket.opened, timeout]);
      console.log('[forwardTcp:2] socket opened successfully');
    } catch (err) {
      console.error(`[forwardTcp:2] socket open error: ${err.message}`);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  const remoteWriter = socket.writable.getWriter();
  const remoteReader = socket.readable.getReader();
  console.log('[forwardTcp:3] starting upload/download pipes');

  const upload = (async () => {
    try {
      if (request.payload.byteLength) {
        console.log(`[forwardTcp:upload] writing ${request.payload.byteLength}b payload`);
        await remoteWriter.write(request.payload);
      }
      let count = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          console.log('[forwardTcp:upload] transport stream ended');
          break;
        }
        count++;
        meter.addUpload(value.byteLength);
        await remoteWriter.write(value);
        if (count % 10 === 0) console.log(`[forwardTcp:upload] ${count} chunks sent, ${value.byteLength}b last`);
      }
      await remoteWriter.close();
      console.log(`[forwardTcp:upload] completed: ${count} chunks total`);
    } catch (error) {
      console.error(`[forwardTcp:upload] error: ${error.message}`);
      await remoteReader.cancel(error).catch(() => {});
      throw error;
    }
  })();

  const download = (async () => {
    try {
      if (request.responseHeader?.byteLength) {
        console.log(`[forwardTcp:download] writing ${request.responseHeader.byteLength}b response header`);
        await transport.write(request.responseHeader);
        meter.addDownload(request.responseHeader.byteLength);
      }
      let count = 0;
      while (true) {
        const { done, value } = await remoteReader.read();
        if (done) {
          console.log('[forwardTcp:download] remote socket ended');
          break;
        }
        count++;
        meter.addDownload(value.byteLength);
        await transport.write(value);
        if (count % 10 === 0) console.log(`[forwardTcp:download] ${count} chunks received, ${value.byteLength}b last`);
      }
      console.log(`[forwardTcp:download] completed: ${count} chunks total`);
    } catch (error) {
      console.error(`[forwardTcp:download] error: ${error.message}`);
      await reader.cancel(error).catch(() => {});
      throw error;
    }
  })();

  try {
    console.log('[forwardTcp:4] waiting for upload/download to complete...');
    const results = await Promise.allSettled([upload, download]);
    const failure = results.find((result) => result.status === 'rejected');
    if (failure) {
      console.error(`[forwardTcp:4] pipe failed: ${failure.reason.message}`);
      throw failure.reason;
    }
    console.log('[forwardTcp:4] both pipes completed, closing transport');
    try { await transport.close(); } catch {}
  } finally {
    console.log('[forwardTcp:finally] cleanup: releasing writers/readers');
    try { remoteWriter.releaseLock(); } catch {}
    try { remoteReader.releaseLock(); } catch {}
    try { await socket.close(); } catch {}
  }
}