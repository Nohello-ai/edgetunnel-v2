import { AppError } from '../core/errors.js';

export async function resolveDnsOverTcp({ payload, connector, hostname = '8.8.4.4', port = 53 }) {
  const query = toBytes(payload);
  if (query.byteLength === 0 || query.byteLength > 65535) {
    throw new AppError('INVALID_DNS_PAYLOAD', 400);
  }

  const socket = connector.connect({ hostname, port });
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  try {
    const frame = new Uint8Array(query.byteLength + 2);
    frame[0] = query.byteLength >>> 8;
    frame[1] = query.byteLength & 0xff;
    frame.set(query, 2);
    await writer.write(frame);

    const response = await readDnsFrame(reader);
    if (!response) throw new AppError('DNS_UPSTREAM_CLOSED', 502);
    return response;
  } finally {
    try { writer.releaseLock(); } catch {}
    try { reader.releaseLock(); } catch {}
    try { await socket.close(); } catch {}
  }
}

async function readDnsFrame(reader) {
  let buffer = new Uint8Array();
  let expected = -1;
  while (true) {
    const { done, value } = await reader.read();
    if (done) return null;
    buffer = concat(buffer, toBytes(value));
    if (expected < 0 && buffer.byteLength >= 2) expected = (buffer[0] << 8) | buffer[1];
    if (expected >= 0 && buffer.byteLength >= expected + 2) return buffer.slice(2, expected + 2);
  }
}

function concat(a, b) {
  const output = new Uint8Array(a.byteLength + b.byteLength);
  output.set(a); output.set(b, a.byteLength);
  return output;
}

function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return new Uint8Array();
}
