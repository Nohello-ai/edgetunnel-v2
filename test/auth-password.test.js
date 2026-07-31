import assert from 'node:assert/strict';
import test from 'node:test';
import { hashPassword, verifyPassword } from '../src/auth/password.js';

test('password hash is salted, versioned, and verifies correctly', async () => {
  const first = await hashPassword('a-strong-password', { iterations: 100000 });
  const second = await hashPassword('a-strong-password', { iterations: 100000 });
  assert.match(first, /^pbkdf2-sha256\$100000\$/);
  assert.notEqual(first, second);
  assert.equal(await verifyPassword('a-strong-password', first), true);
  assert.equal(await verifyPassword('wrong-password', first), false);
  assert.equal(await verifyPassword('a-strong-password', 'invalid'), false);
});

test('password policy rejects short values', async () => {
  await assert.rejects(hashPassword('short'), /PASSWORD_LENGTH_INVALID/);
});
