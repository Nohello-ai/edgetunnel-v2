import { getGlobalConfig } from './loader.js';
import { normalizeGlobalConfig } from './schema.js';

export function createRuntimeConfigService(env) {
  return {
    async getRuntime() {
      return normalizeGlobalConfig(await getGlobalConfig(env));
    },
  };
}
