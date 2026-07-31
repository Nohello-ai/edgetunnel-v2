export function createStreamBridge(controller) {
  let closed = false;

  return {
    get closed() {
      return closed;
    },
    send(value) {
      if (closed) return false;
      try {
        controller.enqueue(toUint8Array(value));
        return true;
      } catch {
        closed = true;
        return false;
      }
    },
    close(error) {
      if (closed) return;
      closed = true;
      try {
        if (error) controller.error(error);
        else controller.close();
      } catch {
        // The response stream may already be closed by the runtime.
      }
    },
  };
}

function toUint8Array(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return new Uint8Array(value || 0);
}
