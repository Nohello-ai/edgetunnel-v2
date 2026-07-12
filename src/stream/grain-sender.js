// stream/grain-sender.js — 下行 Grain 发送器（尾部阈值 + 微任务调度）
// 对应原文件: 创建下行Grain发送器 (行 2342-2445)

import { toBytes, wsSend, closeSocketQuietly } from '../utils.js';
import { DOWNSTREAM_GRAIN_PACKET, DOWNSTREAM_GRAIN_TAIL_THRESHOLD, DOWNSTREAM_GRAIN_SILENCE_MS } from '../context.js';

export function createGrainSender(webSocket, headerData = null) {
  const packetCap = DOWNSTREAM_GRAIN_PACKET;
  const tailBytes = DOWNSTREAM_GRAIN_TAIL_THRESHOLD;
  const lowWaterBytes = Math.max(4096, tailBytes << 3);
  let header = headerData;
  let pendingBuffer = new Uint8Array(packetCap);
  let pendingBytes = 0;
  let flushTimer = null;
  let microtaskQueued = false;
  let generation = 0;
  let scheduledGeneration = 0;
  let waitRounds = 0;
  let flushPromise = null;

  const sendRaw = async (chunk) => {
    if (webSocket.readyState !== 1 /* OPEN */) throw new Error('ws not open');
    await wsSend(webSocket, chunk);
  };

  const attachHeader = (chunk) => {
    if (!header) return chunk;
    const merged = new Uint8Array(header.length + chunk.byteLength);
    merged.set(header, 0);
    merged.set(chunk, header.length);
    header = null;
    return merged;
  };

  const flush = async () => {
    while (flushPromise) await flushPromise;
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = null;
    microtaskQueued = false;
    if (!pendingBytes) return;
    const output = pendingBuffer.subarray(0, pendingBytes).slice();
    pendingBuffer = new Uint8Array(packetCap);
    pendingBytes = 0;
    waitRounds = 0;
    flushPromise = sendRaw(output).finally(() => { flushPromise = null; });
    return flushPromise;
  };

  const scheduleFlush = () => {
    if (flushTimer || microtaskQueued) return;
    microtaskQueued = true;
    scheduledGeneration = generation;
    queueMicrotask(() => {
      microtaskQueued = false;
      if (!pendingBytes || flushTimer) return;
      if (packetCap - pendingBytes < tailBytes) {
        flush().catch(() => closeSocketQuietly(webSocket));
        return;
      }
      flushTimer = setTimeout(() => {
        flushTimer = null;
        if (!pendingBytes) return;
        if (packetCap - pendingBytes < tailBytes) {
          flush().catch(() => closeSocketQuietly(webSocket));
          return;
        }
        if (waitRounds < 2 && (generation !== scheduledGeneration || pendingBytes < lowWaterBytes)) {
          waitRounds++;
          scheduledGeneration = generation;
          scheduleFlush();
          return;
        }
        flush().catch(() => closeSocketQuietly(webSocket));
      }, Math.max(DOWNSTREAM_GRAIN_SILENCE_MS, 1));
    });
  };

  return {
    async sendDirect(data) {
      let chunk = toBytes(data);
      if (!chunk.byteLength) return;
      chunk = attachHeader(chunk);
      await sendRaw(chunk);
    },
    async send(data) {
      let chunk = toBytes(data);
      if (!chunk.byteLength) return;
      chunk = attachHeader(chunk);
      let offset = 0;
      const total = chunk.byteLength;
      while (offset < total) {
        if (!pendingBytes && total - offset >= packetCap) {
          const n = Math.min(packetCap, total - offset);
          await sendRaw(offset === 0 && n === total ? chunk : chunk.subarray(offset, offset + n));
          offset += n;
          continue;
        }
        const copy = Math.min(packetCap - pendingBytes, total - offset);
        pendingBuffer.set(chunk.subarray(offset, offset + copy), pendingBytes);
        pendingBytes += copy;
        offset += copy;
        generation++;
        if (pendingBytes === packetCap || packetCap - pendingBytes < tailBytes) await flush();
        else scheduleFlush();
      }
    },
    flush,
  };
}