import { DEFAULT_TRANSPORT_LIMITS } from './limits.js';

export function createGrpcFrameParser(limits = {}) {
  const maxFrameBytes = Number(limits.maxFrameBytes || DEFAULT_TRANSPORT_LIMITS.maxFrameBytes);
  let buffer = new Uint8Array();

  return {
    push(value) {
      buffer = concat(buffer, toBytes(value));
      const messages = [];
      let offset = 0;
      while (buffer.byteLength - offset >= 5) {
        if (buffer[offset] !== 0) throw new Error('GRPC_COMPRESSION_UNSUPPORTED');
        const length = new DataView(buffer.buffer, buffer.byteOffset + offset + 1, 4).getUint32(0);
        if (length > maxFrameBytes) throw new Error('GRPC_FRAME_TOO_LARGE');
        if (buffer.byteLength - offset - 5 < length) break;
        messages.push(buffer.slice(offset + 5, offset + 5 + length));
        offset += 5 + length;
      }
      buffer = buffer.slice(offset);
      return { messages, remainder: buffer };
    },
  };
}

export function encodeGrpcFrame(value) {
  const payload = toBytes(value);
  const output = new Uint8Array(payload.byteLength + 5);
  new DataView(output.buffer).setUint32(1, payload.byteLength);
  output.set(payload, 5);
  return output;
}

export function decodeGrpcHunk(value) {
  const message = toBytes(value);
  if (message[0] !== 0x0a) throw new Error('GRPC_HUNK_INVALID');
  const length = readVarint(message, 1);
  if (!length || length.value > message.byteLength - length.offset) throw new Error('GRPC_HUNK_INVALID');
  if (length.offset + length.value !== message.byteLength) throw new Error('GRPC_HUNK_INVALID');
  return message.slice(length.offset, length.offset + length.value);
}

export function encodeGrpcHunk(value) {
  const payload = toBytes(value);
  const length = writeVarint(payload.byteLength);
  const output = new Uint8Array(1 + length.byteLength + payload.byteLength);
  output[0] = 0x0a;
  output.set(length, 1);
  output.set(payload, 1 + length.byteLength);
  return output;
}

function readVarint(bytes, offset) {
  let value = 0;
  let shift = 0;
  for (let index = offset; index < bytes.byteLength && index < offset + 5; index += 1) {
    const byte = bytes[index];
    value += (byte & 0x7f) * (2 ** shift);
    if ((byte & 0x80) === 0) return { value, offset: index + 1 };
    shift += 7;
  }
  return null;
}

function writeVarint(value) {
  const output = [];
  let remaining = value;
  do {
    let byte = remaining % 128;
    remaining = Math.floor(remaining / 128);
    if (remaining > 0) byte |= 0x80;
    output.push(byte);
  } while (remaining > 0);
  return Uint8Array.from(output);
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
