// stream/connect-streams.js — 双向管道桥接
// 对应原文件: connectStreams (行 2447-2486)

import { closeSocketQuietly } from '../utils.js';
import { createGrainSender } from './grain-sender.js';

export async function connectStreams(remoteSocket, webSocket, headerData, retryFunc) {
  let header = headerData;
  let hasData = false;
  let reader;
  let useBYOB = false;
  const BYOB_MAX = 64 * 1024;
  const sender = createGrainSender(webSocket, header);
  header = null;

  try { reader = remoteSocket.readable.getReader({ mode: 'byob' }); useBYOB = true; }
  catch (_) { reader = remoteSocket.readable.getReader(); }

  try {
    if (!useBYOB) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || value.byteLength === 0) continue;
        hasData = true;
        await sender.send(value);
      }
    } else {
      let buf = new ArrayBuffer(BYOB_MAX);
      while (true) {
        const { done, value } = await reader.read(new Uint8Array(buf, 0, BYOB_MAX));
        if (done) break;
        if (!value || value.byteLength === 0) continue;
        hasData = true;
        if (value.byteLength >= 32 * 1024) {
          await sender.flush();
          await sender.sendDirect(value);
          buf = new ArrayBuffer(BYOB_MAX);
        } else {
          await sender.send(value);
          buf = value.buffer.byteLength >= BYOB_MAX ? value.buffer : new ArrayBuffer(BYOB_MAX);
        }
      }
    }
    await sender.flush();
  } catch (_) {
    closeSocketQuietly(webSocket);
  } finally {
    try { reader.cancel(); } catch (_) {}
    try { reader.releaseLock(); } catch (_) {}
  }
  if (!hasData && retryFunc) await retryFunc();
}