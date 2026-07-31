import { connect } from 'cloudflare:sockets';

export function createTcpConnector(request) {
  if (typeof request?.fetcher?.connect === 'function') {
    return (target, options) => request.fetcher.connect(target, options);
  }

  return (target, options) => connect(target, options);
}
