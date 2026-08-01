import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeGlobalConfig } from '../src/config/schema.js';

test('config keeps protocol and transport lists independent', () => {
  const config = normalizeGlobalConfig({ protocols: ['vless', 'trojan', 'bad'], transports: ['websocket', 'grpc', 'xhttp'], ECHConfig: { DNS: 'https://dns.example/doh', SNI: '0' } });
  assert.deepEqual(config.protocols, ['vless', 'trojan']);
  assert.deepEqual(config.transports, ['websocket', 'grpc', 'xhttp']);
  assert.equal(config.ECHConfig.dns, 'https://dns.example/doh');
  assert.equal(config.ECHConfig.domain, '0');
});

test('config defaults node count and sub converter', () => {
  const config = normalizeGlobalConfig({});
  assert.equal(config.节点参数.节点数量, 16);
  assert.ok(config.订阅转换.SUBAPI);
});

test('config accepts node count', () => {
  const config = normalizeGlobalConfig({ 节点参数: { 节点数量: 8 } });
  assert.equal(config.节点参数.节点数量, 8);
});

test('config clamps node count within range', () => {
  assert.equal(normalizeGlobalConfig({ 节点参数: { 节点数量: 0 } }).节点参数.节点数量, 1);
  assert.equal(normalizeGlobalConfig({ 节点参数: { 节点数量: 100 } }).节点参数.节点数量, 64);
});

test('config defaults optimized IP to disabled', () => {
  const config = normalizeGlobalConfig({});
  assert.equal(config.节点参数.优选IP.模式, '');
  assert.equal(config.节点参数.优选IP.随机端口, true);
  assert.equal(config.节点参数.优选IP.自定义IP源, '');
  assert.equal(config.节点参数.优选IP.优选网站URL, '');
});

test('config accepts optimized IP settings', () => {
  const config = normalizeGlobalConfig({
    节点参数: {
      优选IP: { 模式: 'custom', 随机端口: false, 优选网站URL: 'https://example.com/ips.txt' },
    },
  });
  assert.equal(config.节点参数.优选IP.模式, 'custom');
  assert.equal(config.节点参数.优选IP.随机端口, false);
  assert.equal(config.节点参数.优选IP.优选网站URL, 'https://example.com/ips.txt');
});

test('config strips custom fields when not in custom mode', () => {
  const config = normalizeGlobalConfig({
    节点参数: {
      优选IP: { 模式: 'optimized', 自定义IP源: '104.16.0.1', 优选网站URL: 'https://example.com/ips.txt' },
    },
  });
  assert.equal(config.节点参数.优选IP.模式, 'optimized');
  assert.equal(config.节点参数.优选IP.自定义IP源, '');
  assert.equal(config.节点参数.优选IP.优选网站URL, '');
});
