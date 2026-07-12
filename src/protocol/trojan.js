// protocol/trojan.js — Trojan 协议解析
// 对应原文件: 解析木马请求 (行 1561-1625) + tryParseTrojanFirstPacket

import { toBytes, sha224str } from '../utils.js';

const TROJAN_DECODER = new TextDecoder();

export function parseTrojan(buffer, passwordPlainText) {
  const data = toBytes(buffer);
  const sha224Password = sha224str(passwordPlainText);
  if (data.byteLength < 58) return { hasError: true, message: 'invalid data' };
  const crLfIndex = 56;
  if (data[crLfIndex] !== 0x0d || data[crLfIndex + 1] !== 0x0a) return { hasError: true, message: 'invalid header format' };
  for (let i = 0; i < crLfIndex; i++) {
    if (data[i] !== sha224Password.charCodeAt(i)) return { hasError: true, message: 'invalid password' };
  }
  const socks5Index = crLfIndex + 2;
  if (data.byteLength < socks5Index + 6) return { hasError: true, message: 'invalid S5 request data' };
  const cmd = data[socks5Index];
  if (cmd !== 1 && cmd !== 3) return { hasError: true, message: 'unsupported command, only TCP/UDP is allowed' };
  const isUDP = cmd === 3;
  const atype = data[socks5Index + 1];
  let addrLen = 0, addrIdx = socks5Index + 2, address = '';
  switch (atype) {
    case 1: addrLen = 4; if (data.byteLength < addrIdx + addrLen + 4) return { hasError: true, message: 'invalid S5 request data' }; address = `${data[addrIdx]}.${data[addrIdx+1]}.${data[addrIdx+2]}.${data[addrIdx+3]}`; break;
    case 3: if (data.byteLength < addrIdx + 1) return { hasError: true, message: 'invalid S5 request data' }; addrLen = data[addrIdx]; addrIdx += 1; if (data.byteLength < addrIdx + addrLen + 4) return { hasError: true, message: 'invalid S5 request data' }; address = TROJAN_DECODER.decode(data.subarray(addrIdx, addrIdx + addrLen)); break;
    case 4: addrLen = 16; if (data.byteLength < addrIdx + addrLen + 4) return { hasError: true, message: 'invalid S5 request data' }; const ipv6 = []; for (let i = 0; i < 8; i++) { const pi = addrIdx + i * 2; ipv6.push(((data[pi] << 8) | data[pi + 1]).toString(16)); } address = ipv6.join(':'); break;
    default: return { hasError: true, message: `invalid addressType is ${atype}` };
  }
  if (!address) return { hasError: true, message: `address is empty, addressType is ${atype}` };
  const portIdx = addrIdx + addrLen;
  if (data.byteLength < portIdx + 4) return { hasError: true, message: 'invalid S5 request data' };
  const port = (data[portIdx] << 8) | data[portIdx + 1];
  return { hasError: false, addressType: atype, port, hostname: address, isUDP, rawClientData: data.subarray(portIdx + 4) };
}

export function tryParseTrojanFirstPacket(data, token) {
  const passwordHash = sha224str(token);
  const passwordBytes = new TextEncoder().encode(passwordHash);
  const length = data.byteLength;
  if (length < 58) return { 状态: 'need_more' };
  if (data[56] !== 0x0d || data[57] !== 0x0a) return { 状态: 'invalid' };
  for (let i = 0; i < 56; i++) { if (data[i] !== passwordBytes[i]) return { 状态: 'invalid' }; }
  const socksStart = 58;
  if (length < socksStart + 2) return { 状态: 'need_more' };
  const cmd = data[socksStart];
  if (cmd !== 1 && cmd !== 3) return { 状态: 'invalid' };
  const isUDP = cmd === 3;
  const atype = data[socksStart + 1];
  let cursor = socksStart + 2, hostname = '';
  if (atype === 1) { if (length < cursor + 4) return { 状态: 'need_more' }; hostname = `${data[cursor]}.${data[cursor+1]}.${data[cursor+2]}.${data[cursor+3]}`; cursor += 4; }
  else if (atype === 3) { if (length < cursor + 1) return { 状态: 'need_more' }; const dl = data[cursor]; if (length < cursor + 1 + dl) return { 状态: 'need_more' }; hostname = TROJAN_DECODER.decode(data.subarray(cursor + 1, cursor + 1 + dl)); cursor += 1 + dl; }
  else if (atype === 4) { if (length < cursor + 16) return { 状态: 'need_more' }; const ipv6 = []; for (let i = 0; i < 8; i++) { const base = cursor + i * 2; ipv6.push(((data[base] << 8) | data[base + 1]).toString(16)); } hostname = ipv6.join(':'); cursor += 16; }
  else return { 状态: 'invalid' };
  if (!hostname) return { 状态: 'invalid' };
  if (length < cursor + 4) return { 状态: 'need_more' };
  const port = (data[cursor] << 8) | data[cursor + 1];
  if (data[cursor+2] !== 0x0d || data[cursor+3] !== 0x0a) return { 状态: 'invalid' };
  return { 状态: 'ok', 结果: { 协议: 'trojan', hostname, port, isUDP, rawData: data.subarray(cursor + 4), respHeader: null } };
}

// --- Trojan UDP 转发（原版提取） ---

import { toBytes as toBytesRaw, concatBytes } from '../utils.js';
import { forwardataudp } from '../proxy/forward.js';

export async function forwardTrojanUDP(chunk, webSocket, context, request) {
  const current = toBytesRaw(chunk);
  const cache = context?.cache instanceof Uint8Array ? context.cache : new Uint8Array(0);
  const input = cache.byteLength ? concatBytes(cache, current) : current;
  let cursor = 0;
  while (cursor < input.byteLength) {
    const packetStart = cursor;
    const atype = input[cursor];
    let addrCursor = cursor + 1;
    let addrLen = 0;
    if (atype === 1) addrLen = 4;
    else if (atype === 4) addrLen = 16;
    else if (atype === 3) {
      if (input.byteLength < addrCursor + 1) break;
      addrLen = 1 + input[addrCursor];
    } else throw new Error(`invalid trojan udp addressType: ${atype}`);
    const portCursor = addrCursor + addrLen;
    if (input.byteLength < portCursor + 6) break;
    const port = (input[portCursor] << 8) | input[portCursor + 1];
    const payloadLength = (input[portCursor + 2] << 8) | input[portCursor + 3];
    if (input[portCursor + 4] !== 0x0d || input[portCursor + 5] !== 0x0a) throw new Error('invalid trojan udp delimiter');
    const payloadStart = portCursor + 6;
    const payloadEnd = payloadStart + payloadLength;
    if (input.byteLength < payloadEnd) break;
    const addrPortHeader = input.slice(packetStart, portCursor + 2);
    const payload = input.slice(payloadStart, payloadEnd);
    cursor = payloadEnd;
    if (port !== 53) throw new Error('UDP is not supported');
    if (!payload.byteLength) continue;
    let tcpDNSQuery = payload;
    if (payload.byteLength < 2 || ((payload[0] << 8) | payload[1]) !== payload.byteLength - 2) {
      tcpDNSQuery = new Uint8Array(payload.byteLength + 2);
      tcpDNSQuery[0] = (payload.byteLength >>> 8) & 0xff;
      tcpDNSQuery[1] = payload.byteLength & 0xff;
      tcpDNSQuery.set(payload, 2);
    }
    const dnsRespCtx = { cache: new Uint8Array(0) };
    await forwardataudp(tcpDNSQuery, webSocket, null, request, (dnsRespChunk) => {
      const respBlock = toBytesRaw(dnsRespChunk);
      const respInput = dnsRespCtx.cache.byteLength ? concatBytes(dnsRespCtx.cache, respBlock) : respBlock;
      const respFrames = [];
      let respCursor = 0;
      while (respCursor + 2 <= respInput.byteLength) {
        const dnsLen = (respInput[respCursor] << 8) | respInput[respCursor + 1];
        const dnsStart = respCursor + 2;
        const dnsEnd = dnsStart + dnsLen;
        if (dnsEnd > respInput.byteLength) break;
        const dnsPayload = respInput.slice(dnsStart, dnsEnd);
        const frame = new Uint8Array(addrPortHeader.byteLength + 4 + dnsPayload.byteLength);
        frame.set(addrPortHeader, 0);
        frame[addrPortHeader.byteLength] = (dnsPayload.byteLength >>> 8) & 0xff;
        frame[addrPortHeader.byteLength + 1] = dnsPayload.byteLength & 0xff;
        frame[addrPortHeader.byteLength + 2] = 0x0d;
        frame[addrPortHeader.byteLength + 3] = 0x0a;
        frame.set(dnsPayload, addrPortHeader.byteLength + 4);
        respFrames.push(frame);
        respCursor = dnsEnd;
      }
      dnsRespCtx.cache = respInput.slice(respCursor);
      return respFrames.length ? respFrames : new Uint8Array(0);
    });
  }
  if (context) context.cache = input.slice(cursor);
}