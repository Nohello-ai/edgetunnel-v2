import { AppError } from '../core/errors.js';
import { createGrpcFrameParser, decodeGrpcHunk, encodeGrpcFrame, encodeGrpcHunk } from './grpc-frame.js';

export function openGrpcTransport(request, limits) {
  const type = request.headers.get('content-type')?.toLowerCase() || '';
  if (request.method !== 'POST' || !type.startsWith('application/grpc')) {
    throw new AppError('INVALID_GRPC_REQUEST', 400);
  }
  if (!request.body) throw new AppError('GRPC_BODY_REQUIRED', 400);

  const parser = createGrpcFrameParser(limits);
  const source = request.body.getReader();
  const readable = new ReadableStream({
    async pull(controller) {
      while (true) {
        const { done, value } = await source.read();
        if (done) { controller.close(); return; }
        const { messages } = parser.push(value);
        if (messages.length === 0) continue;
        for (const message of messages) controller.enqueue(decodeGrpcHunk(message));
        return;
      }
    },
    cancel(reason) { return source.cancel(reason); },
  });
  const responseStream = new TransformStream();
  const writer = responseStream.writable.getWriter();
  let closed = false;
  return {
    readable,
    async write(chunk) { if (!closed) await writer.write(encodeGrpcFrame(encodeGrpcHunk(chunk))); },
    async close(reason) {
      if (closed) return;
      closed = true;
      if (reason) await writer.abort(reason).catch(() => {});
      else await writer.close().catch(() => {});
    },
    response: new Response(responseStream.readable, {
      status: 200,
      headers: { 'content-type': 'application/grpc', 'grpc-encoding': 'identity', 'grpc-status': '0', 'cache-control': 'no-store' },
    }),
    metadata: Object.freeze({ name: 'grpc' }),
  };
}
