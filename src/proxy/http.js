// proxy/http.js — HTTP/HTTPS 代理连接
// 对应原文件: httpConnect + httpsConnect (行 2539-2696)

import { toBytes, dataLength, concatBytes, isIPHostname, stripIPv6Brackets } from '../utils.js';
import { TlsClient } from '../tls.js';

export async function httpConnect(targetHost, targetPort, initialData, parsedAddress, createTCP, isHTTPS = false) {
  const { username, password, hostname, port } = parsedAddress;
  const socket = isHTTPS
    ? createTCP({ hostname, port }, { secureTransport: 'on', allowHalfOpen: false })
    : createTCP({ hostname, port });
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  try {
    if (isHTTPS) await socket.opened;
    const auth = (username && password)
      ? `Proxy-Authorization: Basic ${btoa(`${username}:${password}`)}\r\n`
      : '';
    const request = `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n${auth}User-Agent: Mozilla/5.0\r\nConnection: keep-alive\r\n\r\n`;
    await writer.write(encoder.encode(request));
    writer.releaseLock();

    let respBuf = new Uint8Array(0), headerEnd = -1, bytesRead = 0;
    while (headerEnd === -1 && bytesRead < 8192) {
      const { done, value } = await reader.read();
      if (done || !value) throw new Error(`${isHTTPS ? 'HTTPS' : 'HTTP'} proxy closed before CONNECT response`);
      respBuf = new Uint8Array([...respBuf, ...value]);
      bytesRead = respBuf.length;
      const crlf = respBuf.findIndex((_, i) =>
        i < respBuf.length - 3 && respBuf[i] === 0x0d && respBuf[i + 1] === 0x0a && respBuf[i + 2] === 0x0d && respBuf[i + 3] === 0x0a);
      if (crlf !== -1) headerEnd = crlf + 4;
    }
    if (headerEnd === -1) throw new Error('Proxy CONNECT header too long');
    const statusLine = decoder.decode(respBuf.slice(0, headerEnd)).split('\r\n')[0];
    const statusCode = parseInt((statusLine.match(/HTTP\/\d\.\d\s+(\d+)/) || [])[1], 10);
    if (!Number.isFinite(statusCode) || statusCode < 200 || statusCode >= 300) throw new Error(`Connection failed: HTTP ${statusCode}`);

    reader.releaseLock();

    if (dataLength(initialData) > 0) {
      const w = socket.writable.getWriter();
      await w.write(initialData);
      w.releaseLock();
    }

    if (bytesRead > headerEnd) {
      const { readable, writable } = new TransformStream();
      const tw = writable.getWriter();
      await tw.write(respBuf.subarray(headerEnd, bytesRead));
      tw.releaseLock();
      socket.readable.pipeTo(writable).catch(() => {});
      return { readable, writable: socket.writable, closed: socket.closed, close: () => socket.close() };
    }
    return socket;
  } catch (error) {
    try { writer.releaseLock(); } catch (_) {}
    try { reader.releaseLock(); } catch (_) {}
    try { socket.close(); } catch (_) {}
    throw error;
  }
}

export async function httpsConnect(targetHost, targetPort, initialData, parsedAddress, createTCP) {
  const { username, password, hostname, port } = parsedAddress;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let tlsSocket = null;
  const tlsServerName = isIPHostname(hostname) ? '' : stripIPv6Brackets(hostname);

  const openTLSToProxy = async (allowChacha = false) => {
    const proxySocket = createTCP({ hostname, port });
    try {
      await proxySocket.opened;
      const socket = new TlsClient(proxySocket, { serverName: tlsServerName, insecure: true, allowChacha });
      await socket.handshake();
      return socket;
    } catch (e) {
      try { proxySocket.close(); } catch (_) {}
      throw e;
    }
  };

  try {
    try { tlsSocket = await openTLSToProxy(false); }
    catch (e) {
      if (!/cipher|handshake|TLS Alert|ServerHello|Finished|Unsupported|Missing TLS/i.test(e?.message || `${e}`)) throw e;
      tlsSocket = await openTLSToProxy(true);
    }

    const auth = (username && password) ? `Proxy-Authorization: Basic ${btoa(`${username}:${password}`)}\r\n` : '';
    const request = `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n${auth}User-Agent: Mozilla/5.0\r\nConnection: keep-alive\r\n\r\n`;
    await tlsSocket.write(encoder.encode(request));

    let respBuf = new Uint8Array(0), headerEnd = -1, bytesRead = 0;
    while (headerEnd === -1 && bytesRead < 8192) {
      const value = await tlsSocket.read();
      if (!value) throw new Error('HTTPS proxy closed before CONNECT response');
      respBuf = concatBytes(respBuf, value);
      bytesRead = respBuf.length;
      const crlf = respBuf.findIndex((_, i) =>
        i < respBuf.length - 3 && respBuf[i] === 0x0d && respBuf[i + 1] === 0x0a && respBuf[i + 2] === 0x0d && respBuf[i + 3] === 0x0a);
      if (crlf !== -1) headerEnd = crlf + 4;
    }
    if (headerEnd === -1) throw new Error('HTTPS proxy CONNECT header too long');
    const statusLine = decoder.decode(respBuf.slice(0, headerEnd)).split('\r\n')[0];
    const statusCode = parseInt((statusLine.match(/HTTP\/\d\.\d\s+(\d+)/) || [])[1], 10);
    if (!Number.isFinite(statusCode) || statusCode < 200 || statusCode >= 300) throw new Error(`Connection failed: HTTP ${statusCode}`);

    if (dataLength(initialData) > 0) await tlsSocket.write(toBytes(initialData));
    const buffered = bytesRead > headerEnd ? respBuf.subarray(headerEnd, bytesRead) : null;

    let settled = false, resolveClosed, rejectClosed;
    const closed = new Promise((res, rej) => { resolveClosed = res; rejectClosed = rej; });
    const close = () => { try { tlsSocket.close(); } catch (_) {} if (!settled) { settled = true; resolveClosed(); } };

    const readable = new ReadableStream({
      async start(ctrl) {
        try {
          if (dataLength(buffered) > 0) ctrl.enqueue(buffered);
          while (true) {
            const val = await tlsSocket.read();
            if (!val) break;
            if (val.byteLength > 0) ctrl.enqueue(val);
          }
          ctrl.close();
          if (!settled) { settled = true; resolveClosed(); }
        } catch (err) {
          try { ctrl.error(err); } catch (_) {}
          if (!settled) { settled = true; rejectClosed(err); }
        }
      },
      cancel() { close(); }
    });
    const writable = new WritableStream({
      async write(chunk) { await tlsSocket.write(toBytes(chunk)); },
      close,
      abort(err) { close(); if (err && !settled) { settled = true; rejectClosed(err); } }
    });
    return { readable, writable, closed, close };
  } catch (error) {
    try { tlsSocket?.close(); } catch (_) {}
    throw error;
  }
}