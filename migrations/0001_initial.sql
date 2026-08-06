-- Apply to a new D1 database with: wrangler d1 migrations apply <DATABASE>
PRAGMA foreign_keys = ON;

CREATE TABLE users (user_id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user')), disabled INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0,1)), quota_bytes INTEGER NOT NULL DEFAULT -1 CHECK (quota_bytes >= -1), trojan_secret TEXT NOT NULL, subscription_token_hash TEXT, settings TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX idx_users_disabled ON users(disabled);
CREATE TABLE login_attempts (fingerprint TEXT PRIMARY KEY, failures INTEGER NOT NULL DEFAULT 0, locked_until TEXT, updated_at TEXT NOT NULL);
CREATE INDEX idx_login_attempts_locked ON login_attempts(locked_until);
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT, created_at TEXT NOT NULL, FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE);
CREATE INDEX idx_sessions_user ON sessions(user_id, expires_at);
CREATE TABLE bans (user_id TEXT PRIMARY KEY, reason TEXT NOT NULL DEFAULT '', until TEXT, created_at TEXT NOT NULL, FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE);
CREATE TABLE notifications (id TEXT PRIMARY KEY, user_id TEXT, type TEXT NOT NULL, message TEXT NOT NULL DEFAULT '', read_at TEXT, created_at TEXT NOT NULL, FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE);
CREATE INDEX idx_notifications_user_created ON notifications(user_id, created_at DESC);
CREATE TABLE usage (user_id TEXT PRIMARY KEY, upload INTEGER NOT NULL DEFAULT 0, download INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE);
CREATE TABLE global_config (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL);
