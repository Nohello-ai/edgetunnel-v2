import { AppError } from '../core/errors.js';
import { verifyTurnstile, isTurnstileEnabled } from '../utils/turnstile.js';

const CAPTCHA_THRESHOLD = 2;   // 2 次失败后触发人机验证
const LOCK_THRESHOLD = 10;     // 10 次失败后锁定
const LOCK_MINUTES = 15;

export function createLoginAttemptService(env) {
  return {
    /**
     * 登录前检查：锁定状态 + 人机验证门槛。
     * fingerprint 为 { ip, username } 对象。
     * turnstileToken 由前端 Turnstile widget 生成。
     */
    async check(fingerprint, turnstileToken = '', request = null) {
      const { ip, username } = fingerprint;
      const ipKey = ip ? `ip:${ip}` : null;
      const userKey = username ? `user:${username}` : null;

      // 检查是否已锁定
      if (ipKey) await assertNotLocked(env, ipKey);
      if (userKey) await assertNotLocked(env, userKey);

      // 检查是否需要人机验证（仅当 Turnstile 已配置时）
      if (!isTurnstileEnabled(env)) return;

      const ipFailures = ipKey ? await getFailureCount(env, ipKey) : 0;
      const userFailures = userKey ? await getFailureCount(env, userKey) : 0;
      const maxFailures = Math.max(ipFailures, userFailures);

      if (maxFailures >= CAPTCHA_THRESHOLD) {
        const remoteIP = request?.headers?.get('cf-connecting-ip') || ip || '';
        const valid = await verifyTurnstile(turnstileToken, env, remoteIP);
        if (!valid) {
          throw new AppError('REQUIRE_CAPTCHA', 403, '请完成人机验证后重试');
        }
      }
    },

    async success(fingerprint) {
      const { username } = fingerprint;
      // 清除用户名维度的失败记录（登录成功）
      if (username) await clearFailures(env, `user:${username}`);
      // IP 维度不清除，防止换用户名继续爆破
    },

    async failure(fingerprint) {
      const { ip, username } = fingerprint;
      const now = new Date();
      const lockedUntil = new Date(now.getTime() + LOCK_MINUTES * 60 * 1000).toISOString();
      if (ip) await recordFailure(env, `ip:${ip}`, LOCK_THRESHOLD, lockedUntil, now);
      if (username) await recordFailure(env, `user:${username}`, LOCK_THRESHOLD, lockedUntil, now);
    },

    /**
     * 注册频率检查：与登录共用同一套门槛逻辑。
     * 按 IP 维度计数，每次注册调用 recordRegister 递增。
     */
    async checkRegister(ip, turnstileToken = '', request = null) {
      if (!ip) return;
      const key = `register:${ip}`;
      await assertNotLocked(env, key);

      if (!isTurnstileEnabled(env)) return;
      const failures = await getFailureCount(env, key);
      if (failures >= CAPTCHA_THRESHOLD) {
        const valid = await verifyTurnstile(turnstileToken, env, ip);
        if (!valid) {
          throw new AppError('REQUIRE_CAPTCHA', 403, '请完成人机验证后重试');
        }
      }
    },

    async recordRegister(ip) {
      if (!ip) return;
      const key = `register:${ip}`;
      const now = new Date();
      const lockedUntil = new Date(now.getTime() + LOCK_MINUTES * 60 * 1000).toISOString();
      await recordFailure(env, key, LOCK_THRESHOLD, lockedUntil, now);
    },
  };
}

// ── helpers ──────────────────────────────────────────────────

async function assertNotLocked(env, key) {
  const row = await env.DB.prepare('SELECT locked_until FROM login_attempts WHERE fingerprint = ?').bind(key).first();
  if (row?.locked_until && Date.parse(row.locked_until) > Date.now()) {
    throw new AppError('LOGIN_RATE_LIMITED', 429, '尝试过于频繁，请稍后再试');
  }
  if (row?.locked_until) {
    await env.DB.prepare('DELETE FROM login_attempts WHERE fingerprint = ?').bind(key).run();
  }
}

async function getFailureCount(env, key) {
  const row = await env.DB.prepare('SELECT failures FROM login_attempts WHERE fingerprint = ?').bind(key).first();
  return row?.failures || 0;
}

async function clearFailures(env, key) {
  await env.DB.prepare('DELETE FROM login_attempts WHERE fingerprint = ?').bind(key).run();
}

async function recordFailure(env, key, lockThreshold, lockedUntil, now) {
  await env.DB.prepare(`
    INSERT INTO login_attempts (fingerprint, failures, locked_until, updated_at)
    VALUES (?, 1, NULL, ?)
    ON CONFLICT(fingerprint) DO UPDATE SET
      failures = login_attempts.failures + 1,
      locked_until = CASE WHEN login_attempts.failures + 1 >= ? THEN ? ELSE login_attempts.locked_until END,
      updated_at = excluded.updated_at
  `).bind(key, now.toISOString(), lockThreshold, lockedUntil).run();
}
