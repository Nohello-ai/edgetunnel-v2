// transport/xhttp.js — XHTTP 传输处理（原版提取，行 529-837）
import { toBytes, dataLength, log, closeSocketQuietly, sha224str } from '../utils.js';
import { createUpstreamQueue } from '../stream/upstream-queue.js';
import { forwardataTCP, forwardataudp, isSpeedTestSite } from '../proxy/forward.js';
import { forwardTrojanUDP } from '../protocol/trojan.js';
import { getUUIDBytes, uuidBytesMatch } from '../uuid.js';

const XHTTP_DECODER = new TextDecoder();

function parseVLESSFirst(data, token) {
  const len = data.byteLength;
  if (len < 18) return { s: 'more' };
  if (!uuidBytesMatch(data, 1, token)) return { s: 'bad' };
  const opt = data[17], ci = 18 + opt;
  if (len < ci + 1) return { s: 'more' };
  const cmd = data[ci];
  if (cmd !== 1 && cmd !== 2) return { s: 'bad' };
  const pi = ci + 1;
  if (len < pi + 3) return { s: 'more' };
  const port = (data[pi] << 8) | data[pi + 1];
  const at = data[pi + 2], ai = pi + 3;
  let hl = -1, host = '';
  if (at === 1) { if (len < ai + 4) return { s: 'more' }; host = `${data[ai]}.${data[ai+1]}.${data[ai+2]}.${data[ai+3]}`; hl = ai + 4; }
  else if (at === 2) { if (len < ai + 1) return { s: 'more' }; const dl = data[ai]; if (len < ai + 1 + dl) return { s: 'more' }; host = XHTTP_DECODER.decode(data.subarray(ai + 1, ai + 1 + dl)); hl = ai + 1 + dl; }
  else if (at === 3) { if (len < ai + 16) return { s: 'more' }; const a = []; for (let i = 0; i < 8; i++) { const b = ai + i * 2; a.push(((data[b] << 8) | data[b + 1]).toString(16)); } host = a.join(':'); hl = ai + 16; }
  else return { s: 'bad' };
  if (!host) return { s: 'bad' };
  return { s: 'ok', r: { proto: 'vless', host, port, udp: cmd === 2, raw: data.subarray(hl), hdr: new Uint8Array([data[0], 0]) } };
}

function parseTrojanFirst(data, token) {
  const hash = sha224str(token);
  const hb = new TextEncoder().encode(hash);
  const len = data.byteLength;
  if (len < 58) return { s: 'more' };
  if (data[56] !== 0x0d || data[57] !== 0x0a) return { s: 'bad' };
  for (let i = 0; i < 56; i++) if (data[i] !== hb[i]) return { s: 'bad' };
  const ss = 58;
  if (len < ss + 2) return { s: 'more' };
  const cmd = data[ss];
  if (cmd !== 1 && cmd !== 3) return { s: 'bad' };
  const udp = cmd === 3, at = data[ss + 1];
  let cur = ss + 2, host = '';
  if (at === 1) { if (len < cur + 4) return { s: 'more' }; host = `${data[cur]}.${data[cur+1]}.${data[cur+2]}.${data[cur+3]}`; cur += 4; }
  else if (at === 3) { if (len < cur + 1) return { s: 'more' }; const dl = data[cur]; if (len < cur + 1 + dl) return { s: 'more' }; host = XHTTP_DECODER.decode(data.subarray(cur + 1, cur + 1 + dl)); cur += 1 + dl; }
  else if (at === 4) { if (len < cur + 16) return { s: 'more' }; const a = []; for (let i = 0; i < 8; i++) { const b = cur + i * 2; a.push(((data[b] << 8) | data[b + 1]).toString(16)); } host = a.join(':'); cur += 16; }
  else return { s: 'bad' };
  if (!host) return { s: 'bad' };
  if (len < cur + 4) return { s: 'more' };
  const port = (data[cur] << 8) | data[cur + 1];
  if (data[cur + 2] !== 0x0d || data[cur + 3] !== 0x0a) return { s: 'bad' };
  return { s: 'ok', r: { proto: 'trojan', host, port, udp, raw: data.subarray(cur + 4), hdr: null } };
}

async function readXHTTPFirst(reader, token) {
  let buf = new Uint8Array(1024), off = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) { if (off === 0) return null; break; }
    const ch = value instanceof Uint8Array ? value : new Uint8Array(value);
    if (off + ch.byteLength > buf.byteLength) {
      const nb = new Uint8Array(Math.max(buf.byteLength * 2, off + ch.byteLength));
      nb.set(buf.subarray(0, off)); buf = nb;
    }
    buf.set(ch, off); off += ch.byteLength;
    const cd = buf.subarray(0, off);
    const tr = parseTrojanFirst(cd, token);
    if (tr.s === 'ok') return { ...tr.r, reader };
    const vr = parseVLESSFirst(cd, token);
    if (vr.s === 'ok') return { ...vr.r, reader };
    if (tr.s === 'bad' && vr.s === 'bad') return null;
  }
  const fd = buf.subarray(0, off);
  const ft = parseTrojanFirst(fd, token);
  if (ft.s === 'ok') return { ...ft.r, reader };
  const fv = parseVLESSFirst(fd, token);
  if (fv.s === 'ok') return { ...fv.r, reader };
  return null;
}

export async function handleXHTTP(request, yourUUID) {
  if (!request.body) return new Response('Bad Request', { status: 400 });
  const reader = request.body.getReader();
  const pkt = await readXHTTPFirst(reader, yourUUID);
  if (!pkt) { try { reader.releaseLock(); } catch (_) {} return new Response('Invalid request', { status: 400 }); }
  if (isSpeedTestSite(pkt.host)) { try { reader.releaseLock(); } catch (_) {} return new Response('Forbidden', { status: 403 }); }
  if (pkt.udp && pkt.proto !== 'trojan' && pkt.port !== 53) { try { reader.releaseLock(); } catch (_) {} return new Response('UDP unsupported', { status: 400 }); }

  const rw = { socket: null, connectingPromise: null, retryConnect: null };
  let cs = null, rwr = null;

  const relR = () => { if (rwr) { try { rwr.releaseLock(); } catch (_) {} rwr = null; } cs = null; };
  const getR = () => { const s = rw.socket; if (!s) return null; if (s !== cs) { relR(); cs = s; rwr = s.writable.getWriter(); } return rwr; };

  let uq = null;
  return new Response(new ReadableStream({
    async start(ctrl) {
      let cl = false, uh = pkt.hdr;
      const tu = { cache: new Uint8Array(0) };
      const br = {
        readyState: WebSocket.OPEN,
        send(d) {
          if (cl) return;
          try {
            const ck = d instanceof Uint8Array ? d : d instanceof ArrayBuffer ? new Uint8Array(d) : ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength) : new Uint8Array(d);
            ctrl.enqueue(ck);
          } catch (_) { cl = true; br.readyState = WebSocket.CLOSED; }
        },
        close() { if (!cl) { cl = true; br.readyState = WebSocket.CLOSED; try { ctrl.close(); } catch (_) {} } }
      };
      const uq2 = uq = createUpstreamQueue({
        getWriter: getR,
        releaseWriter: relR,
        retryConnect: async () => { if (typeof rw.retryConnect !== 'function') throw new Error('retry'); await rw.retryConnect(); },
        closeConnection: () => { try { rw.socket?.close(); } catch (_) {} closeSocketQuietly(br); },
        name: 'XHTTP上行'
      });
      const wr = async (p, ar = true) => uq2.writeAndWait(p, ar);
      try {
        if (pkt.udp) {
          if (pkt.raw?.byteLength) {
            if (pkt.proto === 'trojan') await forwardTrojanUDP(pkt.raw, br, tu, request);
            else await forwardataudp(pkt.raw, br, uh, request);
            uh = null;
          }
        } else { await forwardataTCP(pkt.host, pkt.port, pkt.raw, br, pkt.hdr, rw, yourUUID, request); }
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value || value.byteLength === 0) continue;
          if (pkt.udp) {
            if (pkt.proto === 'trojan') await forwardTrojanUDP(value, br, tu, request);
            else await forwardataudp(value, br, uh, request);
            uh = null;
          } else { if (!(await wr(value))) throw new Error('Remote not ready'); }
        }
        if (!pkt.udp) { await uq2.waitEmpty(); const w = getR(); if (w) { try { await w.close(); } catch (_) {} } }
      } catch (err) { log(`[XHTTP] Error: ${err?.message || err}`); closeSocketQuietly(br); }
      finally { uq2.clear(); relR(); try { reader.releaseLock(); } catch (_) {} }
    },
    cancel() { uq?.clear(); try { rw.socket?.close(); } catch (_) {} relR(); try { reader.releaseLock(); } catch (_) {} }
  }), { status: 200, headers: new Headers({ 'Content-Type': 'application/octet-stream', 'X-Accel-Buffering': 'no', 'Cache-Control': 'no-store' }) });
}