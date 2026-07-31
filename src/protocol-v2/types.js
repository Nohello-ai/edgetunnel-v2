export const NEED_MORE = Object.freeze({ status: 'need-more' });

export function ready(request, remainder = new Uint8Array()) {
  return { status: 'ready', request, remainder };
}

export function protocolError(code) {
  return { status: 'error', code };
}
