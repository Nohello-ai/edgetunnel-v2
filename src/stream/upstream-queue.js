// stream/upstream-queue.js — 上行写入队列（合包 + 背压 + 重试）
// 对应原文件: 创建上行写入队列 (行 2158-2340)

import { toBytes } from '../utils.js';
import { UPSTREAM_BUNDLE_TARGET, UPSTREAM_QUEUE_MAX_BYTES, UPSTREAM_QUEUE_MAX_ITEMS } from '../config.js';

export function createUpstreamQueue({ getWriter, releaseWriter, retryConnect, closeConnection, name = 'upstream' }) {
  let chunks = [];
  let head = 0;
  let queuedBytes = 0;
  let draining = false;
  let closed = false;
  let bundleBuffer = null;
  let idleResolvers = [];
  let activeCompletions = null;

  const settle = (completions, err = null) => {
    if (!completions) return;
    for (const c of completions) {
      if (err) c.reject(err);
      else c.resolve();
    }
  };

  const rejectQueued = (err) => {
    for (let i = head; i < chunks.length; i++) {
      if (chunks[i]?.completions) settle(chunks[i].completions, err);
    }
  };

  const compact = () => {
    if (head > 32 && head * 2 >= chunks.length) {
      chunks = chunks.slice(head);
      head = 0;
    }
  };

  const resolveIdle = () => {
    if (queuedBytes || draining || !idleResolvers.length) return;
    const rs = idleResolvers;
    idleResolvers = [];
    for (const r of rs) r();
  };

  const clear = (err = null) => {
    const closeErr = err || (closed ? new Error(`${name}: queue closed`) : null);
    if (closeErr) {
      rejectQueued(closeErr);
      settle(activeCompletions, closeErr);
      activeCompletions = null;
    }
    chunks = [];
    head = 0;
    queuedBytes = 0;
    resolveIdle();
  };

  const shift = () => {
    if (head >= chunks.length) return null;
    const item = chunks[head];
    chunks[head++] = undefined;
    queuedBytes -= item.chunk.byteLength;
    compact();
    return item;
  };

  const bundle = () => {
    const first = shift();
    if (!first) return null;
    if (head >= chunks.length || first.chunk.byteLength >= UPSTREAM_BUNDLE_TARGET) return first;

    let byteLen = first.chunk.byteLength;
    let end = head;
    let allowRetry = first.allowRetry;
    let completionList = first.completions || null;

    while (end < chunks.length) {
      const next = chunks[end];
      if (byteLen + next.chunk.byteLength > UPSTREAM_BUNDLE_TARGET) break;
      byteLen += next.chunk.byteLength;
      allowRetry = allowRetry && next.allowRetry;
      if (next.completions) completionList = completionList ? completionList.concat(next.completions) : next.completions;
      end++;
    }
    if (end === head) return first;

    const output = (bundleBuffer || (bundleBuffer = new Uint8Array(UPSTREAM_BUNDLE_TARGET)));
    output.set(first.chunk);
    let offset = first.chunk.byteLength;
    while (head < end) {
      const next = chunks[head];
      chunks[head++] = undefined;
      queuedBytes -= next.chunk.byteLength;
      output.set(next.chunk, offset);
      offset += next.chunk.byteLength;
    }
    compact();
    return { chunk: output.subarray(0, byteLen), allowRetry, completions: completionList };
  };

  const drain = async () => {
    if (draining || closed) return;
    draining = true;
    try {
      for (;;) {
        if (closed) break;
        const item = bundle();
        if (!item) break;
        let writer = getWriter();
        if (!writer) throw new Error(`${name}: remote writer unavailable`);
        const completions = item.completions || null;
        activeCompletions = completions;
        try {
          try {
            await writer.write(item.chunk);
          } catch (err) {
            releaseWriter?.();
            if (!item.allowRetry || typeof retryConnect !== 'function') throw err;
            await retryConnect();
            writer = getWriter();
            if (!writer) throw err;
            await writer.write(item.chunk);
          }
          settle(completions);
        } catch (err) {
          settle(completions, err);
          throw err;
        } finally {
          if (activeCompletions === completions) activeCompletions = null;
        }
      }
    } catch (err) {
      closed = true;
      clear(err);
      try { closeConnection?.(err); } catch (_) {}
    } finally {
      draining = false;
      if (!closed && head < chunks.length) queueMicrotask(drain);
      else resolveIdle();
    }
  };

  const enqueue = (data, allowRetry = true, waitForFlush = false) => {
    if (closed) return false;
    if (!getWriter()) return false;
    const chunk = toBytes(data);
    if (!chunk.byteLength) return true;
    const nextBytes = queuedBytes + chunk.byteLength;
    const nextItems = chunks.length - head + 1;
    if (nextBytes > UPSTREAM_QUEUE_MAX_BYTES || nextItems > UPSTREAM_QUEUE_MAX_ITEMS) {
      closed = true;
      const err = Object.assign(new Error(`${name}: overflow (${nextBytes}B/${nextItems})`), { isQueueOverflow: true });
      clear(err);
      try { closeConnection?.(err); } catch (_) {}
      throw err;
    }
    let completionPromise = null;
    let completions = null;
    if (waitForFlush) {
      completions = [];
      completionPromise = new Promise((resolve, reject) => completions.push({ resolve, reject }));
    }
    chunks.push({ chunk, allowRetry, completions });
    queuedBytes = nextBytes;
    if (!draining) queueMicrotask(drain);
    return waitForFlush ? completionPromise.then(() => true) : true;
  };

  return {
    write(data, allowRetry = true) { return enqueue(data, allowRetry, false); },
    writeAndWait(data, allowRetry = true) { return enqueue(data, allowRetry, true); },
    async waitEmpty() { if (!queuedBytes && !draining) return; await new Promise(r => idleResolvers.push(r)); },
    clear() { closed = true; clear(); },
  };
}