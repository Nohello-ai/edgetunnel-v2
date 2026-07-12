// proxy/socks5.js — SOCKS5 代理连接
// 对应原文件: socks5Connect (行 2502-2537)

import { dataLength } from '../utils.js';

export async function socks5Connect(targetHost, targetPort, initialData, parsedAddress, createTCP) {
  const { username, password, hostname, port } = parsedAddress;
  const socket = createTCP({ hostname, port });
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();

  try {
    const authMethods = (username && password)
      ? new Uint8Array([0x05, 0x02, 0x00, 0x02])
      : new Uint8Array([0x05, 0x01, 0x00]);
    await writer.write(authMethods);

    let response = await reader.read();
    if (response.done || response.value.byteLength < 2) throw new Error('S5 method selection failed');

    const selectedMethod = new Uint8Array(response.value)[1];
    if (selectedMethod === 0x02) {
      if (!username || !password) throw new Error('S5 requires authentication');
      const userBytes = new TextEncoder().encode(username);
      const passBytes = new TextEncoder().encode(password);
      const authPacket = new Uint8Array([0x01, userBytes.length, ...userBytes, passBytes.length, ...passBytes]);
      await writer.write(authPacket);
      response = await reader.read();
      if (response.done || new Uint8Array(response.value)[1] !== 0x00) throw new Error('S5 authentication failed');
    } else if (selectedMethod !== 0x00) {
      throw new Error(`S5 unsupported auth method: ${selectedMethod}`);
    }

    const hostBytes = new TextEncoder().encode(targetHost);
    const connectPacket = new Uint8Array([
      0x05, 0x01, 0x00, 0x03,
      hostBytes.length, ...hostBytes,
      targetPort >> 8, targetPort & 0xff,
    ]);
    await writer.write(connectPacket);
    response = await reader.read();
    if (response.done || new Uint8Array(response.value)[1] !== 0x00) throw new Error('S5 connection failed');

    if (dataLength(initialData) > 0) await writer.write(initialData);
    writer.releaseLock();
    reader.releaseLock();
    return socket;
  } catch (error) {
    try { writer.releaseLock(); } catch (_) {}
    try { reader.releaseLock(); } catch (_) {}
    try { socket.close(); } catch (_) {}
    throw error;
  }
}