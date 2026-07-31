import assert from 'node:assert/strict';
import test from 'node:test';
import { createLoginAttemptService } from '../src/auth/login-attempts.js';

test('login attempts reject an active lock with HTTP 429 semantics', async () => {
  const db = fakeDb({ failures: 5, locked_until: new Date(Date.now() + 60_000).toISOString() });
  const attempts = createLoginAttemptService({ DB: db });

  await assert.rejects(attempts.check('203.0.113.1:alice'), {
    code: 'LOGIN_RATE_LIMITED',
    status: 429,
  });
});

test('login attempts clear an expired lock and successful login state', async () => {
  const db = fakeDb({ failures: 5, locked_until: new Date(Date.now() - 60_000).toISOString() });
  const attempts = createLoginAttemptService({ DB: db });

  await attempts.check('203.0.113.1:alice');
  await attempts.success('203.0.113.1:alice');

  assert.equal(db.deletes, 2);
});

test('login failure is recorded atomically', async () => {
  const db = fakeDb(null);
  const attempts = createLoginAttemptService({ DB: db });

  await attempts.failure('203.0.113.1:alice');

  assert.equal(db.writes, 1);
  assert.match(db.sql.at(-1), /ON CONFLICT\(fingerprint\) DO UPDATE/);
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
