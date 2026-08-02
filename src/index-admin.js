/**
 * 用户管理层 Worker — API + 认证 + 配置 + 订阅生成。
 *
 * 改造后：
 *   - D1 独占（传输层不再共享 D1）
 *   - 新增 /internal/admit 和 /internal/report 端点（传输层 → 管理层，Service Binding）
 *   - R2 静态托管功能已禁用（代码保留，R2_ENABLED = false）
 *   - 不再绑定 QUOTA_DO（通过 TRANSMISSION Service Binding 通知传输层）
 *
 * 职责：
 *   - 用户注册/登录/注销
 *   - 用户管理（CRUD、封禁、配额）
 *   - 全局配置读写
 *   - 订阅链接生成
 *   - 接收传输层流量上报（写 D1 + 查配额 + 返回决策）
 *
 * 路由：
 *   /internal/admit  （传输层 → 管理层，Service Binding）
 *   /internal/report （传输层 → 管理层，Service Binding）
 *   /api/auth/*
 *   /api/admin/*
 *   /api/users/*
 *   /sub
 *   /logout
 *   /version
 *
 * Bindings：
 *   DB           — D1（用户/会话/封禁/用量/配置）
 *   KV           — KV（全局配置，下发给传输层）
 *   TRANSMISSION — Service Binding（调用传输层：封禁/续费通知）
 *   ADMIN_BUCKET — R2（已禁用，不需要配置）
 */

import { createApiRouter } from './api-v2/router.js';
import { bootstrapAdmin } from './auth/bootstrap.js';
import { createSessionService } from './auth/session.js';
import { asAppError } from './core/errors.js';
import { createUserRepository } from './users/repository.js';
import { createUsageRepository } from './usage/repository.js';
import { jsonResponse, textResponse } from './utils/http.js';
import { handleOptions, withCorsHeaders } from './utils/cors.js';

const VERSION = typeof __EDGETUNNEL_VERSION__ === 'string' ? __EDGETUNNEL_VERSION__ : '3.0.0';
const R2_ENABLED = false; // R2 静态托管功能已禁用

export default {
  async fetch(request, env, ctx) {
    // 跨域预检：未配置允许来源时返回 403
    if (request.method === 'OPTIONS') {
      return handleOptions(request, env) || new Response(null, { status: 403 });
    }

    let response;
    if (!env?.DB) {
      response = jsonResponse({ ok: false, error: 'DB_BINDING_REQUIRED' }, 500);
      return withCorsHeaders(response, request, env);
    }

    try {
      const url = new URL(request.url);

      // 版本探测
      if (url.pathname === '/version' && request.method === 'GET') {
        response = jsonResponse({ name: 'edgetunnel-admin', version: VERSION });
        return withCorsHeaders(response, request, env);
      }

      // 内部 Service Binding 端点（传输层 → 管理层，不需要 CORS）
      if (url.pathname === '/internal/admit' && request.method === 'GET') {
        return await handleInternalAdmit(request, env);
      }
      if (url.pathname === '/internal/report' && request.method === 'POST') {
        return await handleInternalReport(request, env);
      }

      // R2 静态文件托管（已禁用，代码保留）
      if (R2_ENABLED && env.ADMIN_BUCKET) {
        const path = url.pathname === '/' ? '/index.html' : url.pathname;
        const apiPaths = ['/api/', '/logout', '/sub', '/version', '/internal/'];
        if (!apiPaths.some(p => path.startsWith(p))) {
          const key = path.replace(/^\//, '');
          const obj = await env.ADMIN_BUCKET.get(key).catch(() => null);
          if (obj) {
            const headers = new Headers();
            headers.set('content-type', contentType(key) || 'application/octet-stream');
            headers.set('cache-control', 'public, max-age=3600');
            response = new Response(obj.body, { headers });
            return withCorsHeaders(response, request, env);
          }
        }
      }

      // 控制面 API
      const users = createUserRepository(env);
      await bootstrapAdmin(env, users);
      const sessions = createSessionService(env, users);
      response = await createApiRouter({ users, sessions })(request, env);
      return withCorsHeaders(response, request, env);
    } catch (error) {
      const appError = asAppError(error);
      response = jsonResponse({ ok: false, error: appError.code, message: appError.message }, appError.status);
      return withCorsHeaders(response, request, env);
    }
  },
};

// ── 内部 Service Binding 端点（传输层 → 管理层）──────────────────

// 准入决策：查询用户状态 + 配额
async function handleInternalAdmit(request, env) {
  const url = new URL(request.url);
  const userId = url.searchParams.get('userId');
  if (!userId) return jsonResponse({ allowed: false, reason: 'INVALID_REQUEST' }, 400);

  const users = createUserRepository(env);
  const user = await users.getByID(userId);
  if (!user) return jsonResponse({ allowed: false, reason: 'USER_NOT_FOUND' }, 403);
  if (user.disabled) return jsonResponse({ allowed: false, reason: 'USER_DISABLED' }, 403);

  // 检查封禁
  const banRow = await env.DB.prepare('SELECT until FROM bans WHERE user_id = ?').bind(userId).first().catch(() => null);
  if (banRow && (!banRow.until || Date.parse(banRow.until) > Date.now())) {
    return jsonResponse({ allowed: false, reason: 'USER_BANNED' }, 403);
  }

  // 检查配额
  const usageRepo = createUsageRepository(env);
  const usage = await usageRepo.get(userId);
  const quotaBytes = Number(user.quotaBytes || 0);
  const used = Number(usage.total || 0);
  if (quotaBytes > 0 && used >= quotaBytes) {
    return jsonResponse({ allowed: false, reason: 'TRAFFIC_QUOTA_EXHAUSTED' }, 403);
  }

  return jsonResponse({
    allowed: true,
    quotaBytes,
    used,
    user: {
      userID: user.userID,
      username: user.username,
      role: user.role,
      settings: user.settings || {},
      trojanSecret: user.trojanSecret || '',
    },
  });
}

// 流量上报：写 D1 + 查配额 + 返回决策
async function handleInternalReport(request, env) {
  const body = await request.json().catch(() => ({}));
  const userId = body.userId;
  const upload = Number(body.upload || 0);
  const download = Number(body.download || 0);
  if (!userId) return jsonResponse({ allowed: false, reason: 'INVALID_REQUEST' }, 400);

  // 写入 D1
  const usageRepo = createUsageRepository(env);
  await usageRepo.increment(userId, upload, download);

  // 检查用户状态
  const user = await env.DB.prepare('SELECT disabled, quota_bytes FROM users WHERE user_id = ?').bind(userId).first();
  if (!user) return jsonResponse({ allowed: false, reason: 'USER_NOT_FOUND' }, 403);
  if (user.disabled) return jsonResponse({ allowed: false, reason: 'USER_DISABLED' }, 403);

  // 检查封禁
  const banRow = await env.DB.prepare('SELECT until FROM bans WHERE user_id = ?').bind(userId).first().catch(() => null);
  if (banRow && (!banRow.until || Date.parse(banRow.until) > Date.now())) {
    return jsonResponse({ allowed: false, reason: 'USER_BANNED' }, 403);
  }

  // 检查配额
  const quotaBytes = Number(user.quota_bytes || 0);
  if (quotaBytes > 0) {
    const usage = await usageRepo.get(userId);
    if (Number(usage.total || 0) >= quotaBytes) {
      return jsonResponse({ allowed: false, reason: 'TRAFFIC_QUOTA_EXHAUSTED' }, 403);
    }
  }

  return jsonResponse({ allowed: true });
}

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
