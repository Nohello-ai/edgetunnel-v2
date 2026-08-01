import { AppError } from '../core/errors.js';

export function createGovernanceService(env) {
  return {
    async ban(userID, input = {}) {
      const reason = String(input.reason || '');
      const until = input.until ? parseUntil(input.until) : null;
      const createdAt = new Date().toISOString();
      await env.DB.prepare(`INSERT INTO bans (user_id,reason,until,created_at) VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET reason=excluded.reason,until=excluded.until,created_at=excluded.created_at`)
        .bind(userID, reason, until, createdAt).run();
      return { userID, reason, until, createdAt };
    },
    async unban(userID) {
      await env.DB.prepare('DELETE FROM bans WHERE user_id = ?').bind(userID).run();
    },
    async getBan(userID) {
      return env.DB.prepare('SELECT user_id AS userID,reason,until,created_at AS createdAt FROM bans WHERE user_id = ?').bind(userID).first();
    },
  };
}

function parseUntil(value) {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) throw new AppError('BAN_UNTIL_INVALID', 400, '封禁截止时间格式无效');
  return new Date(timestamp).toISOString();
}

export function validateBanTarget(user) {
  if (!user) throw new AppError('USER_NOT_FOUND', 404);
  return user;
}
