/**
 * SOCKS5 连接器。
 *
 * 通过 SOCKS5 代理建立到目标的 TCP 连接。
 * 支持用户名/密码认证。
 */

export async function socks5Connect(socket, target, credentials) {
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  const buffer = { data: new Uint8Array(0) };

  async function read(n) {
    while (buffer.data.byteLength < n) {
      const { done, value } = await reader.read();
      if (done || !value) throw new Error('SOCKS5 connection closed prematurely');
      const merged = new Uint8Array(buffer.data.byteLength + value.byteLength);
      merged.set(buffer.data);
      merged.set(value, buffer.data.byteLength);
      buffer.data = merged;
    }
    const result = buffer.data.slice(0, n);
    buffer.data = buffer.data.slice(n);
    return result;
  }

  try {
    const { username, password, hostname, port } = credentials || {};
    const hasAuth = Boolean(username && password);

    // 协商认证方式
    const methods = hasAuth ? new Uint8Array([5, 2, 0, 2]) : new Uint8Array([5, 1, 0]);
    await writer.write(methods);
    const methodResp = await read(2);
    if (methodResp[0] !== 5) throw new Error('SOCKS5 invalid version');
    if (methodResp[1] === 2) {
      if (!hasAuth) throw new Error('SOCKS5 server requires authentication');
      const u = new TextEncoder().encode(username);
      const p = new TextEncoder().encode(password);
      const authReq = new Uint8Array(1 + 1 + u.length + 1 + p.length);
      authReq[0] = 1;
      authReq[1] = u.length;
      authReq.set(u, 2);
      authReq[2 + u.length] = p.length;
      authReq.set(p, 3 + u.length);
      await writer.write(authReq);
      const authResp = await read(2);
      if (authResp[0] !== 1 || authResp[1] !== 0) throw new Error('SOCKS5 authentication failed');
    } else if (methodResp[1] !== 0) {
      throw new Error(`SOCKS5 unsupported auth method: ${methodResp[1]}`);
    }

    // CONNECT 请求
    const hostBytes = new TextEncoder().encode(target.hostname);
    const req = new Uint8Array(4 + 1 + hostBytes.length + 2);
    req[0] = 5; req[1] = 1; req[2] = 0; req[3] = 3; // ATYP=3 (domain)
    req[4] = hostBytes.length;
    req.set(hostBytes, 5);
    req[5 + hostBytes.length] = (target.port >> 8) & 0xff;
    req[5 + hostBytes.length + 1] = target.port & 0xff;
    await writer.write(req);

    // 读取响应
    const resp = await read(4);
    if (resp[0] !== 5 || resp[1] !== 0) throw new Error(`SOCKS5 connection failed: ${resp[1]}`);
    let addrLen = resp[3] === 1 ? 4 : resp[3] === 4 ? 16 : resp[3] === 3 ? 1 + (await read(1))[0] : 0;
    if (addrLen > 0) await read(addrLen + 2); // 跳过地址和端口

    writer.releaseLock();
    reader.releaseLock();
    return socket;
  } catch (err) {
    writer.releaseLock().catch(() => {});
    reader.releaseLock().catch(() => {});
    socket.close().catch(() => {});
    throw err;
  }
}