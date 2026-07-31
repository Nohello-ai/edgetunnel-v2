import { openGrpcTransport } from './grpc.js';
import { openWebSocketTransport } from './websocket.js';
import { openXhttpTransport } from './xhttp.js';

const FACTORIES = Object.freeze({ websocket: openWebSocketTransport, grpc: openGrpcTransport, xhttp: openXhttpTransport });

export function openTransport(name, request, limits, runtime) {
  const factory = FACTORIES[name];
  if (!factory) throw new TypeError(`unsupported transport: ${name}`);
  return factory(request, limits, runtime);
}
