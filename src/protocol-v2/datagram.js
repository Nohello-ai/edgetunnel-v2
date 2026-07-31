import { parseSocksAddress } from './address.js';
import { appendBytes } from './helpers.js';

export function createDatagramCodec(protocol, defaults = {}) {
  if (protocol === 'vless') return createVlessDatagramCodec(defaults);
  if (protocol === 'trojan') return createTrojanDatagramCodec();
  throw new TypeError(`unsupported datagram protocol: ${protocol}`);
}

function createVlessDatagramCodec(defaults) {
  let buffer = new Uint8Array();
  return {
    push(chunk) {
      buffer = appendBytes(buffer, chunk);
      const datagrams = [];
      while (buffer.byteLength >= 2) {
        const length = (buffer[0] << 8) | buffer[1];
        if (length === 0) throw new Error('INVALID_UDP_DATAGRAM');
        if (buffer.byteLength < length + 2) break;
        datagrams.push({ hostname: defaults.hostname, port: defaults.port, payload: buffer.slice(2, length + 2) });
        buffer = buffer.slice(length + 2);
      }
      return datagrams;
    },
    encode(datagram) {
      const payload = toBytes(datagram.payload);
      const output = new Uint8Array(payload.byteLength + 2);
      output[0] = payload.byteLength >>> 8;
      output[1] = payload.byteLength & 0xff;
      output.set(payload, 2);
      return output;
    },
    finish() { if (buffer.byteLength) throw new Error('INCOMPLETE_UDP_DATAGRAM'); },
  };
}

function createTrojanDatagramCodec() {
  let buffer = new Uint8Array();
  return {
    push(chunk) {
      buffer = appendBytes(buffer, chunk);
      const datagrams = [];
      while (buffer.byteLength) {
        const address = parseSocksAddress(buffer, 0);
        if (address.needMore) break;
        if (address.error) throw new Error(address.error);
        if (buffer.byteLength < address.offset + 6) break;
        const port = (buffer[address.offset] << 8) | buffer[address.offset + 1];
        const length = (buffer[address.offset + 2] << 8) | buffer[address.offset + 3];
        if (port === 0 || length === 0 || buffer[address.offset + 4] !== 13 || buffer[address.offset + 5] !== 10) {
          throw new Error('INVALID_UDP_DATAGRAM');
        }
        const payloadOffset = address.offset + 6;
        if (buffer.byteLength < payloadOffset + length) break;
        datagrams.push({
          hostname: address.hostname,
          port,
          payload: buffer.slice(payloadOffset, payloadOffset + length),
          addressHeader: buffer.slice(0, address.offset + 2),
        });
        buffer = buffer.slice(payloadOffset + length);
      }
      return datagrams;
    },
    encode(datagram) {
      const payload = toBytes(datagram.payload);
      const header = toBytes(datagram.addressHeader);
      if (!header.byteLength) throw new Error('UDP_ADDRESS_REQUIRED');
      const output = new Uint8Array(header.byteLength + 4 + payload.byteLength);
      output.set(header);
      output[header.byteLength] = payload.byteLength >>> 8;
      output[header.byteLength + 1] = payload.byteLength & 0xff;
      output[header.byteLength + 2] = 13;
      output[header.byteLength + 3] = 10;
      output.set(payload, header.byteLength + 4);
      return output;
    },
    finish() { if (buffer.byteLength) throw new Error('INCOMPLETE_UDP_DATAGRAM'); },
  };
}

function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return new Uint8Array();
}
