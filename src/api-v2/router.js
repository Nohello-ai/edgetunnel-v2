import { createAuthService } from '../auth/service.js';
import { createLoginAttemptService } from '../auth/login-attempts.js';
import { requireAdmin, requireUser } from '../auth/guards.js';
import { AppError, asAppError } from '../core/errors.js';
import { publicUser } from '../users/repository.js';
import { createUserService } from '../users/service.js';
import { createGovernanceService, validateBanTarget } from '../users/governance.js';
import { jsonResponse } from '../utils/http.js';
import { getTurnstileSiteKey } from '../utils/turnstile.js';

export function createApiRouter({ users, sessions }) {
  const governance = createGovernanceService;
  return async function handle(request, env) {
    try {
      const userService = createUserService(users, env);
      const url = new URL(request.url);
      const auth = createAuthService(users, sessions, createLoginAttemptService(env));
      const current = await auth.resolve(request);
      // 管理 token:MiSub 等管理端通过 X-Admin-Token 调用 admin API(免 cookie)
      const adminGuard = (currentUser) => {
        const token = env.ADMIN_TOKEN;
        if (token && request.headers.get('x-admin-token') === token) return;
        requireAdmin(currentUser);
      };
      if (url.pathname === '/api/auth/login' && request.method === 'POST') {
        const body = await readBody(request);
        const turnstileToken = body.turnstileToken || request.headers.get('x-turnstile-token') || '';
        const result = await auth.login(body.username, body.password, loginFingerprint(request, body.username), turnstileToken, request);
        return jsonResponse({ ok: true, user: publicUser(result.user) }, 200, { 'set-cookie': result.session.cookie });
      }
      if (url.pathname === '/api/auth/register' && request.method === 'POST') {
        const body = await readBody(request);
        const ip = request.headers.get('cf-connecting-ip') || '';
        const turnstileToken = body.turnstileToken || request.headers.get('x-turnstile-token') || '';
        const loginAttempts = createLoginAttemptService(env);
        await loginAttempts.checkRegister(ip, turnstileToken, request);
        const user = await userService.create({ ...body, role: 'user' });
        await loginAttempts.recordRegister(ip);
        return jsonResponse({ ok: true, user: publicUser(user) }, 201);
      }
      if (url.pathname === '/api/auth/logout' && request.method === 'POST') return jsonResponse({ ok: true }, 200, { 'set-cookie': await auth.logout(request) });
      if (url.pathname === '/api/auth/me' && request.method === 'GET') {
        const u = requireUser(current);
        const usage = await fetchUsage(env, u.userID);
        return jsonResponse({ ok: true, user: { ...publicUser(u), usage } });
      }
      if (url.pathname === '/api/admin/users' && request.method === 'GET') { adminGuard(current); return jsonResponse({ ok: true, users: await userService.listWithUsage() }); }
      if (url.pathname === '/api/admin/users' && request.method === 'POST') { adminGuard(current); return jsonResponse({ ok: true, user: await userService.create(await readBody(request), { role: 'admin' }) }, 201); }
      const match = url.pathname.match(/^\/api\/admin\/users\/([0-9a-f-]+)$/i);
      if (match && request.method === 'GET') { adminGuard(current); const u = await users.getByID(match[1]); if (!u) throw new AppError('USER_NOT_FOUND', 404); const { passwordHash, ...safe } = u; return jsonResponse({ ok: true, user: { ...safe, usage: await fetchUsage(env, match[1]) } }); }
      if (match && request.method === 'PATCH') { adminGuard(current); return jsonResponse({ ok: true, user: await userService.update(match[1], await readBody(request), { role: 'admin' }) }); }
      if (match && request.method === 'DELETE') { adminGuard(current); await userService.delete(match[1], { role: 'admin' }); return jsonResponse({ ok: true }); }
      const banMatch = url.pathname.match(/^\/api\/admin\/users\/([0-9a-f-]+)\/ban$/i);
      if (banMatch && request.method === 'POST') { adminGuard(current); validateBanTarget(await users.getByID(banMatch[1])); return jsonResponse({ ok: true, ban: await governance(env).ban(banMatch[1], await readBody(request)) }); }
      if (banMatch && request.method === 'DELETE') { adminGuard(current); await governance(env).unban(banMatch[1]); return jsonResponse({ ok: true }); }
      throw new AppError('NOT_FOUND', 404);
    } catch (error) {
      const appError = asAppError(error);
      const response = { ok: false, error: appError.code, message: appError.message, ...(appError.details ? { details: appError.details } : {}) };
      if (appError.code === 'REQUIRE_CAPTCHA') {
        response.turnstileSiteKey = getTurnstileSiteKey(env);
      }
      return jsonResponse(response, appError.status);
    }
  };
}

async function readBody(request) { if (!request.headers.get('content-type')?.includes('application/json')) throw new AppError('JSON_REQUIRED', 415); try { return await request.json(); } catch { throw new AppError('INVALID_JSON', 400); } }

// 从 D1 查询用量（流量每 5MB 上报一次，可能有最多 5MB 的延迟）
async function fetchUsage(env, userID) {
  const row = await env.DB?.prepare('SELECT upload,download,total FROM usage WHERE user_id = ?').bind(userID).first();
  const quotaRow = await env.DB?.prepare('SELECT quota_bytes FROM users WHERE user_id = ?').bind(userID).first();
  const quotaBytes = Number(quotaRow?.quota_bytes || 0);
  const total = Number(row?.total || 0);
  return {
    upload: Number(row?.upload || 0),
    download: Number(row?.download || 0),
    total,
    quota: quotaBytes,
    remaining: quotaBytes > 0 ? Math.max(0, quotaBytes - total) : 0,
  };
}

function loginFingerprint(request, username) {
  const ip = request.headers.get('cf-connecting-ip') || '';
  const normalized = String(username || '').trim().toLowerCase();
  return { ip, username: normalized };
}
