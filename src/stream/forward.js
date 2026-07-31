export async function forwardTcpSession({ firstPacket, reader, bridge, connectTcp }) {
  const socket = connectTcp({ hostname: firstPacket.hostname, port: firstPacket.port });
  let remoteWriter;
  let uploadError;

  const downloadPump = pumpRemoteToBridge(socket, bridge)
    .catch((error) => {
      bridge.close(error);
    });

  try {
    remoteWriter = socket.writable.getWriter();

    if (firstPacket.payload.byteLength > 0) {
      await remoteWriter.write(firstPacket.payload);
    }

    while (!bridge.closed) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = toUint8Array(value);
      if (chunk.byteLength === 0) continue;
      await remoteWriter.write(chunk);
    }
  } catch (error) {
    uploadError = error;
    bridge.close(error);
  } finally {
    if (remoteWriter) {
      try {
        await remoteWriter.close();
      } catch {
        try {
          remoteWriter.releaseLock();
        } catch {
          // Ignore close races from remote disconnects.
        }
      }
    }

    try {
      await downloadPump;
    } catch {
      // The download pump already signalled the response bridge.
    }

    closeSocket(socket);
  }

  if (uploadError) throw uploadError;
}

async function pumpRemoteToBridge(socket, bridge) {
  const remoteReader = socket.readable.getReader();

  try {
    while (!bridge.closed) {
      const { done, value } = await remoteReader.read();
      if (done) break;
      if (!bridge.send(value)) break;
    }
  } finally {
    try {
      remoteReader.releaseLock();
    } catch {
      // Ignore release races from runtime stream shutdown.
    }
  }
}

function closeSocket(socket) {
  try {
    socket?.close?.();
  } catch {
    // Ignore close races.
  }
}

function toUint8Array(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return new Uint8Array(value || 0);
}
