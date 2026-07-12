// ============================================================
// uuid.js — UUID 工具函数
// 对应原文件: 读取十六进制半字节、获取UUID字节、UUID字节匹配
// ============================================================

import { toBytes } from './utils.js';

const UUID_BYTE_CACHE = new Map();
const MAX_CACHE_SIZE = 32;

/** 读取单个十六进制半字节 */
function readHexNibble(code) {
  if (code >= 48 && code <= 57) return code - 48;       // '0'-'9'
  code |= 32;
  if (code >= 97 && code <= 102) return code - 87;      // 'a'-'f'
  return -1;
}

/** 将 UUID 字符串转为 16 字节 Uint8Array（带缓存） */
export function getUUIDBytes(uuid) {
  const key = String(uuid || '');
  const cached = UUID_BYTE_CACHE.get(key);
  if (cached) return cached;

  const clean = key.replace(/-/g, '');
  if (clean.length !== 32) return null;

  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    const high = readHexNibble(clean.charCodeAt(i * 2));
    const low = readHexNibble(clean.charCodeAt(i * 2 + 1));
    if (high < 0 || low < 0) return null;
    bytes[i] = (high << 4) | low;
  }

  if (UUID_BYTE_CACHE.size >= MAX_CACHE_SIZE) UUID_BYTE_CACHE.clear();
  UUID_BYTE_CACHE.set(key, bytes);
  return bytes;
}

/** 校验 data 在 offset 处是否匹配 uuid 的 16 字节 */
export function uuidBytesMatch(data, offset, uuid) {
  const expected = getUUIDBytes(uuid);
  if (!expected || data.byteLength < offset + 16) return false;
  for (let i = 0; i < 16; i++) {
    if (data[offset + i] !== expected[i]) return false;
  }
  return true;
}

/** 从环境变量生成 userID（UUIDv4 格式） */
export async function generateUserID(env, adminPassword, secretKey) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const envUUID = env.UUID || env.uuid;
  if (envUUID && uuidRegex.test(envUUID)) return envUUID.toLowerCase();

  const { md5md5 } = await import('./utils.js');
  const hash = await md5md5(adminPassword + secretKey);
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    '4' + hash.slice(13, 16),
    '8' + hash.slice(17, 20),
    hash.slice(20),
  ].join('-');
}