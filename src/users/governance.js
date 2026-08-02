import { AppError } from '../core/errors.js';

export function createGovernanceService(env) {
  return {
    async ban(userID, input = {}) {
      const reason = String(input.reason || '');
      const until = input.until ? parseUntil(input.until) : null;
      const createdAt = new Date().toISOString();
      await env.DB.prepare(`INSERT INTO bans (user_id,reason,until,created_at) VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET reason=excluded.reason,until=excluded.until,created_at=excluded.created_at`)
        .bind(userID, reason, until, createdAt).run();
      // 递增 resetVersion → 活跃连接下次上报时被拒(2-3秒内断干净)
      // fire-and-forget：D1 已写入是真相源，传输层通知 best-effort（失败时 admit 层仍会拦新连接）
      void resetUuidInDO(env, userID);
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
  const maxDate = new Date();
  maxDate.setFullYear(maxDate.getFullYear() + 10);
  if (timestamp > maxDate.getTime()) throw new AppError('BAN_UNTIL_TOO_FAR', 400, '封禁截止时间不能超过 10 年');
  return new Date(timestamp).toISOString();
}

// 封禁时通知传输层停止用户所有活跃连接（通过 TRANSMISSION Service Binding，非致命：admission 层也会拦新连接）
async function resetUuidInDO(env, userID) {
  if (!env?.TRANSMISSION) return;
  try {
    await env.TRANSMISSION.fetch('https://transmission/internal/stop', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: userID }),
    });
  } catch { /* 传输层不可用，admission 层的 ban 检查仍生效 */ }
}

export function validateBanTarget(user) {
  if (!user) throw new AppError('USER_NOT_FOUND', 404);
  return user;
}
