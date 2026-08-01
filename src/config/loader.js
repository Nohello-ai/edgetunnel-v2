import { AppError } from '../core/errors.js';

export async function getGlobalConfig(env) {
  if (!env.KV) return {};

  try {
    const value = await env.KV.get('global_config', 'text');
    return parseJson(value, {});
  } catch {
    return {};
  }
}

export async function putGlobalConfig(env, config) {
  if (!env.KV) throw new AppError('CONFIG_STORAGE_UNAVAILABLE', 503, 'KV 未绑定，配置无法保存');

  try {
    await env.KV.put('global_config', JSON.stringify(config));
  } catch (error) {
    throw new AppError('CONFIG_WRITE_FAILED', 502, `配置写入失败: ${error.message}`);
  }

  return config;
}

function parseJson(value, fallback) {
  if (!value) return fallback;

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
