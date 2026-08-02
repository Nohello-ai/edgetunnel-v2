import { createRuntimeConfigService } from '../config/runtime.js';

export function createAdmissionDependencies(env) {
  return {
    userAdmin: env.USER_ADMIN || null,
    config: createRuntimeConfigService(env),
    quotaDO: env.QUOTA_DO || null,
  };
}
