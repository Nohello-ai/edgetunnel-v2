import { AppError } from '../core/errors.js';

export function openXhttpTransport(request) {
  const type = request.headers.get('content-type')?.toLowerCase() || '';
  if (request.method !== 'POST' || (!type.startsWith('application/x-http') && !type.startsWith('application/octet-stream'))) {
    throw new AppError('INVALID_XHTTP_REQUEST', 400);
  }
  if (!request.body) throw new AppError('XHTTP_BODY_REQUIRED', 400);
  if (type.startsWith('application/x-http') && request.headers.get('x-http-mode') && request.headers.get('x-http-mode') !== 'stream-one') {
    throw new AppError('XHTTP_MODE_UNSUPPORTED', 400);
  }

  const responseStream = new TransformStream();
  const writer = responseStream.writable.getWriter();
  let closed = false;
  return {
    readable: request.body,
    async write(chunk) {
      if (!closed) await writer.write(chunk);
    },
    async close(reason) {
      if (closed) return;
      closed = true;
      if (reason) await writer.abort(reason).catch(() => {});
      else await writer.close().catch(() => {});
    },
    response: new Response(responseStream.readable, {
      headers: { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' },
    }),
    metadata: Object.freeze({ name: 'xhttp' }),
  };
}
