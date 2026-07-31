import assert from 'node:assert/strict';
import test from 'node:test';
import { publicUser } from '../src/users/repository.js';

test('public user responses never expose credential material', () => {
  const safe = publicUser({
    userID: 'id',
    username: 'alice',
    passwordHash: 'secret-hash',
    subscriptionTokenHash: 'token-hash',
    trojanSecret: 'trojan-secret',
    role: 'user',
  });
  assert.deepEqual(safe, { userID: 'id', username: 'alice', role: 'user' });
});
