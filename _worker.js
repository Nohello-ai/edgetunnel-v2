// _worker.js — edgetunnel v2 入口
// 设计：极简入口，所有逻辑委托给 router 和 context
// 格式：Service Worker（兼容 Workers + Pages）
import { createRequestContext } from './src/context.js';
import { routeRequest } from './src/router.js';

// 核心处理函数
async function handleFetch(request, env, ctx) {
  try {
    const url = cleanUrl(request.url);
    const ctx_ = createRequestContext(request, env, url);
    return await routeRequest(request, env, ctx, url, ctx_);
  } catch (e) {
    return new Response('Worker Error: ' + (e?.message || e?.stack || String(e)), {
      status: 500,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}

// Service Worker 入口（Workers 默认格式）
addEventListener('fetch', event => {
  // Cloudflare Workers Service Worker 格式中，env 绑定通过 globalThis 暴露
  // 用 Proxy 做兼容，让所有 env.XXX 访问自动落到 globalThis.XXX
  const env = new Proxy({}, {
    get(_target, prop) {
      return globalThis[prop];
    }
  });
  const ctx = { waitUntil: event.waitUntil?.bind(event), passThroughOnException: event.passThroughOnException?.bind(event) };
  event.respondWith(handleFetch(event.request, env, ctx));
});

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