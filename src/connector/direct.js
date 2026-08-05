/**
 * 直连连接器。
 *
 * 使用 request.fetcher.connect()(Cloudflare 入站请求级 TCP socket API)。
 * 注意:不要用 `import { connect } from 'cloudflare:sockets'`——该 API 在本账号
 * 被 Cloudflare 风控限制(实测 connect() 一律失败,而 fetch() 正常),而
 * request.fetcher.connect() 走不同路径,不受影响(edgetunnel-v3 生产验证可用)。
 */
export function createDirectConnector(request) {
  const fetcher = request?.fetcher;
  if (!fetcher || typeof fetcher.connect !== 'function') {
    throw new Error('request.fetcher.connect unavailable');
  }
  return {
    connect(target) {
      return fetcher.connect({ hostname: target.hostname, port: target.port });
    },
  };
}
