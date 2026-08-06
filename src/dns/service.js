import { AppError } from '../core/errors.js';

const DNS_TYPE_MAP = { A: 1, AAAA: 28, TXT: 16 };

/**
 * DNS over HTTPS 查询。
 * 返回记录数据数组（A 返回 IPv4 字符串，AAAA 返回 IPv6 字符串，TXT 返回字符串）。
 */
export async function resolveDnsOverHttps(name, type, doh = 'https://cloudflare-dns.com/dns-query') {
  const qtype = DNS_TYPE_MAP[String(type).toUpperCase()] || 1;
  const qname = encodeDNSName(String(name).trim().toLowerCase().replace(/\.$/, ''));
  const query = new Uint8Array(12 + qname.length + 4);
  const view = new DataView(query.buffer);
  view.setUint16(0, crypto.getRandomValues(new Uint16Array(1))[0]);
  view.setUint16(2, 0x0100); // RD=1
  view.setUint16(4, 1);      // QDCOUNT=1
  query.set(qname, 12);
  view.setUint16(12 + qname.length, qtype);
  view.setUint16(12 + qname.length + 2, 1); // QCLASS=IN

  const res = await fetch(doh, {
    method: 'POST',
    headers: { 'Content-Type': 'application/dns-message', Accept: 'application/dns-message' },
    body: query,
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) return [];

  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength < 12) return [];
  const dv = new DataView(buf.buffer);
  const flags = dv.getUint16(2);
  // 截断标志 (TC) 已设置，响应不完整
  if (flags & 0x0200) return [];
  const ancount = dv.getUint16(6);
  if (ancount === 0) return [];

  // 跳过 Question 区
  let offset = 12;
  for (let i = 0; i < dv.getUint16(4); i++) {
    const [, end] = parseDNSName(buf, offset);
    offset = end + 4;
  }

  const results = [];
  for (let i = 0; i < ancount && offset < buf.length; i++) {
    const [, nameEnd] = parseDNSName(buf, offset);
    offset = nameEnd;
    const rtype = dv.getUint16(offset); offset += 2;
    offset += 2; // CLASS
    offset += 4; // TTL
    const rdlen = dv.getUint16(offset); offset += 2;
    const rdata = buf.slice(offset, offset + rdlen);
    offset += rdlen;

    if (rtype === 1 && rdlen === 4) { // A
      results.push(`${rdata[0]}.${rdata[1]}.${rdata[2]}.${rdata[3]}`);
    } else if (rtype === 28 && rdlen === 16) { // AAAA
      const segs = [];
      for (let j = 0; j < 16; j += 2) segs.push(((rdata[j] << 8) | rdata[j + 1]).toString(16));
      results.push(segs.join(':'));
    } else if (rtype === 16) { // TXT
      let t = 0;
      const parts = [];
      while (t < rdlen) { const len = rdata[t++]; parts.push(new TextDecoder().decode(rdata.slice(t, t + len))); t += len; }
      results.push(parts.join(''));
    }
  }
  return results;
}

function encodeDNSName(name) {
  const parts = name.split('.');
  const bufs = parts.map(p => { const e = new TextEncoder().encode(p); return new Uint8Array([e.length, ...e]); });
  const total = bufs.reduce((s, b) => s + b.length, 0) + 1;
  const result = new Uint8Array(total);
  let off = 0;
  for (const b of bufs) { result.set(b, off); off += b.length; }
  result[off] = 0;
  return result;
}

function parseDNSName(buf, pos) {
  const labels = [];
  let p = pos, jumped = false, endPos = -1;
  let jumps = 0;
  while (p < buf.length && jumps < 10) {
    const len = buf[p];
    if (len === 0) { if (!jumped) endPos = p + 1; break; }
    if ((len & 0xc0) === 0xc0) {
      if (p + 1 >= buf.length) return ['', pos + 2];
      if (!jumped) endPos = p + 2;
      p = ((len & 0x3f) << 8) | buf[p + 1];
      jumped = true;
      jumps++;
      continue;
    }
    if (p + 1 + len > buf.length) return ['', pos + 2];
    labels.push(new TextDecoder().decode(buf.slice(p + 1, p + 1 + len)));
    p += len + 1;
  }
  if (endPos === -1) endPos = p + 1;
  return [labels.join('.'), endPos];
}

export async function resolveDnsOverTcp({ payload, connector, hostname = '1.1.1.1', port = 53 }) {
  const query = toBytes(payload);
  if (query.byteLength === 0 || query.byteLength > 65535) {
    throw new AppError('INVALID_DNS_PAYLOAD', 400);
  }

  const socket = await connector.connect({ hostname, port });
  if (socket.opened) {
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new AppError('DNS_CONNECT_TIMEOUT', 504)), 5000); });
    await Promise.race([socket.opened, timeout]);
    clearTimeout(timer);
  }
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  try {
    const frame = new Uint8Array(query.byteLength + 2);
    frame[0] = query.byteLength >>> 8;
    frame[1] = query.byteLength & 0xff;
    frame.set(query, 2);
    let timer;
    const writePromise = writer.write(frame);
    const writeTimeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new AppError('DNS_WRITE_TIMEOUT', 504)), 5000); });
    await Promise.race([writePromise, writeTimeout]);
    clearTimeout(timer);

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
  let reads = 0;
  const MAX_READS = 64;
  while (reads < MAX_READS) {
    const { done, value } = await reader.read();
    if (done) return null;
    reads++;
    buffer = concat(buffer, toBytes(value));
    if (expected < 0 && buffer.byteLength >= 2) {
      expected = (buffer[0] << 8) | buffer[1];
      if (expected > 65535) throw new AppError('DNS_FRAME_TOO_LARGE', 400);
    }
    if (expected >= 0 && buffer.byteLength >= expected + 2) return buffer.slice(2, expected + 2);
  }
  throw new AppError('DNS_FRAME_TOO_SLOW', 408);
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
