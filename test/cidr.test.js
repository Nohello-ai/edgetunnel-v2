import assert from 'node:assert/strict';
import test from 'node:test';
import { getCIDRList, clearCIDRCache } from '../src/net/cidr.js';

const SAMPLE_CIDRS = '104.16.0.0/13\n172.64.0.0/13\n162.158.0.0/15';
const SAMPLE_WITH_COMMENTS = '# Cloudflare IPv4\n104.16.0.0/13\n\n172.64.0.0/13\n';

function mockFetch(responseText, status = 200) {
  return async () => new Response(responseText, { status });
}

function mockFetchError() {
  return async () => { throw new Error('network error'); };
}

test.beforeEach(() => clearCIDRCache());

test('getCIDRList returns CF CIDRs for cf operator', async () => {
  const cidrs = await getCIDRList('cf', { fetch: mockFetch(SAMPLE_CIDRS) });
  assert.ok(cidrs.length >= 3);
  assert.ok(cidrs.includes('104.16.0.0/13'));
});

test('getCIDRList returns operator-specific CIDRs', async () => {
  const cidrs = await getCIDRList('cmcc', { fetch: mockFetch(SAMPLE_CIDRS) });
  assert.ok(cidrs.length >= 3);
});

test('getCIDRList uses cache on second call', async () => {
  let callCount = 0;
  const fetcher = async () => { callCount += 1; return new Response(SAMPLE_CIDRS, { status: 200 }); };

  await getCIDRList('ct', { fetch: fetcher });
  await getCIDRList('ct', { fetch: fetcher });
  assert.equal(callCount, 1);
});

test('getCIDRList falls back to cached entry when fetch fails', async () => {
  const first = await getCIDRList('cu', { fetch: mockFetch(SAMPLE_CIDRS) });
  const second = await getCIDRList('cu', { fetch: mockFetchError() });
  assert.deepEqual(first, second);
});

test('getCIDRList falls back to built-in CIDRs when no cache and fetch fails', async () => {
  const cidrs = await getCIDRList('cf', { fetch: mockFetchError() });
  assert.ok(cidrs.includes('104.16.0.0/13'));
  assert.ok(cidrs.includes('172.64.0.0/13'));
});

test('getCIDRList handles empty response', async () => {
  const cidrs = await getCIDRList('cf', { fetch: mockFetch('') });
  assert.ok(cidrs.length >= 2);
});

test('getCIDRList strips comments and blank lines', async () => {
  const cidrs = await getCIDRList('cf', { fetch: mockFetch(SAMPLE_WITH_COMMENTS) });
  assert.equal(cidrs.length, 2);
  assert.equal(cidrs[0], '104.16.0.0/13');
});

test('getCIDRList returns fallback for unknown operator', async () => {
  const cidrs = await getCIDRList('unknown', { fetch: mockFetch(SAMPLE_CIDRS) });
  assert.ok(cidrs.length >= 2);
});