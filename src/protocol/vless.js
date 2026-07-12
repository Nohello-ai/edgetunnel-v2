// ============================================================
// protocol/vless.js — VLESS 协议解析
// 对应原文件: 解析魏烈思请求 (行 1667-1715)
// ============================================================

import { toBytes } from '../utils.js';
import { uuidBytesMatch } from '../uuid.js';

const VLESS_DECODER = new TextDecoder();

/**
 * 解析 VLESS 请求首包
 * @param {Uint8Array|ArrayBuffer} chunk - 原始数据
 * @param {string} token - UUID 用于验证
 * @returns {{ hasError: boolean, message?: string, addressType?: number, port?: number, hostname?: string, isUDP?: boolean, rawClientData?: Uint8Array, version?: number }}
 */
export function parseVLESS(chunk, token) {
  const data = toBytes(chunk);
  const length = data.byteLength;

  if (length < 24) return { hasError: true, message: 'Invalid data' };

  const version = data[0];
  if (!uuidBytesMatch(data, 1, token)) return { hasError: true, message: 'Invalid uuid' };

  const optLen = data[17];
  const cmdIndex = 18 + optLen;
  if (length < cmdIndex + 4) return { hasError: true, message: 'Invalid data' };

  const cmd = data[cmdIndex];
  let isUDP = false;
  if (cmd === 1) {
    // TCP
  } else if (cmd === 2) {
    isUDP = true;
  } else {
    return { hasError: true, message: 'Invalid command' };
  }

  const portIdx = cmdIndex + 1;
  const port = (data[portIdx] << 8) | data[portIdx + 1];
  let addrValIdx = portIdx + 3;
  let addrLen = 0;
  let hostname = '';
  const addressType = data[portIdx + 2];

  switch (addressType) {
    case 1: // IPv4
      addrLen = 4;
      if (length < addrValIdx + addrLen) return { hasError: true, message: 'Invalid IPv4 address length' };
      hostname = `${data[addrValIdx]}.${data[addrValIdx + 1]}.${data[addrValIdx + 2]}.${data[addrValIdx + 3]}`;
      break;
    case 2: // Domain
      if (length < addrValIdx + 1) return { hasError: true, message: 'Invalid domain length' };
      addrLen = data[addrValIdx];
      addrValIdx += 1;
      if (length < addrValIdx + addrLen) return { hasError: true, message: 'Invalid domain data' };
      hostname = VLESS_DECODER.decode(data.subarray(addrValIdx, addrValIdx + addrLen));
      break;
    case 3: // IPv6
      addrLen = 16;
      if (length < addrValIdx + addrLen) return { hasError: true, message: 'Invalid IPv6 address length' };
      const ipv6 = [];
      for (let i = 0; i < 8; i++) {
        const base = addrValIdx + i * 2;
        ipv6.push(((data[base] << 8) | data[base + 1]).toString(16));
      }
      hostname = ipv6.join(':');
      break;
    default:
      return { hasError: true, message: `Invalid address type: ${addressType}` };
  }

  if (!hostname) return { hasError: true, message: `Invalid address: ${addressType}` };

  const rawIndex = addrValIdx + addrLen;
  return {
    hasError: false,
    addressType,
    port,
    hostname,
    isUDP,
    rawClientData: data.subarray(rawIndex),
    version,
  };
}

/**
 * 尝试从 buffer 解析 VLESS 首包（用于 XHTTP 首包读取场景）
 * 返回 { 状态: 'ok'|'invalid'|'need_more', 结果? }
 */
export function tryParseVLESSFirstPacket(data, token) {
  const length = data.byteLength;
  if (length < 18) return { 状态: 'need_more' };
  if (!uuidBytesMatch(data, 1, token)) return { 状态: 'invalid' };

  const optLen = data[17];
  const cmdIndex = 18 + optLen;
  if (length < cmdIndex + 1) return { 状态: 'need_more' };

  const cmd = data[cmdIndex];
  if (cmd !== 1 && cmd !== 2) return { 状态: 'invalid' };

  const portIndex = cmdIndex + 1;
  if (length < portIndex + 3) return { 状态: 'need_more' };

  const port = (data[portIndex] << 8) | data[portIndex + 1];
  const addressType = data[portIndex + 2];
  const addressIndex = portIndex + 3;
  let headerLen = -1;
  let hostname = '';

  if (addressType === 1) {
    if (length < addressIndex + 4) return { 状态: 'need_more' };
    hostname = `${data[addressIndex]}.${data[addressIndex + 1]}.${data[addressIndex + 2]}.${data[addressIndex + 3]}`;
    headerLen = addressIndex + 4;
  } else if (addressType === 2) {
    if (length < addressIndex + 1) return { 状态: 'need_more' };
    const domainLen = data[addressIndex];
    if (length < addressIndex + 1 + domainLen) return { 状态: 'need_more' };
    hostname = VLESS_DECODER.decode(data.subarray(addressIndex + 1, addressIndex + 1 + domainLen));
    headerLen = addressIndex + 1 + domainLen;
  } else if (addressType === 3) {
    if (length < addressIndex + 16) return { 状态: 'need_more' };
    const ipv6 = [];
    for (let i = 0; i < 8; i++) {
      const base = addressIndex + i * 2;
      ipv6.push(((data[base] << 8) | data[base + 1]).toString(16));
    }
    hostname = ipv6.join(':');
    headerLen = addressIndex + 16;
  } else return { 状态: 'invalid' };

  if (!hostname) return { 状态: 'invalid' };

  return {
    状态: 'ok',
    结果: {
      协议: 'vless',
      hostname,
      port,
      isUDP: cmd === 2,
      rawData: data.subarray(headerLen),
      respHeader: new Uint8Array([data[0], 0]),
    },
  };
}