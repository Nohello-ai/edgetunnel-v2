const COOKIE = 'edt_session';

export function createSessionService(env, users, options = {}) {
  const ttlSeconds = Number(options.ttlSeconds || 86400);
  return {
    async create(userID) {
      const token = randomToken(32);
      const tokenHash = await digest(token);
      const now = new Date();
      const expires = new Date(now.getTime() + ttlSeconds * 1000);
      await env.DB.prepare('INSERT INTO sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)')
        .bind(tokenHash, userID, expires.toISOString(), now.toISOString()).run();
      return { token, cookie: `${COOKIE}=${token}; Path=/; Max-Age=${ttlSeconds}; HttpOnly; Secure; SameSite=Strict` };
    },
    async resolve(request) {
      const token = readCookie(request.headers.get('cookie'), COOKIE);
      if (!token) return null;
      const hash = await digest(token);
      const row = await env.DB.prepare('SELECT user_id,expires_at,revoked_at FROM sessions WHERE token_hash = ?').bind(hash).first();
      if (!row || row.revoked_at || Date.parse(row.expires_at) <= Date.now()) return null;
      const user = await users.getByID(row.user_id);
      if (!user || user.disabled) return null;
      const ban = await env.DB.prepare('SELECT 1 AS ok FROM bans WHERE user_id = ? AND (until IS NULL OR until > ?) LIMIT 1')
        .bind(row.user_id, new Date().toISOString()).first();
      return ban ? null : user;
    },
    async revoke(request) {
      const token = readCookie(request.headers.get('cookie'), COOKIE);
      if (token) await env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ?').bind(new Date().toISOString(), await digest(token)).run();
      return `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
    },
  };
}

async function digest(value) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return [...bytes].map((v) => v.toString(16).padStart(2, '0')).join('');
}
function randomToken(length) { const b = crypto.getRandomValues(new Uint8Array(length)); let s = ''; for (const v of b) s += String.fromCharCode(v); return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', ''); }
function readCookie(header, name) { for (const part of String(header || '').split(';')) { const [key, ...rest] = part.trim().split('='); if (key === name) return rest.join('='); } return ''; }
