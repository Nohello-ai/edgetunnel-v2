import assert from 'node:assert/strict';
import test from 'node:test';
import { createUsageMeter } from '../src/usage/meter.js';

test('usage meter aggregates upload and download before flush', async () => {
  const calls = [];
  const meter = createUsageMeter({
    userID: 'user',
    repository: { increment: async (...args) => calls.push(args) },
  });

  meter.addUpload(10);
  meter.addUpload(5);
  meter.addDownload(7);
  await meter.flush();

  assert.deepEqual(calls, [['user', 15, 7]]);
});

test('usage meter drains bytes added during an active flush', async () => {
  let release;
  const calls = [];
  const meter = createUsageMeter({
    userID: 'user', flushThreshold: 1,
    repository: { async increment(...args) { calls.push(args); if (calls.length === 1) await new Promise((resolve) => { release = resolve; }); } },
  });
  meter.addUpload(5);
  await Promise.resolve();
  meter.addDownload(7);
  release();
  await meter.flush();
  assert.deepEqual(calls, [['user', 5, 0], ['user', 0, 7]]);
});

test('usage meter enforces a per-connection byte ceiling', () => {
  const meter = createUsageMeter({ userID: 'user', maxBytes: 10, repository: { increment: async () => {} } });
  meter.addUpload(6);
  meter.addDownload(4);
  assert.throws(() => meter.addUpload(1), { code: 'TRAFFIC_QUOTA_EXHAUSTED' });
});

test('usage meter restores counters after repository failure', async () => {
  let failures = 1;
  const calls = [];
  const meter = createUsageMeter({
    userID: 'user',
    repository: {
      async increment(...args) {
        calls.push(args);
        if (failures-- > 0) throw new Error('temporary');
      },
    },
  });

  meter.addUpload(9);
  await meter.flush();
  await meter.flush();
  assert.deepEqual(calls, [['user', 9, 0], ['user', 9, 0]]);
});

test('usage meter drains bytes added while a flush is active', async () => {
  let release;
  const calls = [];
  const meter = createUsageMeter({
    userID: 'user',
    repository: {
      async increment(...args) {
        calls.push(args);
        if (calls.length === 1) {
          await new Promise((resolve) => { release = resolve; });
        }
      },
    },
  });

  meter.addUpload(5);
  const firstFlush = meter.flush();
  await Promise.resolve();
  meter.addDownload(7);
  release();
  await firstFlush;
  await meter.flush();

  assert.deepEqual(calls, [['user', 5, 0], ['user', 0, 7]]);
});
