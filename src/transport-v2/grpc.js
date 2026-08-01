import { AppError } from '../core/errors.js';
import { createGrpcFrameParser, decodeGrpcHunk, encodeGrpcFrame, encodeGrpcHunk } from './grpc-frame.js';

const VALID_GRPC_TYPES = ['application/grpc', 'application/grpc+proto'];

export function openGrpcTransport(request, limits) {
  const type = request.headers.get('content-type')?.toLowerCase() || '';
  if (request.method !== 'POST' || !VALID_GRPC_TYPES.some(t => type === t || type.startsWith(t + ';'))) {
    throw new AppError('INVALID_GRPC_REQUEST', 400);
  }
  if (!request.body) throw new AppError('GRPC_BODY_REQUIRED', 400);

  const parser = createGrpcFrameParser(limits);
  const source = request.body.getReader();
  const readable = new ReadableStream({
    async pull(controller) {
      let iterations = 0;
      while (iterations++ < 100) {
        const { done, value } = await source.read();
        if (done) { controller.close(); return; }
        try {
          const { messages } = parser.push(value);
          if (messages.length === 0) return;
          for (const message of messages) controller.enqueue(decodeGrpcHunk(message));
          return;
        } catch (err) {
          controller.error(err);
          return;
        }
      }
      controller.error(new AppError('GRPC_SPIN_LIMIT', 400, 'gRPC frame parser exceeded iteration limit'));
    },
    cancel(reason) { return source.cancel(reason); },
  });
  const responseStream = new TransformStream();
  const writer = responseStream.writable.getWriter();
  let closed = false;
  return {
    readable,
    async write(chunk) {
      if (closed) return;
      try { await writer.write(encodeGrpcFrame(encodeGrpcHunk(chunk))); }
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
      status: 200,
      headers: { 'content-type': 'application/grpc', 'grpc-encoding': 'identity', 'grpc-status': '0', 'cache-control': 'no-store' },
    }),
    metadata: Object.freeze({ name: 'grpc' }),
  };
}