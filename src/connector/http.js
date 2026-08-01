/**
 * HTTP/HTTPS CONNECT 连接器。
 *
 * 通过 HTTP 代理建立到目标的 TCP 连接。
 * 支持 Basic 认证。
 */

export async function httpConnect(socket, target, credentials, isTLS = false) {
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();

  if (isTLS && socket.opened) await socket.opened;

  try {
    const { username, password } = credentials || {};
    const auth = username && password ? `Proxy-Authorization: Basic ${btoa(`${username}:${password}`)}\r\n` : '';
    const request = `CONNECT ${target.hostname}:${target.port} HTTP/1.1\r\nHost: ${target.hostname}:${target.port}\r\n${auth}User-Agent: Mozilla/5.0\r\nConnection: keep-alive\r\n\r\n`;
    await writer.write(new TextEncoder().encode(request));
    writer.releaseLock();

    // 读取 HTTP 响应头
    const header = new Uint8Array(8192);
    let length = 0, matched = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done || !value) throw new Error('HTTP proxy closed connection');
      for (let i = 0; i < value.byteLength; i++) {
        if (length >= 8192) throw new Error('HTTP CONNECT response too large');
        header[length++] = value[i];
        const expected = [0x0d, 0x0a, 0x0d, 0x0a][matched];
        if (value[i] === expected) matched++;
        else matched = value[i] === 0x0d ? 1 : 0;
        if (matched === 4) {
          const status = new TextDecoder().decode(header.slice(0, length)).match(/HTTP\/\d\.\d\s+(\d{3})/);
          if (!status || Number(status[1]) >= 300) throw new Error(`HTTP CONNECT failed: ${status ? status[1] : 'unknown'}`);
          reader.releaseLock();
          return socket;
        }
      }
    }
  } catch (err) {
    writer.releaseLock().catch(() => {});
    reader.releaseLock().catch(() => {});
    socket.close().catch(() => {});
    throw err;
  }
}