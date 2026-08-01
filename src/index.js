import { createAdmissionDependencies } from './admission/repositories.js';
import { createAdmissionService } from './admission/service.js';
import { createApiRouter } from './api-v2/router.js';
import { bootstrapAdmin } from './auth/bootstrap.js';
import { createSessionService } from './auth/session.js';
import { createDirectConnector } from './connector/direct.js';
import { createFallbackConnector } from './connector/chain.js';
import { getGlobalConfig } from './config/loader.js';
import { normalizeGlobalConfig } from './config/schema.js';
import { asAppError } from './core/errors.js';
import { startDataFlowPipeline } from './proxy/pipeline.js';
import { classifyRequest } from './routes/router.js';
import { QuotaDO } from './usage/quota-do.js';
import { createUserRepository } from './users/repository.js';
import { jsonResponse, textResponse } from './utils/http.js';

const VERSION = typeof __EDGETUNNEL_VERSION__ === 'string' ? __EDGETUNNEL_VERSION__ : '3.0.0';

export default {
  async fetch(request, env, ctx) {
    if (!env?.DB) return jsonResponse({ ok: false, error: 'DB_BINDING_REQUIRED' }, 500);

    try {
      // 从 R2 提供静态文件（管理面板）
      if (env.ADMIN_BUCKET) {
        const url = new URL(request.url);
        const path = url.pathname === '/' ? '/index.html' : url.pathname;
        const apiPaths = ['/api/', '/logout', '/sub', '/version'];
        if (!apiPaths.some(p => path.startsWith(p))) {
          const key = path.replace(/^\//, '');
          const obj = await env.ADMIN_BUCKET.get(key).catch(() => null);
          if (obj) {
            const headers = new Headers();
            headers.set('content-type', contentType(key) || 'application/octet-stream');
            headers.set('cache-control', 'public, max-age=3600');
            return new Response(obj.body, { headers });
          }
        }
      }

      const users = createUserRepository(env);
      const route = classifyRequest(request);

      if (route.kind === 'api') {
        // 仅控制面需要引导管理员，数据面热路径不做这次 D1 查询
        await bootstrapAdmin(env, users);
        const sessions = createSessionService(env, users);
        return createApiRouter({ users, sessions })(request, env);
      }

      if (route.kind === 'data-flow') {
        const dependencies = createAdmissionDependencies(env);
        const session = await createAdmissionService(dependencies).admit(route.dataFlow);
        const directConnect = createDirectConnector(request.fetcher?.connect?.bind(request.fetcher));
        const config = normalizeGlobalConfig(await getGlobalConfig(env));
        const connector = config.反代?.模式
          ? createFallbackConnector(directConnect, config.反代)
          : directConnect;
        return startDataFlowPipeline({
          request,
          session,
          connector,
          quotaDO: env.QUOTA_DO || null,
          ctx,
          runtime: config,
        });
      }

      if (route.kind === 'version') {
        return jsonResponse({ name: 'edgetunnel-core', version: VERSION });
      }

      return textResponse(`edgetunnel core ${VERSION} is running`);
    } catch (error) {
      const appError = asAppError(error);
      return jsonResponse({ ok: false, error: appError.code, message: appError.message }, appError.status);
    }
  },
};

function contentType(key) {
  if (key.endsWith('.html')) return 'text/html; charset=utf-8';
  if (key.endsWith('.js')) return 'application/javascript';
  if (key.endsWith('.css')) return 'text/css';
  if (key.endsWith('.json')) return 'application/json';
  if (key.endsWith('.png')) return 'image/png';
  if (key.endsWith('.jpg') || key.endsWith('.jpeg')) return 'image/jpeg';
  if (key.endsWith('.svg')) return 'image/svg+xml';
  if (key.endsWith('.ico')) return 'image/x-icon';
  if (key.endsWith('.woff2')) return 'font/woff2';
  if (key.endsWith('.txt')) return 'text/plain; charset=utf-8';
  return null;
}

export { QuotaDO };
