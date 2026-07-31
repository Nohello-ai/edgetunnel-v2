import { parseDataFlowRoute } from '../admission/service.js';

const CONTROL_PATHS = ['/login', '/logout', '/admin', '/sub'];

export function classifyRequest(request) {
  const url = new URL(request.url);

  if (url.pathname.startsWith('/api/') || CONTROL_PATHS.includes(url.pathname)) {
    return { kind: 'api', url };
  }

  const dataFlow = parseDataFlowRoute(url);
  if (dataFlow && matchesTransport(request, dataFlow.transport)) {
    return { kind: 'data-flow', url, dataFlow };
  }

  if (url.pathname === '/version' && request.method === 'GET') {
    return { kind: 'version', url };
  }

  return { kind: 'status', url };
}

function matchesTransport(request, transport) {
  const contentType = request.headers.get('content-type')?.toLowerCase() || '';
  const upgrade = request.headers.get('upgrade')?.toLowerCase() || '';

  if (transport === 'websocket') return request.method === 'GET' && upgrade === 'websocket';
  if (transport === 'grpc') return request.method === 'POST' && contentType.startsWith('application/grpc');
  if (transport === 'xhttp') {
    return request.method === 'POST'
      && (contentType.startsWith('application/x-http') || contentType.startsWith('application/octet-stream'));
  }
  return false;
}
