export function appendBytes(current, value) {
  const chunk = toBytes(value);
  const output = new Uint8Array(current.byteLength + chunk.byteLength);
  output.set(current);
  output.set(chunk, current.byteLength);
  return output;
}

export function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return new Uint8Array();
}

export function uuidToBytes(uuid) {
  const hex = String(uuid).replaceAll('-', '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) return null;
  if (Number.parseInt(hex[12], 16) !== 4) return null;
  if ((Number.parseInt(hex[16], 16) & 0xc) !== 0x8) return null;
  return Uint8Array.from(hex.match(/../g), (pair) => Number.parseInt(pair, 16));
}

export function equalBytes(a, b) {
  if (!a || !b || a.byteLength !== b.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < a.byteLength; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}
