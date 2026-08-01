import { hashPassword } from '../auth/password.js';
import { AppError } from '../core/errors.js';
import { normalizeUsername } from '../utils/crypto.js';
import { publicUser } from './repository.js';

export function createUserService(repository) {
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
      return publicUser(user);
    },
    async update(userID, fields, actor) {
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
      return publicUser(user);
    },
    async get(userID) { return publicUser(await repository.getByID(userID)); },
    async list() { return Promise.all((await repository.list()).map(publicUser)); },
    async delete(userID, actor) {
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
