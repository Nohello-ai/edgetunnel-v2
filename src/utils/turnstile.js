/**
 * Cloudflare Turnstile 人机验证工具。
 *
 * 环境变量：
 *   TURNSTILE_SITE_KEY   — 前端 widget 公钥
 *   TURNSTILE_SECRET_KEY — 后端验证密钥
 *
 * 未配置 SECRET_KEY 时 isTurnstileEnabled() 返回 false，
 * login-attempts 会跳过人机验证，仅靠失败次数锁定兜底。
 */

export async function verifyTurnstile(token, env, remoteIP = '') {
  const secret = env?.TURNSTILE_SECRET_KEY;
  if (!secret) return false;

  try {
    const body = new URLSearchParams();
    body.append('secret', secret);
    body.append('response', token || '');
    if (remoteIP) body.append('remoteip', remoteIP);

    const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body,
    });
    const result = await resp.json();
    return result.success === true;
  } catch {
    return false;
  }
}

export function isTurnstileEnabled(env) {
  return Boolean(env?.TURNSTILE_SECRET_KEY);
}

export function getTurnstileSiteKey(env) {
  return env?.TURNSTILE_SITE_KEY || '';
}
