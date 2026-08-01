import assert from 'node:assert/strict';
import test from 'node:test';
import { generateIPs, parseCIDR, pickPort, resolveIPSource } from '../src/net/ip-pool.js';

const SAMPLE_CIDRS = ['104.16.0.0/13', '172.64.0.0/13'];

test('parseCIDR returns correct baseIP and hostBits', () => {
  const result = parseCIDR('104.16.0.0/13');
  assert.ok(result);
  assert.equal(result.hostBits, 19);

  const base = result.baseIP >>> 0;
  assert.equal((base >>> 24) & 0xff, 104);
  assert.equal((base >>> 16) & 0xff, 16);
});

test('parseCIDR rejects invalid CIDR format', () => {
  assert.equal(parseCIDR('not-a-cidr'), null);
  assert.equal(parseCIDR('104.16.0.0/33'), null);
  assert.equal(parseCIDR('104.16.0.0/abc'), null);
  assert.equal(parseCIDR(''), null);
});

test('generateIPs returns correct count', () => {
  const ips = generateIPs(SAMPLE_CIDRS, 10);
  assert.equal(ips.length, 10);
});

test('generateIPs returns all IP:port format', () => {
  const ips = generateIPs(SAMPLE_CIDRS, 20);
  for (const item of ips) {
    assert.match(item, /^\d+\.\d+\.\d+\.\d+:\d+$/);
  }
});

test('generateIPs uses fixed port when specified', () => {
  const ips = generateIPs(SAMPLE_CIDRS, 5, { fixedPort: 8443 });
  for (const item of ips) {
    assert.ok(item.endsWith(':8443'));
  }
});

test('generateIPs returns empty for empty CIDRs', () => {
  assert.deepEqual(generateIPs([], 5), []);
  assert.deepEqual(generateIPs(null, 5), []);
});

test('generateIPs returns empty for invalid count', () => {
  assert.deepEqual(generateIPs(SAMPLE_CIDRS, 0), []);
  assert.deepEqual(generateIPs(SAMPLE_CIDRS, -1), []);
});

test('generateIPs generates IPs within CIDR range', () => {
  // /32 means only one possible IP
  const ips = generateIPs(['104.16.0.0/32'], 1);
  assert.ok(ips[0].startsWith('104.16.0.0:'));
});

test('generateIPs uses custom ports', () => {
  const ips = generateIPs(SAMPLE_CIDRS, 5, { ports: [443] });
  for (const item of ips) {
    assert.ok(item.endsWith(':443'));
  }
});

test('generateIPs is deterministic in count', () => {
  const a = generateIPs(SAMPLE_CIDRS, 100);
  const b = generateIPs(SAMPLE_CIDRS, 100);
  assert.equal(a.length, b.length);
});

test('pickPort returns 443 when randomPort is false', () => {
  assert.equal(pickPort(false), 443);
});

test('pickPort returns a CF port when randomPort is true', () => {
  const VALID_PORTS = [443, 2053, 2083, 2087, 2096, 8443];
  for (let i = 0; i < 20; i++) {
    assert.ok(VALID_PORTS.includes(pickPort(true)));
  }
});

test('resolveIPSource returns null for empty source', async () => {
  assert.equal(await resolveIPSource(''), null);
  assert.equal(await resolveIPSource('   '), null);
  assert.equal(await resolveIPSource(null), null);
});

test('resolveIPSource parses single IP with default port', async () => {
  const result = await resolveIPSource('104.16.0.1');
  assert.deepEqual(result, ['104.16.0.1:443']);
});

test('resolveIPSource parses single IP:port', async () => {
  const result = await resolveIPSource('104.16.0.1:8443');
  assert.deepEqual(result, ['104.16.0.1:8443']);
});

test('resolveIPSource strips trailing comment', async () => {
  const result = await resolveIPSource('104.16.0.1:2053 #优选1');
  assert.deepEqual(result, ['104.16.0.1:2053']);
});

test('resolveIPSource fetches URL and parses lines', async () => {
  const mockFetch = async () => new Response('104.16.0.1:443\n104.16.0.2:2053\n# comment\n104.16.0.3\n', { status: 200 });
  const result = await resolveIPSource('https://example.com/ips.txt', { fetch: mockFetch });
  assert.deepEqual(result, ['104.16.0.1:443', '104.16.0.2:2053', '104.16.0.3:443']);
});

test('resolveIPSource returns null on fetch failure', async () => {
  const mockFetch = async () => new Response('', { status: 404 });
  const result = await resolveIPSource('https://example.com/ips.txt', { fetch: mockFetch });
  assert.equal(result, null);
});

test('resolveIPSource returns null on fetch error', async () => {
  const mockFetch = async () => { throw new Error('network error'); };
  const result = await resolveIPSource('https://example.com/ips.txt', { fetch: mockFetch });
  assert.equal(result, null);
});

test('resolveIPSource rejects invalid IP', async () => {
  const result = await resolveIPSource('not-an-ip');
  assert.equal(result, null);
});