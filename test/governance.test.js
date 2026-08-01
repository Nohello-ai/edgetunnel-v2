import assert from 'node:assert/strict';
import test from 'node:test';
import { createGovernanceService } from '../src/users/governance.js';

function fakeDB(sink = []) {
  return { prepare(sql) { return { bind(...args) { sink.push({ sql, args }); return { async run() { return { meta: { changes: 1 } }; }, async first() { return null; } }; } }; } };
}

test('ban 拒绝非法的截止时间而不是抛出 500', async () => {
  const governance = createGovernanceService({ DB: fakeDB() });
  await assert.rejects(governance.ban('u1', { until: 'not-a-date' }), (error) => {
    assert.equal(error.code, 'BAN_UNTIL_INVALID');
    assert.equal(error.status, 400);
    return true;
  });
});

test('ban 归一化合法的截止时间，缺省为永久封禁', async () => {
  const sink = [];
  const governance = createGovernanceService({ DB: fakeDB(sink) });
  const timed = await governance.ban('u1', { reason: 'abuse', until: '2030-01-01' });
  assert.equal(timed.until, '2030-01-01T00:00:00.000Z');
  const permanent = await governance.ban('u2', { reason: 'spam' });
  assert.equal(permanent.until, null);
});
