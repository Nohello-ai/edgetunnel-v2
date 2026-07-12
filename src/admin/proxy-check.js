// admin/proxy-check.js — 代理连通性检测（admin/check 端点）
//
// 功能：检测 socks5/http/https/turn/sstp 代理是否可用
// 通过代理建立到 cloudflare.com:443 的 TLS 连接，GET /cdn-cgi/trace
// 返回 { success, proxy, ip, loc, responseTime }
//
// 依赖：
//   - ../proxy/socks5.js  → socks5Connect
//   - ../proxy/http.js    → httpConnect, httpsConnect
//   - ../proxy/turn.js    → turnConnect, sstpConnect
//   - ../tls.js           → TlsClient
//   - 拼接字节数据 (utils.js concatBytes)
//   - 获取代理默认端口 (context.js DEFAULT_PROXY_PORTS)
//   - 获取SOCKS5账号 (proxy/proxy-config.js parseProxyAddress)

import { concatBytes } from '../utils.js';
import { DEFAULT_PROXY_PORTS } from '../context.js';
import { parseProxyAddress } from '../proxy/proxy-config.js';
import { socks5Connect } from '../proxy/socks5.js';
import { httpConnect, httpsConnect } from '../proxy/http.js';
import { turnConnect, sstpConnect } from '../proxy/turn.js';
import { TlsClient } from '../tls.js';

const CHECK_HOST = 'cloudflare.com';
const CHECK_PORT = 443;
const MAX_RESPONSE_BYTES = 64 * 1024;

export async function proxyCheck(request, proxyProtocol, proxyParam) {
  const startTime = Date.now();
  const parsed = await parseProxyAddress(proxyParam, DEFAULT_PROXY_PORTS[proxyProtocol]);
  const { username, password, hostname, port } = parsed;
  const fullProxy = username && password ? `${username}:${password}@${hostname}:${port}` : `${hostname}:${port}`;

  try {
    const tcpConnector = createTCPConnector(request);
    let tcpSocket = null, tlsSocket = null;

    try {
      // 根据 proxyProtocol 选择对应的连接函数
      tcpSocket = proxyProtocol === 'socks5'
        ? await socks5Connect(CHECK_HOST, CHECK_PORT, new Uint8Array(0), parsed, tcpConnector)
        : proxyProtocol === 'turn'
          ? await turnConnect(parsed, CHECK_HOST, CHECK_PORT, tcpConnector)
          : proxyProtocol === 'sstp'
            ? await sstpConnect(parsed, CHECK_HOST, CHECK_PORT, tcpConnector)
            : proxyProtocol === 'https'
              ? await httpsConnect(CHECK_HOST, CHECK_PORT, new Uint8Array(0), parsed, tcpConnector)
              : await httpConnect(CHECK_HOST, CHECK_PORT, new Uint8Array(0), parsed, tcpConnector, false);

      if (!tcpSocket) throw new Error('无法连接到代理服务器');

      tlsSocket = new TlsClient(tcpSocket, { serverName: CHECK_HOST, insecure: true });
      await tlsSocket.handshake();
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();

      await tlsSocket.write(encoder.encode(`GET /cdn-cgi/trace HTTP/1.1\r\nHost: ${CHECK_HOST}\r\nUser-Agent: Mozilla/5.0\r\nConnection: close\r\n\r\n`));

      let responseBuffer = new Uint8Array(0);
      let headerEnd = -1;
      let contentLength = null;
      let chunked = false;

      while (responseBuffer.length < MAX_RESPONSE_BYTES) {
        const value = await tlsSocket.read();
        if (!value) break;
        if (value.byteLength === 0) continue;
        responseBuffer = concatBytes(responseBuffer, value);

        if (headerEnd === -1) {
          const crlfcrlf = responseBuffer.findIndex((_, i) =>
            i < responseBuffer.length - 3 &&
            responseBuffer[i] === 0x0d && responseBuffer[i + 1] === 0x0a &&
            responseBuffer[i + 2] === 0x0d && responseBuffer[i + 3] === 0x0a
          );
          if (crlfcrlf !== -1) {
            headerEnd = crlfcrlf + 4;
            const headers = decoder.decode(responseBuffer.slice(0, headerEnd));
            const statusLine = headers.split('\r\n')[0] || '';
            const statusMatch = statusLine.match(/HTTP\/\d\.\d\s+(\d+)/);
            const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : NaN;
            if (!Number.isFinite(statusCode) || statusCode < 200 || statusCode >= 300) {
              throw new Error(`代理检测请求失败: ${statusLine || '无效响应'}`);
            }
            const lengthMatch = headers.match(/\r\nContent-Length:\s*(\d+)/i);
            if (lengthMatch) contentLength = parseInt(lengthMatch[1], 10);
            chunked = /\r\nTransfer-Encoding:\s*chunked/i.test(headers);
          }
        }
        if (headerEnd !== -1 && contentLength !== null && responseBuffer.length >= headerEnd + contentLength) break;
        if (headerEnd !== -1 && chunked && decoder.decode(responseBuffer).includes('\r\n0\r\n\r\n')) break;
      }

      if (headerEnd === -1) throw new Error('代理检测响应头过长或无效');

      const response = decoder.decode(responseBuffer);
      const ip = response.match(/(?:^|\n)ip=(.*)/)?.[1];
      const loc = response.match(/(?:^|\n)loc=(.*)/)?.[1];
      if (!ip || !loc) throw new Error('代理检测响应无效');

      return { success: true, proxy: proxyProtocol + '://' + fullProxy, ip, loc, responseTime: Date.now() - startTime };
    } finally {
      try { tlsSocket ? tlsSocket.close() : await tcpSocket?.close?.(); } catch (e) { }
    }
  } catch (error) {
    return { success: false, error: error.message, proxy: proxyProtocol + '://' + fullProxy, responseTime: Date.now() - startTime };
  }
}

// 创建 TCP 连接器（对齐原版）
function createTCPConnector(request) {
  const fetcher = request?.fetcher;
  if (!fetcher || typeof fetcher.connect !== 'function') {
    throw new Error('request.fetcher.connect unavailable');
  }
  return (opts, extra) => fetcher.connect(opts, extra);
}