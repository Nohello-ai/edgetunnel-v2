/**
 * 传输层 Worker — 代理隧道 + 流量计量。
 *
 * 改造后：
 *   - 不绑定 D1（所有数据库操作集中在管理层）
 *   - 通过 USER_ADMIN Service Binding 做准入决策
 *   - 流量本地累计，每 5MB 通过 Service Binding 上报管理层
 *   - DO 仅用于 stopVersion 标志管理（不跨 Worker 绑定）
 *
 * 职责：
 *   - 解析 VLESS/Trojan 协议首包
 *   - WebSocket/gRPC/XHTTP 传输层
 *   - Cloudflare Sockets 直连 / 反代降级
 *   - 5MB 攒批上报 + 256KB stop 标志检查
 *
 * 路由：
 *   /ws/{userID}/{protocol}[/{suffix}]
 *   /grpc/{userID}/{protocol}[/{suffix}]
 *   /xhttp/{userID}/{protocol}[/{suffix}]
 *   /version
 *   /internal/stop        （管理层 → 传输层，Service Binding）
 *   /internal/update-quota（管理层 → 传输层，Service Binding）
 *
 * Bindings：
 *   KV         — KV（只读：全局传输配置）
 *   USER_ADMIN — Service Binding（调用管理层：准入/上报）
 *   QUOTA_DO   — Durable Object（stopVersion 标志管理，自己拥有）
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
    if (!env?.USER_ADMIN) return jsonResponse({ ok: false, error: 'USER_ADMIN_BINDING_REQUIRED' }, 500);

    try {
      const url = new URL(request.url);

      // 版本探测
      if (url.pathname === '/version' && request.method === 'GET') {
        return jsonResponse({ name: 'edgetunnel-transmission', version: VERSION });
      }

      // 内部 Service Binding 端点（管理层 → 传输层）
      if (url.pathname === '/internal/stop' && request.method === 'POST') {
        return await handleInternalStop(request, env);
      }
      if (url.pathname === '/internal/update-quota' && request.method === 'POST') {
        return jsonResponse({ ok: true });
      }

      // 数据面：解析代理路由
      const dataFlow = parseDataFlowRoute(url);
      if (!dataFlow || !matchesTransport(request, dataFlow.transport)) {
        return textResponse(`edgetunnel transmission ${VERSION} is running`);
      }

      // 准入控制（通过 Service Binding 调管理层）
      const dependencies = createAdmissionDependencies(env);
      const session = await createAdmissionService(dependencies).admit(dataFlow);

      // 连接器装配(用 request.fetcher.connect,规避 cloudflare:sockets 的风控限制)
      const directConnect = createDirectConnector(request);
      const config = normalizeGlobalConfig(await getGlobalConfig(env));
      const connector = config.反代?.模式
        ? createFallbackConnector(directConnect, config.反代)
        : directConnect;

      // 启动数据流管道
      // 注意:不向 pipeline/transport 传递 runtime——此前把 config 误传为 runtime,
      // 导致 websocket.js 里 WebSocketPair 为 undefined,WS 节点握手一律 501。
      return startDataFlowPipeline({
        request,
        session,
        connector,
        quotaDO: env.QUOTA_DO || null,
        userAdmin: env.USER_ADMIN || null,
        ctx,
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

// 管理层 → 传输层：停止用户所有活跃连接
async function handleInternalStop(request, env) {
  const body = await request.json().catch(() => ({}));
  const userId = body.userId;
  if (!userId || !env.QUOTA_DO) return jsonResponse({ ok: false, error: 'INVALID_REQUEST' }, 400);
  try {
    const id = env.QUOTA_DO.idFromName(userId);
    const stub = env.QUOTA_DO.get(id);
    await stub.fetch('https://do/stop', { method: 'POST' });
    return jsonResponse({ ok: true });
  } catch {
    return jsonResponse({ ok: false, error: 'DO_UNAVAILABLE' }, 500);
  }
}

export { QuotaDO };
