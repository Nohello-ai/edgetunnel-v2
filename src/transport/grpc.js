// transport/grpc.js — gRPC 传输处理（原版提取，行 838-1085）

import { toBytes, dataLength, log } from '../utils.js';
import { DOWNSTREAM_GRAIN_PACKET, DOWNSTREAM_GRAIN_SILENCE_MS } from '../context.js';
import { createUpstreamQueue } from '../stream/upstream-queue.js';
import { parseTrojan } from '../protocol/trojan.js';
import { parseVLESS } from '../protocol/vless.js';
import { forwardataTCP, forwardataudp, isSpeedTestSite } from '../proxy/forward.js';
import { forwardTrojanUDP } from '../protocol/trojan.js';

export async function handleGRPC(request, yourUUID) {
  if (!request.body) return new Response('Bad Request', { status: 400 });
  const reader = request.body.getReader();
  const remoteConnWrapper = { socket: null, connectingPromise: null, retryConnect: null };
  let isDnsQuery = false;
  const trojanUDPCtx = { cache: new Uint8Array(0) };
  let isTrojan = null;
  let currentSocket = null;
  let remoteWriter = null;
  let grpcUpstreamQueue = null;

  const grpcHeaders = new Headers({
    'Content-Type': 'application/grpc',
    'grpc-status': '0',
    'X-Accel-Buffering': 'no',
    'Cache-Control': 'no-store'
  });

  const downBufLimit = DOWNSTREAM_GRAIN_PACKET;
  const downFlushInterval = Math.max(DOWNSTREAM_GRAIN_SILENCE_MS, 1);

  return new Response(new ReadableStream({
    async start(controller) {
      let closed = false;
      let sendQueue = [];
      let queueBytes = 0;
      let flushTimer = null;
      let microtaskQueued = false;

      const grpcBridge = {
        readyState: WebSocket.OPEN,
        send(data) {
          if (closed) return;
          const chunk = data instanceof Uint8Array ? data : new Uint8Array(data);
          const lenBytesArr = [];
          let remaining = chunk.byteLength >>> 0;
          while (remaining > 127) {
            lenBytesArr.push((remaining & 0x7f) | 0x80);
            remaining >>>= 7;
          }
          lenBytesArr.push(remaining);
          const lenBytes = new Uint8Array(lenBytesArr);
          const protobufLen = 1 + lenBytes.length + chunk.byteLength;
          const frame = new Uint8Array(5 + protobufLen);
          frame[0] = 0;
          frame[1] = (protobufLen >>> 24) & 0xff;
          frame[2] = (protobufLen >>> 16) & 0xff;
          frame[3] = (protobufLen >>> 8) & 0xff;
          frame[4] = protobufLen & 0xff;
          frame[5] = 0x0a;
          frame.set(lenBytes, 6);
          frame.set(chunk, 6 + lenBytes.length);
          sendQueue.push(frame);
          queueBytes += frame.byteLength;
          scheduleFlush();
        },
        close() {
          if (this.readyState === WebSocket.CLOSED) return;
          flushQueue(true);
          closed = true;
          this.readyState = WebSocket.CLOSED;
          try { controller.close(); } catch (e) { }
        }
      };

      const flushQueue = (force = false) => {
        microtaskQueued = false;
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        if ((!force && closed) || queueBytes === 0) return;
        const out = new Uint8Array(queueBytes);
        let offset = 0;
        for (const item of sendQueue) {
          out.set(item, offset);
          offset += item.byteLength;
        }
        sendQueue = [];
        queueBytes = 0;
        try {
          controller.enqueue(out);
        } catch (e) {
          closed = true;
          grpcBridge.readyState = WebSocket.CLOSED;
        }
      };

      const scheduleFlush = () => {
        if (queueBytes >= downBufLimit) {
          flushQueue();
          return;
        }
        if (microtaskQueued || flushTimer) return;
        microtaskQueued = true;
        queueMicrotask(() => {
          microtaskQueued = false;
          if (closed || queueBytes === 0 || flushTimer) return;
          flushTimer = setTimeout(flushQueue, downFlushInterval);
        });
      };

      const closeConnection = () => {
        if (closed) return;
        grpcUpstreamQueue?.clear();
        flushQueue(true);
        closed = true;
        grpcBridge.readyState = WebSocket.CLOSED;
        if (flushTimer) clearTimeout(flushTimer);
        if (remoteWriter) {
          try { remoteWriter.releaseLock(); } catch (e) { }
          remoteWriter = null;
        }
        currentSocket = null;
        try { reader.releaseLock(); } catch (e) { }
        try { remoteConnWrapper.socket?.close(); } catch (e) { }
        try { controller.close(); } catch (e) { }
      };

      const releaseRemoteWriter = () => {
        if (remoteWriter) {
          try { remoteWriter.releaseLock(); } catch (e) { }
          remoteWriter = null;
        }
        currentSocket = null;
      };

      const upstreamQueue = grpcUpstreamQueue = createUpstreamQueue({
        getWriter: () => {
          const socket = remoteConnWrapper.socket;
          if (!socket) return null;
          if (socket !== currentSocket) {
            releaseRemoteWriter();
            currentSocket = socket;
            remoteWriter = socket.writable.getWriter();
          }
          return remoteWriter;
        },
        releaseWriter: releaseRemoteWriter,
        retryConnect: async () => {
          if (typeof remoteConnWrapper.retryConnect !== 'function') throw new Error('retry unavailable');
          await remoteConnWrapper.retryConnect();
        },
        closeConnection,
        name: 'gRPC上行'
      });

      const writeToRemote = async (payload, allowRetry = true) => {
        return upstreamQueue.writeAndWait(payload, allowRetry);
      };

      try {
        let pending = new Uint8Array(0);
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value || value.byteLength === 0) continue;
          const block = value instanceof Uint8Array ? value : new Uint8Array(value);
          const merged = new Uint8Array(pending.length + block.length);
          merged.set(pending, 0);
          merged.set(block, pending.length);
          pending = merged;

          while (pending.byteLength >= 5) {
            const grpcLen = ((pending[1] << 24) >>> 0) | (pending[2] << 16) | (pending[3] << 8) | pending[4];
            const frameSize = 5 + grpcLen;
            if (pending.byteLength < frameSize) break;
            const grpcPayload = pending.subarray(5, frameSize);
            pending = pending.slice(frameSize);
            if (!grpcPayload.byteLength) continue;

            let payload = grpcPayload;
            if (payload.byteLength >= 2 && payload[0] === 0x0a) {
              let shift = 0;
              let offset = 1;
              let varintValid = false;
              while (offset < payload.length) {
                const current = payload[offset++];
                if ((current & 0x80) === 0) {
                  varintValid = true;
                  break;
                }
                shift += 7;
                if (shift > 35) break;
              }
              if (varintValid) payload = payload.subarray(offset);
            }
            if (!payload.byteLength) continue;

            if (isDnsQuery) {
              if (isTrojan) await forwardTrojanUDP(payload, grpcBridge, trojanUDPCtx, request);
              else await forwardataudp(payload, grpcBridge, null, request);
              continue;
            }

            if (remoteConnWrapper.socket) {
              if (!(await writeToRemote(payload))) throw new Error('Remote socket is not ready');
            } else {
              const firstBytes = toBytes(payload);
              if (isTrojan === null) isTrojan = firstBytes.byteLength >= 58 && firstBytes[56] === 0x0d && firstBytes[57] === 0x0a;

              if (isTrojan) {
                const parsed = parseTrojan(firstBytes, yourUUID);
                if (parsed?.hasError) throw new Error(parsed.message || 'Invalid trojan request');
                const { port, hostname, rawClientData, isUDP } = parsed;
                log(`[gRPC] Trojan first: ${hostname}:${port} | UDP: ${isUDP ? 'yes' : 'no'}`);
                if (isSpeedTestSite(hostname)) throw new Error('Speedtest site is blocked');
                if (isUDP) {
                  isDnsQuery = true;
                  if (dataLength(rawClientData) > 0) await forwardTrojanUDP(rawClientData, grpcBridge, trojanUDPCtx, request);
                } else {
                  await forwardataTCP(hostname, port, rawClientData, grpcBridge, null, remoteConnWrapper, yourUUID, request);
                }
              } else {
                isTrojan = false;
                const parsed = parseVLESS(firstBytes, yourUUID);
                if (parsed?.hasError) throw new Error(parsed.message || 'Invalid VLESS request');
                const { port, hostname, version, isUDP, rawClientData } = parsed;
                log(`[gRPC] VLESS first: ${hostname}:${port} | UDP: ${isUDP ? 'yes' : 'no'}`);
                if (isSpeedTestSite(hostname)) throw new Error('Speedtest site is blocked');
                if (isUDP) {
                  if (port !== 53) throw new Error('UDP is not supported');
                  isDnsQuery = true;
                }
                const respHeader = new Uint8Array([version, 0]);
                grpcBridge.send(respHeader);
                const rawData = rawClientData;
                if (isDnsQuery) {
                  if (isTrojan) await forwardTrojanUDP(rawData, grpcBridge, trojanUDPCtx, request);
                  else await forwardataudp(rawData, grpcBridge, null, request);
                } else {
                  await forwardataTCP(hostname, port, rawData, grpcBridge, null, remoteConnWrapper, yourUUID, request);
                }
              }
            }
          }
          flushQueue();
        }
        await upstreamQueue.waitEmpty();
      } catch (err) {
        log(`[gRPC] Error: ${err?.message || err}`);
      } finally {
        upstreamQueue.clear();
        releaseRemoteWriter();
        closeConnection();
      }
    },
    cancel() {
      grpcUpstreamQueue?.clear();
      try { remoteConnWrapper.socket?.close(); } catch (e) { }
      try { reader.releaseLock(); } catch (e) { }
    }
  }), { status: 200, headers: grpcHeaders });
}
