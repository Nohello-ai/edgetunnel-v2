import { openGrpcTransport } from './grpc.js';
import { openWebSocketTransport } from './websocket.js';
import { openXhttpTransport } from './xhttp.js';
import { AppError } from '../core/errors.js';

const FACTORIES = Object.freeze({ websocket: openWebSocketTransport, grpc: openGrpcTransport, xhttp: openXhttpTransport });

export function openTransport(name, request, limits, runtime) {
  const factory = FACTORIES[name];
  if (!factory) throw new AppError('UNSUPPORTED_TRANSPORT', 501, `unsupported transport: ${name}`);
  try {
    return factory(request, limits, runtime);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('TRANSPORT_OPEN_FAILED', 500, `failed to open ${name} transport: ${err.message}`);
  }
}
