import assert from 'node:assert/strict';
import test from 'node:test';
import { createUsageMeter } from '../src/usage/meter.js';

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

test('usage meter aggregates upload and download before flush', async () => {
  const calls = [];
  const quotaDO = {
    fetch: async (url, opts) => {
      calls.push(JSON.parse(opts.body));
      return jsonResponse({ allowed: true, remaining: 99999, budget: 100 * 1024 * 1024 });
    },
  };
  const meter = createUsageMeter({ userID: 'user', quotaDO, flushThreshold: 256 * 1024, resetVersion: 0 });

  meter.addUpload(10);
  meter.addUpload(5);
  meter.addDownload(7);
  await meter.flush();

  assert.deepEqual(calls, [{ delta: 22, resetVersion: 0 }]);
});

test('usage meter drains bytes added during an active flush', async () => {
  let release;
  const calls = [];
  const quotaDO = {
    fetch: async (url, opts) => {
      calls.push(JSON.parse(opts.body));
      if (calls.length === 1) await new Promise((resolve) => { release = resolve; });
      return jsonResponse({ allowed: true, remaining: 99999, budget: 100 * 1024 * 1024 });
    },
  };
  const meter = createUsageMeter({ userID: 'user', quotaDO, flushThreshold: 1, resetVersion: 0 });

  meter.addUpload(5);
  await Promise.resolve();
  meter.addDownload(7);
  release();
  await meter.flush();

  assert.deepEqual(calls, [{ delta: 5, resetVersion: 0 }, { delta: 7, resetVersion: 0 }]);
});

test('usage meter enforces quota via DO response', async () => {
  const quotaDO = {
    fetch: async () => jsonResponse({ allowed: false, remaining: 0, budget: 0 }),
  };
  const meter = createUsageMeter({ userID: 'user', quotaDO, resetVersion: 0 });

  meter.addUpload(10);
  await assert.rejects(meter.flush(), { code: 'TRAFFIC_QUOTA_EXHAUSTED' });
});

test('usage meter restores counters after DO failure', async () => {
  let failures = 1;
  const calls = [];
  const quotaDO = {
    fetch: async (url, opts) => {
      calls.push(JSON.parse(opts.body));
      if (failures-- > 0) throw new Error('temporary');
      return jsonResponse({ allowed: true, remaining: 99999, budget: 100 * 1024 * 1024 });
    },
  };
  const meter = createUsageMeter({ userID: 'user', quotaDO, resetVersion: 0 });

  meter.addUpload(9);
  await meter.flush();
  await meter.flush();

  assert.deepEqual(calls, [{ delta: 9, resetVersion: 0 }, { delta: 9, resetVersion: 0 }]);
});

test('usage meter drains bytes added while a flush is active', async () => {
  let release;
  const calls = [];
  const quotaDO = {
    fetch: async (url, opts) => {
      calls.push(JSON.parse(opts.body));
      if (calls.length === 1) await new Promise((resolve) => { release = resolve; });
      return jsonResponse({ allowed: true, remaining: 99999, budget: 100 * 1024 * 1024 });
    },
  };
  const meter = createUsageMeter({ userID: 'user', quotaDO, resetVersion: 0 });

  meter.addUpload(5);
  const firstFlush = meter.flush();
  await Promise.resolve();
  meter.addDownload(7);
  release();
  await firstFlush;
  await meter.flush();

  assert.deepEqual(calls, [{ delta: 5, resetVersion: 0 }, { delta: 7, resetVersion: 0 }]);
});
