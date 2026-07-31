/**
 * edgetunnel-v4 统一入口
 * 
 * 负责判断请求类型并分发到对应模块：
 * - API 请求 → api/index.js
 * - 代理数据流 → proxy/index.js
 */

import { 生成用户 ID } from './utils/crypto.js';
import { log } from './utils/log.js';

// ============================================================================
// 环境变量校验
// ============================================================================

function 校验环境变量 (env) {
  const ID = env.ID || '';
  
  if (!ID) {
    return { valid: false, error: 'ID_REQUIRED' };
  }
  
  // 验证 ID 是否为 UUID v4 格式
  const uuid 正则=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuid 正则.test(ID)) {
    return { valid: false, error: 'ID 必须是 UUID v4 格式' };
  }
  
  return { valid: true, ID };
}

// ============================================================================
// 请求类型判断
// ============================================================================

/**
 * 判断请求类型
 * @param {URL} url
 * @param {string} 访问路径
 * @returns {{类型：'api' | 'proxy' | 'static'}}
 */
function 判断请求类型 (url, 访问路径) {
  // API 请求：/api/*
  if (访问路径.startsWith('api/')) {
    return { 类型：'api' };
  }
  
  // 静态资源：/login, /admin, /sub, /version
  if (['login', 'admin', 'admin/', 'sub', 'version'].includes(访问路径)) {
    return { 类型：'static' };
  }
  
  // 其他：代理数据流（WebSocket/gRPC/XHTTP）
  return { 类型：'proxy' };
}

// ============================================================================
// 主请求处理函数
// ============================================================================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const 访问路径 = url.pathname.slice(1).toLowerCase();
    
    // 环境变量校验
    const 校验结果 = 校验环境变量 (env);
    if (!校验结果.valid) {
      return new Response(JSON.stringify({ error: 校验结果.error }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const { ID } = 校验结果;
    
    // 请求类型判断
    const { 类型 } = 判断请求类型 (url, 访问路径);
    
    switch (类型) {
      case 'api': {
        // API 请求 → 转发到 api/index.js
        const { 处理所有 API请求 } = await import('./api/index.js');
        return await 处理所有 API请求 (request, url, env, ctx, ID);
      }
      
      case 'proxy': {
        // 代理数据流 → 转发到 proxy/index.js
        const { 处理所有代理请求 } = await import('./proxy/index.js');
        return await 处理所有代理请求 (request, url, env, ctx, ID);
      }
      
      case 'static': {
        // 静态资源 → 简单响应
        switch (访问路径) {
          case 'login':
            return new Response('Login Page', { status: 200 });
          case 'admin':
          case 'admin/':
            return new Response('Admin Panel', { status: 200 });
          case 'sub':
            return new Response('Subscription Endpoint', { status: 200 });
          case 'version':
            return new Response(JSON.stringify({ version: '4.0.0' }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            });
          default:
            return new Response('Not Found', { status: 404 });
        }
      }
      
      default:
        return new Response('Bad Request', { status: 400 });
    }
  },
};
