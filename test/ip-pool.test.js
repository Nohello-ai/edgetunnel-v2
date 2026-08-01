import assert from 'node:assert/strict';
import test from 'node:test';
import { generateIPs, parseCIDR, parseCustomIPs, fetchCustomIPs, generateNodeName } from '../src/net/ip-pool.js';

const SAMPLE_CIDRS = ['104.16.0.0/13', '172.64.0.0/13'];

test('parseCIDR returns correct baseIP and hostBits', () => {
  const result = parseCIDR('104.16.0.0/13');
  assert.ok(result);
  assert.equal(result.hostBits, 19);
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

test('generateIPs uses fixed port 443 when ports=[443]', () => {
  const ips = generateIPs(SAMPLE_CIDRS, 5, { ports: [443] });
  for (const item of ips) {
    assert.ok(item.endsWith(':443'));
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

test('parseCustomIPs returns null for empty input', () => {
  assert.equal(parseCustomIPs(''), null);
  assert.equal(parseCustomIPs('   '), null);
  assert.equal(parseCustomIPs(null), null);
});

test('parseCustomIPs parses IP:port#name', () => {
  const result = parseCustomIPs('104.19.52.52:2053#CF移动优选1');
  assert.deepEqual(result, [{ address: '104.19.52.52', port: 2053, name: 'CF移动优选1' }]);
});

test('parseCustomIPs parses IP#name with default port', () => {
  const result = parseCustomIPs('104.16.0.1#测试', { defaultPort: 443 });
  assert.deepEqual(result, [{ address: '104.16.0.1', port: 443, name: '测试' }]);
});

test('parseCustomIPs parses IP:port without name', () => {
  const result = parseCustomIPs('104.16.0.1:8443');
  assert.deepEqual(result, [{ address: '104.16.0.1', port: 8443 }]);
});

test('parseCustomIPs parses multiple lines', () => {
  const text = '104.19.52.52:2053#CF移动优选1\n104.16.157.51:8443#CF移动优选2\n104.17.155.94:2087';
  const result = parseCustomIPs(text, { defaultPort: 443 });
  assert.equal(result.length, 3);
  assert.equal(result[0].name, 'CF移动优选1');
  assert.equal(result[1].name, 'CF移动优选2');
  assert.equal(result[2].name, undefined);
});

test('parseCustomIPs skips comments and blank lines', () => {
  const text = '# 注释行\n104.16.0.1:443#测试\n\n  \n104.16.0.2:2053';
  const result = parseCustomIPs(text);
  assert.equal(result.length, 2);
});

test('fetchCustomIPs fetches and parses URL', async () => {
  const mockFetch = async () => new Response(
    '104.19.52.52:2053#CF移动优选1\n104.16.157.51:8443#CF移动优选2\n', { status: 200 }
  );
  const result = await fetchCustomIPs('https://example.com/ips.txt', { fetch: mockFetch });
  assert.equal(result.length, 2);
  assert.equal(result[0].name, 'CF移动优选1');
});

test('fetchCustomIPs returns null on fetch failure', async () => {
  const mockFetch = async () => new Response('', { status: 404 });
  const result = await fetchCustomIPs('https://example.com/ips.txt', { fetch: mockFetch });
  assert.equal(result, null);
});

test('generateNodeName uses provided name', () => {
  assert.equal(generateNodeName('我的节点', 'cmcc', 1), '我的节点');
});

test('generateNodeName auto-generates with operator label', () => {
  const name = generateNodeName(undefined, 'cmcc', 1);
  assert.ok(name.includes('中国移动'));
  assert.ok(name.includes('1'));
});

test('generateNodeName handles unknown operator', () => {
  const name = generateNodeName(undefined, 'unknown', 5);
  assert.ok(name.includes('国际'));
});