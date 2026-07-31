import { jsonResponse } from '../utils/http.js';
import { handleGrpcRequest } from '../transport/grpc.js';
import { handleWebSocketRequest } from '../transport/ws.js';
import { handleXhttpRequest } from '../transport/xhttp.js';

export async function handleDataFlowRequest(request, env, ctx) {
  if (isWebSocketRequest(request)) {
    return handleWebSocketRequest(request, env, ctx);
  }

  if (isGrpcRequest(request)) {
    return handleGrpcRequest(request, env, ctx);
  }

  if (isXhttpRequest(request)) {
    return handleXhttpRequest(request, env, ctx);
  }

  return jsonResponse({
    ok: false,
    error: 'DATA_FLOW_NOT_IMPLEMENTED',
    message: 'only xhttp tcp forwarding is wired',
  }, 501);
}

function isXhttpRequest(request) {
  const contentType = request.headers.get('content-type') || '';
  return request.method === 'POST' && !contentType.includes('application/grpc');
}

function isWebSocketRequest(request) {
  const upgrade = request.headers.get('upgrade') || '';
  return upgrade.toLowerCase() === 'websocket';
}

function isGrpcRequest(request) {
  const contentType = request.headers.get('content-type') || '';
  return request.method === 'POST' && contentType.includes('application/grpc');
}
