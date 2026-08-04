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
      console.log(`[1] fetch entry: method=${request.method} path=${url.pathname} upgrade=${request.headers.get('upgrade')}`);

      // 调试端点
      if (url.pathname === '/debug' && request.method === 'GET') {
        const headers = {};
        for (const [k, v] of request.headers) headers[k] = v;
        return jsonResponse({ path: url.pathname, method: request.method, headers, cfColo: request.cf?.colo || '' });
      }

      // 版本探测
      if (url.pathname === '/version' && request.method === 'GET') {
        console.log('[2] version endpoint hit');
        return jsonResponse({ name: 'edgetunnel-transmission', version: VERSION });
      }

      // 内部 Service Binding 端点（管理层 → 传输层）
      if (url.pathname === '/internal/stop' && request.method === 'POST') {
        console.log('[2] internal/stop endpoint hit');
        return await handleInternalStop(request, env);
      }
      if (url.pathname === '/internal/update-quota' && request.method === 'POST') {
        console.log('[2] internal/update-quota endpoint hit');
        return jsonResponse({ ok: true });
      }

      // 数据面：解析代理路由
      console.log('[3] parsing data flow route...');
      const dataFlow = parseDataFlowRoute(url);
      console.log(`[3] parseDataFlowRoute result: ${dataFlow ? JSON.stringify(dataFlow) : 'null'}`);
      if (!dataFlow || !matchesTransport(request, dataFlow.transport)) {
        console.log('[3] route not matched, returning text response');
        return textResponse(`edgetunnel transmission ${VERSION} is running`);
      }

      // 准入控制（通过 Service Binding 调管理层）
      console.log('[4] creating admission dependencies...');
      const dependencies = createAdmissionDependencies(env);
      console.log(`[4] dependencies: userAdmin=${!!dependencies.userAdmin} quotaDO=${!!dependencies.quotaDO} config=${!!dependencies.config}`);
      console.log('[5] calling admit()...');
      const session = await createAdmissionService(dependencies).admit(dataFlow);
      console.log(`[5] admit() succeeded: userID=${session.userID} transport=${session.transport} quotaBytes=${session.quotaBytes}`);

      // 连接器装配
      console.log('[6] assembling connector...');
      const hasFetcher = !!request.fetcher;
      console.log(`[6] request.fetcher available: ${hasFetcher}`);
      const directConnect = createDirectConnector(request.fetcher?.connect?.bind(request.fetcher));
      console.log('[6] loading global config from KV...');
      const config = normalizeGlobalConfig(await getGlobalConfig(env));
      console.log(`[6] global config loaded: transport=${config.transport} protocol=${config.protocol} siteName=${config.siteName}`);
      const hasProxy = config.反代?.模式;
      console.log(`[6] proxy mode: ${hasProxy ? config.反代.模式 : 'none'}`);
      const connector = hasProxy
        ? createFallbackConnector(directConnect, config.反代, { colo: request.cf?.colo || '' })
        : directConnect;
      console.log('[6] connector ready');

      // 启动数据流管道
      console.log('[7] starting data flow pipeline...');
      const result = startDataFlowPipeline({
        request,
        session,
        connector,
        quotaDO: env.QUOTA_DO || null,
        userAdmin: env.USER_ADMIN || null,
        ctx,
        runtime: globalThis,
      });
      console.log('[7] pipeline started, returning response');
      return result;
    } catch (error) {
      console.error(`[ERR] caught at fetch handler: ${error.constructor?.name || typeof error} code=${error.code} message=${error.message}`);
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
