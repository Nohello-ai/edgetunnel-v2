import { AppError } from '../core/errors.js';

const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;

export function createLoginAttemptService(env) {
  return {
    async check(fingerprint) {
      const key = normalizeFingerprint(fingerprint);
      if (!key) return;
      const row = await env.DB.prepare('SELECT failures, locked_until FROM login_attempts WHERE fingerprint = ?').bind(key).first();
      if (row && row.locked_until && Date.parse(row.locked_until) > Date.now()) {
        throw new AppError('LOGIN_RATE_LIMITED', 429);
      }
      if (row?.locked_until) {
        await env.DB.prepare('DELETE FROM login_attempts WHERE fingerprint = ?').bind(key).run();
      }
    },
    async success(fingerprint) {
      const key = normalizeFingerprint(fingerprint);
      if (!key) return;
      await env.DB.prepare('DELETE FROM login_attempts WHERE fingerprint = ?').bind(key).run();
    },
    async failure(fingerprint) {
      const key = normalizeFingerprint(fingerprint);
      if (!key) return;
      const now = new Date();
      const lockedUntil = new Date(now.getTime() + LOCK_MINUTES * 60 * 1000).toISOString();
      await env.DB.prepare(`
        INSERT INTO login_attempts (fingerprint, failures, locked_until, updated_at)
        VALUES (?, 1, NULL, ?)
        ON CONFLICT(fingerprint) DO UPDATE SET
          failures = login_attempts.failures + 1,
          locked_until = CASE WHEN login_attempts.failures + 1 >= ? THEN ? ELSE login_attempts.locked_until END,
          updated_at = excluded.updated_at
      `).bind(key, now.toISOString(), MAX_FAILURES, lockedUntil).run();
    },
  };
}

function normalizeFingerprint(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.length > 128 ? text.slice(0, 128) : text;
}
