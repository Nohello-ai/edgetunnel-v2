import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionService } from '../src/auth/session.js';

const USER_ID = '123e4567-e89b-42d3-a456-426614174000';

test('session resolution rejects disabled users and active bans', async () => {
  const calls = [];
  const db = {
    prepare(sql) {
      calls.push(sql);
      if (sql.startsWith('SELECT user_id,expires_at,revoked_at FROM sessions')) {
        return {
          bind() { return this; },
          async first() {
            return { user_id: USER_ID, expires_at: new Date(Date.now() + 60_000).toISOString(), revoked_at: null };
          },
        };
      }
      if (sql.startsWith('SELECT 1 AS ok FROM bans')) {
        return {
          bind() { return this; },
          async first() { return { ok: 1 }; },
        };
      }
      throw new Error(`unexpected sql: ${sql}`);
    },
  };
  const users = { async getByID() { return { userID: USER_ID, disabled: false }; } };
  const sessions = createSessionService({ DB: db }, users);
  const request = new Request('https://example.com/api/auth/me', { headers: { cookie: 'edt_session=token' } });

  assert.equal(await sessions.resolve(request), null);

  assert.deepEqual(calls, [
    'SELECT user_id,expires_at,revoked_at FROM sessions WHERE token_hash = ?',
    'SELECT 1 AS ok FROM bans WHERE user_id = ? AND (until IS NULL OR until > ?) LIMIT 1',
  ]);
});

test('session create and revoke round-trip cookie values', async () => {
  const calls = [];
  const db = {
    prepare(sql) {
      calls.push(sql);
      return {
        bind() { return this; },
        async run() { return { meta: { changes: 1 } }; },
        async first() { return null; },
      };
    },
  };
  const sessions = createSessionService({ DB: db }, { async getByID() { return null; } });
  const created = await sessions.create(USER_ID);
  const revoked = await sessions.revoke(new Request('https://example.com/api/auth/logout', { headers: { cookie: created.cookie } }));

  assert.match(created.cookie, /^edt_session=/);
  assert.match(revoked, /^edt_session=;/);
  assert.deepEqual(calls, [
    'INSERT INTO sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)',
    'UPDATE sessions SET revoked_at = ? WHERE token_hash = ?',
  ]);
});
