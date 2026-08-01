/**
 * 传输层 Worker — 代理隧道 + 强一致流量计量。
 *
 * 职责：
 *   - 解析 VLESS/Trojan 协议首包
 *   - WebSocket/gRPC/XHTTP 传输层
 *   - Cloudflare Sockets 直连 / 反代降级
 *   - QuotaDO 实时配额裁判与断连
 *
 * 路由：
 *   /ws/{userID}/{protocol}[/{suffix}]
 *   /grpc/{userID}/{protocol}[/{suffix}]
 *   /xhttp/{userID}/{protocol}[/{suffix}]
 *   /version
 *
 * Bindings：
 *   DB       — D1（只读：用户查询、封禁查询）
 *   KV       — KV（只读：全局配置）
 *   QUOTA_DO — Durable Object（强一致流量计量）
 */

import { createAdmissionDependencies } from './admission/repositories.js';
import { createAdmissionService } from './admission/service.js';
import { createDirectConnector } from './connector/direct.js';
import { createFallbackConnector } from './connector/chain.js';
import { getGlobalConfig } from './config/loader.js';
import { normalizeGlobalConfig } from './config/schema.js';
import { asAppError } from './core/errors.js';
import { startDataFlowPipeline } from './proxy/pipeline.js';
import { parseDataFlowRoute } from './admission/service.js';
import { QuotaDO } from './usage/quota-do.js';
import { jsonResponse, textResponse } from './utils/http.js';

const VERSION = typeof __EDGETUNNEL_VERSION__ === 'string' ? __EDGETUNNEL_VERSION__ : '3.0.0';

export default {
  async fetch(request, env, ctx) {
    if (!env?.DB) return jsonResponse({ ok: false, error: 'DB_BINDING_REQUIRED' }, 500);

    try {
      const url = new URL(request.url);

      // 版本探测
      if (url.pathname === '/version' && request.method === 'GET') {
        return jsonResponse({ name: 'edgetunnel-transmission', version: VERSION });
      }

      // 数据面：解析代理路由
      const dataFlow = parseDataFlowRoute(url);
      if (!dataFlow || !matchesTransport(request, dataFlow.transport)) {
        return textResponse(`edgetunnel transmission ${VERSION} is running`);
      }

      // 准入控制
      const dependencies = createAdmissionDependencies(env);
      const session = await createAdmissionService(dependencies).admit(dataFlow);

      // 连接器装配
      const directConnect = createDirectConnector(request.fetcher?.connect?.bind(request.fetcher));
      const config = normalizeGlobalConfig(await getGlobalConfig(env));
      const connector = config.反代?.模式
        ? createFallbackConnector(directConnect, config.反代)
        : directConnect;

      // 启动数据流管道
      return startDataFlowPipeline({
        request,
        session,
        connector,
        quotaDO: env.QUOTA_DO || null,
        ctx,
        runtime: config,
      });
    } catch (error) {
      const appError = asAppError(error);
      return jsonResponse({ ok: false, error: appError.code, message: appError.message }, appError.status);
    }
  },
};

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

export { QuotaDO };
