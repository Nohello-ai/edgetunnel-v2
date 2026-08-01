import { AppError } from '../core/errors.js';

const VALID_XHTTP_TYPES = ['application/x-http'];

export function openXhttpTransport(request) {
  const type = request.headers.get('content-type')?.toLowerCase() || '';
  if (request.method !== 'POST' || !VALID_XHTTP_TYPES.some(t => type === t || type.startsWith(t + ';'))) {
    throw new AppError('INVALID_XHTTP_REQUEST', 400);
  }
  if (!request.body) throw new AppError('XHTTP_BODY_REQUIRED', 400);
  if (VALID_XHTTP_TYPES.some(t => type === t || type.startsWith(t + ';')) && request.headers.get('x-http-mode') && request.headers.get('x-http-mode') !== 'stream-one') {
    throw new AppError('XHTTP_MODE_UNSUPPORTED', 400);
  }

  const responseStream = new TransformStream();
  const writer = responseStream.writable.getWriter();
  let closed = false;
  return {
    readable: request.body,
    async write(chunk) {
      if (closed) return;
      try { await writer.write(chunk); }
      catch { closed = true; }
    },
    async close(reason) {
      if (closed) return;
      closed = true;
      try {
        if (reason) await writer.abort(reason).catch(() => {});
        else await writer.close().catch(() => {});
      } catch {}
    },
    response: new Response(responseStream.readable, {
      headers: { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' },
    }),
    metadata: Object.freeze({ name: 'xhttp' }),
  };
}