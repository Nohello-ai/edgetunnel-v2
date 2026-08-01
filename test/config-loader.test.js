import assert from 'node:assert/strict';
import test from 'node:test';
import { getGlobalConfig, putGlobalConfig } from '../src/config/loader.js';

test('putGlobalConfig 在 KV 未绑定时报错而不是假装成功', async () => {
  await assert.rejects(putGlobalConfig({}, { a: 1 }), (error) => {
    assert.equal(error.code, 'CONFIG_STORAGE_UNAVAILABLE');
    assert.equal(error.status, 503);
    return true;
  });
});

test('putGlobalConfig 在 KV 写入失败时报错', async () => {
  const env = { KV: { async put() { throw new Error('kv down'); } } };
  await assert.rejects(putGlobalConfig(env, { a: 1 }), (error) => {
    assert.equal(error.code, 'CONFIG_WRITE_FAILED');
    assert.equal(error.status, 502);
    return true;
  });
});

test('putGlobalConfig 成功时写入序列化配置', async () => {
  const writes = [];
  const env = { KV: { async put(key, value) { writes.push([key, value]); } } };
  await putGlobalConfig(env, { HOSTS: ['a.com'] });
  assert.deepEqual(writes, [['global_config', '{"HOSTS":["a.com"]}']]);
});

test('getGlobalConfig 在 KV 未绑定时抛出错误', async () => {
  await assert.rejects(getGlobalConfig({}), (error) => {
    assert.equal(error.code, 'KV_NOT_BOUND');
    return true;
  });
});

test('getGlobalConfig 对损坏的 JSON 与缺失 KV 返回空对象', async () => {
  const env = { KV: { async get() { return null; } } };
  assert.deepEqual(await getGlobalConfig(env), {});
  const env2 = { KV: { async get() { return 'not json'; } } };
  assert.deepEqual(await getGlobalConfig(env2), {});
});
