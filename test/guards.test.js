import assert from 'node:assert/strict';
import test from 'node:test';
import { requireAdmin, requireUser } from '../src/auth/guards.js';

test('requireUser 区分未登录与禁用', () => {
  assert.throws(() => requireUser(null), (error) => {
    assert.equal(error.code, 'AUTH_REQUIRED');
    assert.equal(error.status, 401);
    return true;
  });

  assert.throws(() => requireUser({ userID: 'u1', disabled: true }), (error) => {
    assert.equal(error.code, 'USER_DISABLED');
    assert.equal(error.status, 403);
    return true;
  });
});

test('requireUser 放行正常用户，requireAdmin 校验角色', () => {
  const user = { userID: 'u1', role: 'user' };
  assert.equal(requireUser(user), user);
  assert.throws(() => requireAdmin(user), (error) => {
    assert.equal(error.code, 'ADMIN_REQUIRED');
    return true;
  });
  const admin = { userID: 'u2', role: 'admin' };
  assert.equal(requireAdmin(admin), admin);
});
