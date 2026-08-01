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
import { createUsageRepository } from './usage/repository.js';
import { createUserRepository } from './users/repository.js';
import { jsonResponse, textResponse } from './utils/http.js';

const VERSION = typeof __EDGETUNNEL_VERSION__ === 'string' ? __EDGETUNNEL_VERSION__ : '3.0.0';

export default {
  async fetch(request, env, ctx) {
    if (!env?.DB) return jsonResponse({ ok: false, error: 'DB_BINDING_REQUIRED' }, 500);

    try {
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
          usageRepository: createUsageRepository(env),
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
