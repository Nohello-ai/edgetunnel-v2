import { handleApiRequest } from './api/index.js';
import { handleDataFlowRequest } from './proxy/index.js';
import { isValidUuidV4 } from './utils/crypto.js';
import { jsonResponse, textResponse } from './utils/http.js';

export default {
  async fetch(request, env, ctx) {
    if (!isValidRuntimeEnv(env)) {
      return jsonResponse({
        ok: false,
        error: 'INVALID_ENV',
        message: 'ID must be a UUID v4 and DB binding is required',
      }, 500);
    }

    const url = new URL(request.url);

    if (isApiRequest(url, request)) {
      return handleApiRequest(request, env, ctx);
    }

    if (isDataFlowRequest(request)) {
      return handleDataFlowRequest(request, env, ctx);
    }

    return textResponse('edgetunnel core is running', 200);
  },
};

function isValidRuntimeEnv(env) {
  return Boolean(env?.DB) && isValidUuidV4(env?.ID);
}

function isApiRequest(url, request) {
  if (url.pathname.startsWith('/api/')) return true;
  if (url.pathname === '/login') return true;
  if (url.pathname === '/admin') return true;
  if (url.pathname === '/sub') return true;
  if (request.headers.get('accept')?.includes('application/json')) return true;
  return false;
}

function isDataFlowRequest(request) {
  const upgrade = request.headers.get('upgrade') || '';
  const contentType = request.headers.get('content-type') || '';

  if (upgrade.toLowerCase() === 'websocket') return true;
  if (contentType.includes('application/grpc')) return true;
  if (contentType.includes('application/x-http')) return true;
  if (request.method === 'POST' && request.body) return true;

  return false;
}
