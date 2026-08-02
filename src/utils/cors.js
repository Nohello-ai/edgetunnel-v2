/**
 * 跨域 (CORS) 工具。
 *
 * 环境变量：
 *   CORS_ORIGINS — 逗号或换行分隔的允许来源列表
 *
 * 未配置 CORS_ORIGINS 时 getAllowedOrigin 返回 null（CORS 关闭，仅同源可用）。
 */

export function getAllowedOrigin(request, env) {
  const raw = env?.CORS_ORIGINS;
  if (!raw) return null;
  const origin = request.headers.get('origin');
  if (!origin) return null;
  const allowed = String(raw)
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return allowed.includes(origin) ? origin : null;
}

export function withCorsHeaders(response, request, env) {
  const origin = getAllowedOrigin(request, env);
  if (!origin) return response;
  const cloned = new Response(response.body, response);
  cloned.headers.set('access-control-allow-origin', origin);
  cloned.headers.set('access-control-allow-credentials', 'true');
  cloned.headers.set('access-control-allow-headers', 'Content-Type, x-turnstile-token');
  cloned.headers.set('access-control-allow-methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  cloned.headers.set('access-control-max-age', '86400');
  cloned.headers.append('vary', 'Origin');
  return cloned;
}

export function handleOptions(request, env) {
  const origin = getAllowedOrigin(request, env);
  if (!origin) return null;
  const response = new Response(null, { status: 204 });
  return withCorsHeaders(response, request, env);
}
