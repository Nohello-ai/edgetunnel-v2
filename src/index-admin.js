/**
 * 用户管理层 Worker — API + 认证 + 配置 + 订阅生成。
 *
 * 职责：
 *   - 用户注册/登录/注销
 *   - 用户管理（CRUD、封禁、配额）
 *   - 全局配置读写
 *   - 订阅链接生成
 *   - R2 静态资源托管（管理面板）
 *   - DO 配额同步（创建/更新/封禁时）
 *
 * 路由：
 *   /api/auth/*
 *   /api/admin/*
 *   /api/users/*
 *   /sub
 *   /logout
 *   /version
 *   /（R2 静态资源）
 *
 * Bindings：
 *   DB       — D1（用户/会话/封禁/用量/配置）
 *   KV       — KV（global_config、usage 展示）
 *   ADMIN_BUCKET — R2（管理面板静态文件，可选）
 *   QUOTA_DO — Durable Object（配额同步/快照）
 */

import { createApiRouter } from './api-v2/router.js';
import { bootstrapAdmin } from './auth/bootstrap.js';
import { createSessionService } from './auth/session.js';
import { asAppError } from './core/errors.js';
import { createUserRepository } from './users/repository.js';
import { jsonResponse, textResponse } from './utils/http.js';
import { handleOptions, withCorsHeaders } from './utils/cors.js';

const VERSION = typeof __EDGETUNNEL_VERSION__ === 'string' ? __EDGETUNNEL_VERSION__ : '3.0.0';

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

      // 从 R2 提供静态文件（管理面板）
      if (env.ADMIN_BUCKET) {
        const path = url.pathname === '/' ? '/index.html' : url.pathname;
        const apiPaths = ['/api/', '/logout', '/sub', '/version'];
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
