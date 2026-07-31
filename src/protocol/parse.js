import { parseProxyPacket } from './index.js';

const MAX_FIRST_PACKET_BYTES = 16 * 1024;

export async function readFirstProxyPacket(reader, session, options = {}) {
  const maxBytes = options.maxBytes || MAX_FIRST_PACKET_BYTES;
  let buffer = new Uint8Array(Math.min(1024, maxBytes));
  let offset = 0;

  while (offset < maxBytes) {
    const { done, value } = await reader.read();
    if (done) return null;

    const chunk = toUint8Array(value);
    if (chunk.byteLength === 0) continue;
    if (offset + chunk.byteLength > maxBytes) {
      throw new Error('first packet exceeds maximum size');
    }

    if (offset + chunk.byteLength > buffer.byteLength) {
      const next = new Uint8Array(Math.min(maxBytes, Math.max(buffer.byteLength * 2, offset + chunk.byteLength)));
      next.set(buffer.subarray(0, offset));
      buffer = next;
    }

    buffer.set(chunk, offset);
    offset += chunk.byteLength;

    const packet = buffer.subarray(0, offset);
    const parsed = parseProxyPacket(packet, session);
    if (parsed.status === 'ok') return parsed.result;
    if (parsed.status === 'invalid') return null;
  }

  throw new Error('first packet exceeds maximum size');
}

function toUint8Array(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return new Uint8Array(value || 0);
}
