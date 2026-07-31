import { connect } from 'cloudflare:sockets';

export function createDirectConnector(connectImpl = connect) {
  return {
    connect(target) {
      return connectImpl({ hostname: target.hostname, port: target.port });
    },
  };
}
