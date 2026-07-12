// _worker.js — edgetunnel v2 入口
// 设计：极简入口，所有逻辑委托给 router 和 context
import { createRequestContext } from './src/context.js';
import { routeRequest } from './src/router.js';

export default {
  async fetch(request, env, ctx) {
    // 1. URL 清洗（对齐原版）
    const url = cleanUrl(request.url);

    // 2. 构建请求上下文（线程安全，替代全局变量）
    const ctx_ = createRequestContext(request, env, url);

    // 3. 路由分发
    return await routeRequest(request, env, ctx, url, ctx_);
  },
};

// ---- URL 清洗（对齐原版 行 20-27） ----
function cleanUrl(raw) {
  let s = raw.replace(/%5[Cc]/g, '').replace(/\\/g, '');
  const hashIdx = s.indexOf('#');
  const body = hashIdx === -1 ? s : s.slice(0, hashIdx);
  const hash = hashIdx === -1 ? '' : s.slice(hashIdx);
  if (!body.includes('?') && /%3f/i.test(body)) {
    s = body.replace(/%3f/i, '?') + hash;
  }
  return new URL(s);
}