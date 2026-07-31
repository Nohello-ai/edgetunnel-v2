export function createUserRepository(env) {
  return {
    async count() {
      const row = await env.DB.prepare('SELECT COUNT(*) AS count FROM users').first();
      return Number(row?.count || 0);
    },
    async getByID(userID) {
      return mapUser(await env.DB.prepare('SELECT * FROM users WHERE user_id = ?').bind(userID).first());
    },
    async getByUsername(username) {
      return mapUser(await env.DB.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').bind(username).first());
    },
    async list() {
      const result = await env.DB.prepare('SELECT * FROM users ORDER BY created_at DESC').all();
      return (result.results || []).map(mapUser);
    },
    async countAdmins() {
      const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND disabled = 0").first();
      return Number(row?.count || 0);
    },
    async create(user) {
      await env.DB.prepare(`INSERT INTO users (user_id,username,password_hash,role,disabled,quota_bytes,trojan_secret,settings,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .bind(user.userID, user.username, user.passwordHash, user.role, user.disabled ? 1 : 0, user.quotaBytes, user.trojanSecret, JSON.stringify(user.settings || {}), user.createdAt, user.updatedAt).run();
      return user;
    },
    async update(userID, fields) {
      const columns = {
        username: ['username', (value) => value], passwordHash: ['password_hash', (value) => value],
        role: ['role', (value) => value], disabled: ['disabled', (value) => value ? 1 : 0],
        quotaBytes: ['quota_bytes', (value) => value], trojanSecret: ['trojan_secret', (value) => value],
        settings: ['settings', (value) => JSON.stringify(value || {})],
      };
      const selected = Object.entries(fields).filter(([key]) => columns[key]);
      if (selected.length === 0) return this.getByID(userID);
      const assignments = selected.map(([key]) => `${columns[key][0]}=?`);
      const values = selected.map(([key, value]) => columns[key][1](value));
      const updatedAt = new Date().toISOString();
      const result = await env.DB.prepare(`UPDATE users SET ${assignments.join(',')},updated_at=? WHERE user_id=?`)
        .bind(...values, updatedAt, userID).run();
      if (Number(result.meta?.changes || 0) === 0) return null;
      return this.getByID(userID);
    },
    async revokeSessions(userID) {
      await env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').bind(new Date().toISOString(), userID).run();
    },
    async delete(userID) { await env.DB.prepare('DELETE FROM users WHERE user_id = ?').bind(userID).run(); },
  };
}

export function publicUser(user) {
  if (!user) return null;
  const { passwordHash, subscriptionTokenHash, trojanSecret, ...safe } = user;
  return safe;
}

function mapUser(row) {
  if (!row) return null;
  return {
    userID: row.user_id, username: row.username, passwordHash: row.password_hash,
    role: row.role, disabled: Boolean(row.disabled), quotaBytes: Number(row.quota_bytes || 0),
    trojanSecret: row.trojan_secret, subscriptionTokenHash: row.subscription_token_hash,
    settings: parse(row.settings), createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function parse(value) { try { return JSON.parse(value || '{}'); } catch { return {}; } }
