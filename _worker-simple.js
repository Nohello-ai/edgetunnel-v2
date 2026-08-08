export class QuotaDO {
  async fetch() { return new Response('ok'); }
}
export default {
  async fetch(request) {
    const u = new URL(request.url);
    if (u.pathname.includes('/__raw101/')) {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      server.accept();
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response('simple-ok', { status: 200 });
  },
};
