import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeGlobalConfig } from '../src/config/schema.js';

const existing = normalizeGlobalConfig({
  HOSTS: ['a.example.com'],
  节点参数: { Fingerprint: 'firefox', 随机路径: true, 节点数量: 8, 优选IP: { 模式: 'custom', 自定义IP源: '1.1.1.1', 随机端口: false } },
  订阅转换: { SUBAPI: 'https://my.subapi', emoji: false },
  反代: { 模式: 'socks5', SOCKS5: { 账号: 'u:p@host:1080', 全局: true } },
});

test('PATCH 局部字段不会清空同级的其他嵌套字段', () => {
  const patched = normalizeGlobalConfig({ 节点参数: { 节点数量: 12 } }, existing);
  assert.equal(patched.节点参数.节点数量, 12);
  assert.equal(patched.节点参数.Fingerprint, 'firefox');
  assert.equal(patched.节点参数.随机路径, true);
  assert.equal(patched.节点参数.优选IP.模式, 'custom');
  assert.equal(patched.节点参数.优选IP.自定义IP源, '1.1.1.1');
  assert.equal(patched.节点参数.优选IP.随机端口, false);
});

test('未提交 订阅转换 时不会被打回默认 SUBAPI', () => {
  const patched = normalizeGlobalConfig({ HOSTS: ['b.example.com'] }, existing);
  assert.equal(patched.订阅转换.SUBAPI, 'https://my.subapi');
  assert.equal(patched.订阅转换.emoji, false);
  assert.deepEqual(patched.HOSTS, ['b.example.com']);
});

test('未提交 反代 时保留 SOCKS5 账号与全局开关', () => {
  const patched = normalizeGlobalConfig({ ECH: true }, existing);
  assert.equal(patched.反代.模式, 'socks5');
  assert.equal(patched.反代.SOCKS5.账号, 'u:p@host:1080');
  assert.equal(patched.反代.SOCKS5.全局, true);
});

test('显式提交的值仍然覆盖旧值', () => {
  const patched = normalizeGlobalConfig({ 节点参数: { Fingerprint: 'safari', 随机路径: false } }, existing);
  assert.equal(patched.节点参数.Fingerprint, 'safari');
  assert.equal(patched.节点参数.随机路径, false);
  assert.equal(patched.节点参数.节点数量, 8);
});
