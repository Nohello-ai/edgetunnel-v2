import { hashPassword } from '../auth/password.js';
import { AppError } from '../core/errors.js';
import { normalizeUsername } from '../utils/crypto.js';
import { publicUser } from './repository.js';

export function createUserService(repository, env) {
  return {
    async create(input) {
      const username = normalizeUsername(input.username);
      if (!/^[a-z0-9_.-]{3,64}$/.test(username)) throw new AppError('USERNAME_INVALID', 400);
      const now = new Date().toISOString();
      const user = {
        userID: crypto.randomUUID(), username, passwordHash: await hashPassword(input.password),
        role: input.role === 'admin' ? 'admin' : 'user', disabled: false,
        quotaBytes: validQuota(input.quotaBytes), trojanSecret: randomToken(32), settings: input.settings || {},
        createdAt: now, updatedAt: now,
      };
      if (await repository.getByUsername(username)) throw new AppError('USERNAME_TAKEN', 409, '用户名已存在');
      try {
        await repository.create(user);
      } catch (error) {
        if (/UNIQUE|constraint/i.test(String(error?.message))) throw new AppError('USERNAME_TAKEN', 409, '用户名已存在');
        throw error;
      }
      // 同步初始配额到 DO(DO 冷启动时会从 D1 兜底,这里主动推送避免首次请求延迟)
      await syncQuotaToDO(env, user.userID, user.quotaBytes);
      return publicUser(user);
    },
    async update(userID, fields, actor) {
      if (actor?.role !== 'admin') throw new AppError('ADMIN_REQUIRED', 403);
      const allowed = {};
      if ('disabled' in fields) allowed.disabled = Boolean(fields.disabled);
      if ('quotaBytes' in fields) allowed.quotaBytes = validQuota(fields.quotaBytes);
      if ('role' in fields) allowed.role = fields.role === 'admin' ? 'admin' : 'user';
      if ('settings' in fields) allowed.settings = fields.settings && typeof fields.settings === 'object' ? fields.settings : {};
      if (fields.password) allowed.passwordHash = await hashPassword(fields.password);
      const current = await repository.getByID(userID);
      if (!current) throw new AppError('USER_NOT_FOUND', 404);
      if (actor?.userID === userID && (allowed.role === 'user' || allowed.disabled)) throw new AppError('SELF_LOCKOUT', 400);
      if (current.role === 'admin' && (allowed.role === 'user' || allowed.disabled) && await repository.countAdmins() <= 1) {
        throw new AppError('LAST_ADMIN_REQUIRED', 400);
      }
      const user = await repository.update(userID, allowed);
      if (!user) throw new AppError('USER_NOT_FOUND', 404);
      if ('disabled' in allowed || 'role' in allowed || 'passwordHash' in allowed) await repository.revokeSessions(userID);
      // 配额变更 → 同步到 DO(续费/调整额度)
      if ('quotaBytes' in allowed) await syncQuotaToDO(env, userID, allowed.quotaBytes);
      // 禁用用户 → 递增 resetVersion,活跃连接下次上报时被拒(2-3秒内断干净)
      if (allowed.disabled === true) await resetUuidInDO(env, userID);
      return publicUser(user);
    },
    async get(userID) { return publicUser(await repository.getByID(userID)); },
    async list() { return Promise.all((await repository.list()).map(publicUser)); },
    async delete(userID, actor) {
      if (actor?.role !== 'admin') throw new AppError('ADMIN_REQUIRED', 403);
      if (actor?.userID === userID) throw new AppError('SELF_DELETE_FORBIDDEN', 400);
      const user = await repository.getByID(userID);
      if (user?.role === 'admin' && await repository.countAdmins() <= 1) throw new AppError('LAST_ADMIN_REQUIRED', 400);
      await repository.delete(userID);
    },
  };
}

function validQuota(value) {
  if (value === undefined || value === null || value === '') return 0;
  const quota = Number(value);
  if (!Number.isSafeInteger(quota) || quota < 0) throw new AppError('QUOTA_INVALID', 400);
  return quota;
}
function randomToken(bytes) { const data = crypto.getRandomValues(new Uint8Array(bytes)); return [...data].map((v) => v.toString(16).padStart(2, '0')).join(''); }

// ── DO 同步 helpers(非致命:DO 不可用时静默降级,冷启动会从 D1 兜底) ──

async function syncQuotaToDO(env, userID, quota) {
  if (!env?.QUOTA_DO) return;
  try {
    const id = env.QUOTA_DO.idFromName(userID);
    const stub = env.QUOTA_DO.get(id);
    await stub.fetch('https://do/set-quota', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ quota }),
    });
  } catch { /* DO 不可用,D1 已更新,DO 冷启动时会兜底 */ }
}

async function resetUuidInDO(env, userID) {
  if (!env?.QUOTA_DO) return;
  try {
    const id = env.QUOTA_DO.idFromName(userID);
    const stub = env.QUOTA_DO.get(id);
    await stub.fetch('https://do/reset-uuid', { method: 'POST' });
  } catch { /* 同上 */ }
}
