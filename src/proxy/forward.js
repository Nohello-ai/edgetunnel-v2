// proxy/forward.js — TCP/UDP forwarding + connection helpers
import { toBytes, dataLength, log, closeSocketQuietly, wsSend } from '../utils.js';
import { connectStreams } from '../stream/connect-streams.js';

// ---- TCP forwarding ----

export async function forwardataTCP(host, portNum, rawData, ws, respHeader, remoteConnWrapper, yourUUID, request) {
  log(true, `[TCP] forwarding to ${host}:${portNum}`);
  const req = /** @type {any} */ (request);
  const fetcher = req?.fetcher;
  if (!fetcher || typeof fetcher.connect !== 'function') {
    throw new Error('request.fetcher.connect unavailable');
  }

  const tcpConnect = (/** @type {any} */ opts) => fetcher.connect(opts);

  /** Open a TCP connection and wait for it to be ready */
  async function openTCP(address, port) {
    const sock = tcpConnect({ hostname: address, port });
    await sock.opened;
    return sock;
  }

  /** Write initial data to the socket */
  async function writeFirstPacket(sock, data) {
    if (dataLength(data) <= 0) return;
    const writer = sock.writable.getWriter();
    try { await writer.write(toBytes(data)); }
    finally { try { writer.releaseLock(); } catch (_) {} }
  }

  async function doConnect() {
    let sock = null;
    try {
      sock = await openTCP(host, portNum);
      await writeFirstPacket(sock, rawData);
      remoteConnWrapper.socket = sock;
      // connectStreams bridges socket.readable → ws.send (via grainSender)
      // retryFunc is called if stream ends with zero data transferred
      connectStreams(sock, ws, respHeader, async () => {
        if (remoteConnWrapper.socket !== sock) return;
        log(true, `[TCP] zero-data stream ended, triggering retry`);
        await doConnect();
      });
    } catch (err) {
      log(true, `[TCP] connect to ${host}:${portNum} failed: ${err?.message || err}`);
      try { sock?.close?.(); } catch (_) {}
      throw err;
    }
  }

  remoteConnWrapper.retryConnect = async () => {
    log(true, `[TCP] retrying connection to ${host}:${portNum}`);
    await doConnect();
  };

  await doConnect();
}

// ---- UDP (DNS) forwarding ----

export async function forwardataudp(udpChunk, webSocket, respHeader, request, responseWrapper = null) {
  const data = toBytes(udpChunk);
  const byteLen = data.byteLength;
  log(true, `[UDP] DNS request: ${byteLen}B -> 8.8.4.4:53`);

  try {
    const req = /** @type {any} */ (request);
    const fetcher = req?.fetcher;
    if (!fetcher?.connect) throw new Error('fetcher.connect unavailable');

    const tcpSocket = fetcher.connect({ hostname: '8.8.4.4', port: 53 });
    let vlessHeader = respHeader;
    const writer = tcpSocket.writable.getWriter();
    await writer.write(data);
    log(true, `[UDP] DNS request written: ${byteLen}B`);
    writer.releaseLock();

    await tcpSocket.readable.pipeTo(new WritableStream({
      async write(chunk) {
        const response = toBytes(chunk);
        log(true, `[UDP] DNS response: ${response.byteLength}B`);
        if (webSocket.readyState !== WebSocket.OPEN) return;
        // Allow caller to transform the response (used by Trojan UDP)
        const fragments = responseWrapper ? await responseWrapper(response) : response;
        const frames = Array.isArray(fragments) ? fragments : [fragments];
        for (const fragment of frames) {
          const frag = toBytes(fragment);
          if (!frag.byteLength) continue;
          if (vlessHeader) {
            const combined = new Uint8Array(vlessHeader.length + frag.byteLength);
            combined.set(vlessHeader, 0);
            combined.set(frag, vlessHeader.length);
            await wsSend(webSocket, combined.buffer);
            vlessHeader = null;
          } else {
            await wsSend(webSocket, frag);
          }
        }
      },
    }));
  } catch (error) {
    log(true, `[UDP] DNS forward failed: ${error?.message || error}`);
  }
}

// ---- Speed test detection ----

export function isSpeedTestSite(hostname) {
  const domains = [atob('c3BlZWQuY2xvdWRmbGFyZS5jb20=')];
  if (domains.includes(hostname)) return true;
  for (const domain of domains) {
    if (hostname.endsWith('.' + domain) || hostname === domain) return true;
  }
  return false;
}