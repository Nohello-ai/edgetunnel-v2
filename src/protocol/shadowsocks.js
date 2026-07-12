// protocol/shadowsocks.js — Shadowsocks AEAD 加解密
// 对应原文件: SS支持加密配置、SSAEAD加密/解密、SS派生主密钥/会话密钥、Nonce计数器 (行 1717-1869)

import { toBytes, concatBytes } from '../utils.js';

export const SS_CIPHER_CONFIGS = {
  'aes-128-gcm': { method: 'aes-128-gcm', keyLen: 16, saltLen: 16, maxChunk: 0x3fff, aesLength: 128 },
  'aes-256-gcm': { method: 'aes-256-gcm', keyLen: 32, saltLen: 32, maxChunk: 0x3fff, aesLength: 256 },
};

export const SS_TAG_LEN = 16;
export const SS_NONCE_LEN = 12;
const SS_SUBKEY_INFO = new TextEncoder().encode('ss-subkey');
const SS_ENCODER = new TextEncoder();
const SS_KEY_CACHE = new Map();

export function incrementNonce(counter) {
  for (let i = 0; i < counter.length; i++) {
    counter[i] = (counter[i] + 1) & 0xff;
    if (counter[i] !== 0) return;
  }
}

export async function deriveMasterKey(passwordText, keyLen) {
  const cacheKey = `${keyLen}:${passwordText}`;
  if (SS_KEY_CACHE.has(cacheKey)) return SS_KEY_CACHE.get(cacheKey);
  const task = (async () => {
    const pwBytes = SS_ENCODER.encode(passwordText || '');
    let prev = new Uint8Array(0), result = new Uint8Array(0);
    while (result.byteLength < keyLen) {
      const input = new Uint8Array(prev.byteLength + pwBytes.byteLength);
      input.set(prev, 0); input.set(pwBytes, prev.byteLength);
      prev = new Uint8Array(await crypto.subtle.digest('MD5', input));
      result = concatBytes(result, prev);
    }
    return result.slice(0, keyLen);
  })();
  SS_KEY_CACHE.set(cacheKey, task);
  try { return await task; } catch (e) { SS_KEY_CACHE.delete(cacheKey); throw e; }
}

export async function deriveSessionKey(config, masterKey, salt, usages) {
  const hmacOpts = { name: 'HMAC', hash: 'SHA-1' };
  const saltHmacKey = await crypto.subtle.importKey('raw', salt, hmacOpts, false, ['sign']);
  const prk = new Uint8Array(await crypto.subtle.sign('HMAC', saltHmacKey, masterKey));
  const prkHmacKey = await crypto.subtle.importKey('raw', prk, hmacOpts, false, ['sign']);
  const subKey = new Uint8Array(config.keyLen);
  let prev = new Uint8Array(0), written = 0, counter = 1;
  while (written < config.keyLen) {
    const input = concatBytes(prev, SS_SUBKEY_INFO, new Uint8Array([counter]));
    prev = new Uint8Array(await crypto.subtle.sign('HMAC', prkHmacKey, input));
    const copyLen = Math.min(prev.byteLength, config.keyLen - written);
    subKey.set(prev.subarray(0, copyLen), written);
    written += copyLen; counter += 1;
  }
  return crypto.subtle.importKey('raw', subKey, { name: 'AES-GCM', length: config.aesLength }, false, usages);
}

export async function ssEncrypt(cryptoKey, nonceCounter, plaintext) {
  const iv = nonceCounter.slice();
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, cryptoKey, plaintext);
  incrementNonce(nonceCounter);
  return new Uint8Array(ct);
}

export async function ssDecrypt(cryptoKey, nonceCounter, ciphertext) {
  const iv = nonceCounter.slice();
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, tagLength: 128 }, cryptoKey, ciphertext);
  incrementNonce(nonceCounter);
  return new Uint8Array(pt);
}