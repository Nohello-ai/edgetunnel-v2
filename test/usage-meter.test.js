import assert from 'node:assert/strict';
import test from 'node:test';
import { createUsageMeter } from '../src/usage/meter.js';

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

// quotaDO stub：支持 idFromName/get，并响应 /status（stopVersion 检查）与 /stop（超限停表）
function makeQuotaDO({ stopVersion = 0 } = {}) {
  return {
    idFromName: () => 'do-id',
    get: () => ({
      fetch: async (url) => {
        const target = String(url);
        if (target.includes('/status')) return jsonResponse({ stopVersion });
        if (target.includes('/stop')) return jsonResponse({ ok: true });
        return jsonResponse({});
      },
    }),
  };
}

test('usage meter aggregates upload and download before flush', async () => {
  const calls = [];
  const userAdmin = {
    fetch: async (url, opts) => {
      calls.push(JSON.parse(opts.body));
      return jsonResponse({ allowed: true });
    },
  };
  const meter = createUsageMeter({ userID: 'user', quotaDO: makeQuotaDO(), userAdmin, stopVersion: 0 });

  meter.addUpload(10);
  meter.addUpload(5);
  meter.addDownload(7);
  await meter.flush();

  assert.deepEqual(calls, [{ userId: 'user', upload: 15, download: 7 }]);
});

test('usage meter drains bytes added during an active flush', async () => {
  let release;
  const calls = [];
  const userAdmin = {
    fetch: async (url, opts) => {
      calls.push(JSON.parse(opts.body));
      if (calls.length === 1) await new Promise((resolve) => { release = resolve; });
      return jsonResponse({ allowed: true });
    },
  };
  const meter = createUsageMeter({ userID: 'user', quotaDO: makeQuotaDO(), userAdmin, reportThreshold: 1, stopVersion: 0 });

  meter.addUpload(5);
  await Promise.resolve();
  meter.addDownload(7);
  release();
  await meter.flush();

  assert.deepEqual(calls, [{ userId: 'user', upload: 5, download: 0 }, { userId: 'user', upload: 0, download: 7 }]);
});

test('usage meter enforces quota via DO response', async () => {
  const userAdmin = {
    fetch: async () => jsonResponse({ allowed: false }),
  };
  const meter = createUsageMeter({ userID: 'user', quotaDO: makeQuotaDO(), userAdmin, stopVersion: 0 });

  meter.addUpload(10);
  await assert.rejects(meter.flush(), { code: 'TRAFFIC_QUOTA_EXHAUSTED' });
});

test('usage meter restores counters after DO failure', async () => {
  let failures = 1;
  const calls = [];
  const userAdmin = {
    fetch: async (url, opts) => {
      calls.push(JSON.parse(opts.body));
      if (failures-- > 0) throw new Error('temporary');
      return jsonResponse({ allowed: true });
    },
  };
  const meter = createUsageMeter({ userID: 'user', quotaDO: makeQuotaDO(), userAdmin, stopVersion: 0 });

  meter.addUpload(9);
  await meter.flush();
  await meter.flush();

  assert.deepEqual(calls, [{ userId: 'user', upload: 9, download: 0 }, { userId: 'user', upload: 9, download: 0 }]);
});

test('usage meter drains bytes added while a flush is active', async () => {
  let release;
  const calls = [];
  const userAdmin = {
    fetch: async (url, opts) => {
      calls.push(JSON.parse(opts.body));
      if (calls.length === 1) await new Promise((resolve) => { release = resolve; });
      return jsonResponse({ allowed: true });
    },
  };
  const meter = createUsageMeter({ userID: 'user', quotaDO: makeQuotaDO(), userAdmin, stopVersion: 0 });

  meter.addUpload(5);
  const firstFlush = meter.flush();
  await Promise.resolve();
  meter.addDownload(7);
  release();
  await firstFlush;
  await meter.flush();

  assert.deepEqual(calls, [{ userId: 'user', upload: 5, download: 0 }, { userId: 'user', upload: 0, download: 7 }]);
});
