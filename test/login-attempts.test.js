import assert from 'node:assert/strict';
import test from 'node:test';
import { createLoginAttemptService } from '../src/auth/login-attempts.js';

test('login attempts reject an active lock with HTTP 429 semantics', async () => {
  const db = fakeDb({ failures: 10, locked_until: new Date(Date.now() + 60_000).toISOString() });
  const attempts = createLoginAttemptService({ DB: db });

  await assert.rejects(
    attempts.check({ ip: '203.0.113.1', username: 'alice' }),
    { code: 'LOGIN_RATE_LIMITED', status: 429 },
  );
});

test('login attempts clear an expired lock and successful login state', async () => {
  const db = fakeDb({ failures: 10, locked_until: new Date(Date.now() - 60_000).toISOString() });
  const attempts = createLoginAttemptService({ DB: db });

  await attempts.check({ ip: '203.0.113.1', username: 'alice' });
  await attempts.success({ ip: '203.0.113.1', username: 'alice' });

  assert.equal(db.deletes, 3);
});

test('login failure is recorded atomically for both ip and username', async () => {
  const db = fakeDb(null);
  const attempts = createLoginAttemptService({ DB: db });

  await attempts.failure({ ip: '203.0.113.1', username: 'alice' });

  assert.equal(db.writes, 2);
  assert.match(db.sql.at(-1), /ON CONFLICT\(fingerprint\) DO UPDATE/);
});

test('register check passes without turnstile when failures below threshold', async () => {
  const db = fakeDb({ failures: 0, locked_until: null });
  const attempts = createLoginAttemptService({ DB: db, TURNSTILE_SECRET_KEY: 'test-secret' });

  // failures=0 < CAPTCHA_THRESHOLD(2), should pass without token
  await attempts.checkRegister('203.0.113.1');
  // no throw = pass
});

function fakeDb(row) {
  return {
    deletes: 0,
    writes: 0,
    sql: [],
    prepare(sql) {
      this.sql.push(sql);
      const db = this;
      return {
        bind() { return this; },
        async first() { return row; },
        async run() {
          if (sql.startsWith('DELETE')) db.deletes += 1;
          else db.writes += 1;
          return { meta: { changes: 1 } };
        },
      };
    },
  };
}
