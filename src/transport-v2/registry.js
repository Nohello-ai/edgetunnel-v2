import { openGrpcTransport } from './grpc.js';
import { openWebSocketTransport } from './websocket.js';
import { openXhttpTransport } from './xhttp.js';
import { AppError } from '../core/errors.js';

const FACTORIES = Object.freeze({
  websocket: openWebSocketTransport,
  grpc: openGrpcTransport,
  xhttp: openXhttpTransport,
});

/**
 * 打开传输层。
 *
 * 注意:这里不再接收/传递 runtime 参数——WebSocket 传输默认从全局环境取
 * WebSocketPair/Response。此前调用链把配置对象(config)误当作 runtime 传入,
 * 导致 websocket.js 里 `runtime.WebSocketPair` 为 undefined,所有 WS 节点
 * 握手一律返回 501 WEBSOCKET_UNAVAILABLE。移除该参数后从根源上杜绝此问题。
 */
export function openTransport(name, request, limits) {
  const factory = FACTORIES[name];
  if (!factory) throw new AppError('UNSUPPORTED_TRANSPORT', 501, `unsupported transport: ${name}`);
  try {
    return factory(request, limits);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('TRANSPORT_OPEN_FAILED', 500, `failed to open ${name} transport: ${err.message}`);
  }
}
