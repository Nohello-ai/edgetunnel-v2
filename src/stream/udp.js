export async function handleUdpSession({ firstPacket, bridge, connectTcp, session }) {
  if (!firstPacket?.isUDP) {
    throw new Error('packet is not UDP');
  }

  if (firstPacket.protocol === 'trojan') {
    return handleTrojanUdp({ firstPacket, bridge, connectTcp, session });
  }

  if (firstPacket.port !== 53) {
    throw new Error('UDP is not supported');
  }

  await forwardDnsOverTcp({
    payload: firstPacket.payload,
    bridge,
    connectTcp,
    targetHost: getUdpDnsHost(session, firstPacket),
    targetPort: getUdpDnsPort(session, firstPacket),
    responseHeader: firstPacket.responseHeader,
  });
}

async function handleTrojanUdp({ firstPacket, bridge, connectTcp, session }) {
  if (firstPacket.port !== 53) {
    throw new Error('UDP is not supported');
  }

  const udpContext = {
    buffer: firstPacket.payload,
    targetHost: firstPacket.hostname,
    targetPort: firstPacket.port,
    proxyAddress: session?.config?.proxyAddress || null,
  };

  if (!udpContext.targetHost) {
    throw new Error('UDP is not supported');
  }

  await forwardDnsOverTcp({
    payload: udpContext.buffer,
    bridge,
    connectTcp,
    targetHost: udpContext.proxyAddress || udpContext.targetHost,
    targetPort: udpContext.targetPort,
    responseHeader: null,
  });
}

async function forwardDnsOverTcp({ payload, bridge, connectTcp, targetHost, targetPort, responseHeader }) {
  const socket = connectTcp({ hostname: targetHost, port: targetPort });
  let writer;
  let reader;

  try {
    if (socket.opened) await socket.opened;
    writer = socket.writable.getWriter();
    await writer.write(frameDnsQuery(payload));
    try { writer.releaseLock(); } catch {
      // Ignore close races.
    }
    writer = null;

    reader = socket.readable.getReader();
    const response = await readDnsResponse(reader);
    if (!response || !response.byteLength) return;

    if (responseHeader?.byteLength) {
      bridge.send(responseHeader);
    }
    bridge.send(response);
  } finally {
    try { reader?.releaseLock(); } catch {
      // Ignore close races.
    }
    try { writer?.releaseLock(); } catch {
      // Ignore close races.
    }
    try { socket.close(); } catch {
      // Ignore close races.
    }
  }
}

async function readDnsResponse(reader) {
  const header = await readExactBytes(reader, 2);
  if (!header) return null;

  const length = (header[0] << 8) | header[1];
  if (length <= 0) return null;

  const payload = await readExactBytes(reader, length);
  if (!payload || payload.byteLength !== length) return null;

  const response = new Uint8Array(2 + payload.byteLength);
  response.set(header, 0);
  response.set(payload, 2);
  return response;
}

async function readExactBytes(reader, expectedLength) {
  const chunks = [];
  let total = 0;

  while (total < expectedLength) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = toUint8Array(value);
    if (!chunk.byteLength) continue;

    chunks.push(chunk);
    total += chunk.byteLength;
  }

  if (total === 0) return null;

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  if (merged.byteLength <= expectedLength) return merged;
  return merged.slice(0, expectedLength);
}

function frameDnsQuery(payload) {
  const data = toUint8Array(payload);
  const framed = new Uint8Array(data.byteLength + 2);
  framed[0] = (data.byteLength >>> 8) & 0xff;
  framed[1] = data.byteLength & 0xff;
  framed.set(data, 2);
  return framed;
}

function getUdpDnsHost(session, firstPacket) {
  const udpConfig = session?.config?.udp && typeof session.config.udp === 'object' ? session.config.udp : {};
  return udpConfig.dnsHost || firstPacket.hostname || '8.8.4.4';
}

function getUdpDnsPort(session, firstPacket) {
  const udpConfig = session?.config?.udp && typeof session.config.udp === 'object' ? session.config.udp : {};
  return Number(udpConfig.dnsPort || firstPacket.port || 53);
}

function toUint8Array(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (typeof value === 'string') return new TextEncoder().encode(value);
  return new Uint8Array(value || 0);
}
