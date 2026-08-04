import { connect } from 'cloudflare:sockets';

export function createDirectConnector(connectImpl = connect) {
  console.log(`[connector] createDirectConnector: connectImpl=${typeof connectImpl}`);
  return {
    connect(target) {
      console.log(`[connector] connect: hostname=${target.hostname} port=${target.port}`);
      try {
        const socket = connectImpl({ hostname: target.hostname, port: target.port });
        console.log(`[connector] connect result: ${typeof socket} opened=${!!socket.opened} closed=${!!socket.closed}`);
        return socket;
      } catch (err) {
        console.error(`[connector] connect error: ${err.constructor?.name} ${err.message}`);
        throw err;
      }
    },
  };
}
