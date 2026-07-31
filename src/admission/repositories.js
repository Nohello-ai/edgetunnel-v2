import { createRuntimeConfigService } from '../config/runtime.js';
import { createUsageRepository } from '../usage/repository.js';
import { createUserRepository } from '../users/repository.js';

export function createAdmissionDependencies(env) {
  return {
    users: createUserRepository(env),
    bans: {
      async getActive(userID) {
        const row = await env.DB.prepare('SELECT * FROM bans WHERE user_id = ?').bind(userID).first();
        if (!row) return null;
        if (!row.until || Number.isNaN(Date.parse(row.until)) || Date.parse(row.until) > Date.now()) return row;
        return null;
      },
    },
    usage: createUsageRepository(env),
    config: createRuntimeConfigService(env),
  };
}
