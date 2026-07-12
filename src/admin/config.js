// admin/config.js — KV 配置管理
//
// 提供 readConfigKV 函数，从 KV 读取/重置配置，合并默认值

import { md5md5 } from '../utils.js';

export async function readConfigKV(env, hostname, userID, UA, reset = false) {
  const defaults = {
    TIME: new Date().toISOString(),
    HOST: hostname,
    HOSTS: [hostname],
    UUID: userID,
    协议类型: 'vless',
    传输协议: 'ws',
    gRPC模式: 'gun',
    gRPCUserAgent: 'Mozilla/5.0',
    跳过证书验证: false,
    启用0RTT: true,
    TLS分片: 'Shadowrocket',
    随机路径: false,
    ECH: false,
    ECHConfig: { DNS: 'https://doh.cmliussss.net/CMLiussss', SNI: null },
    SS: { 加密方式: 'aes-128-gcm', TLS: true },
    Fingerprint: 'chrome',
    优选订阅生成: {
      local: true,
      本地IP库: { 随机IP: true, 随机数量: 16, 指定端口: -1 },
      SUB: null,
      SUBNAME: 'edgetunnel',
      SUBUpdateTime: 6,
      TOKEN: await md5md5(hostname + userID),
    },
    订阅转换配置: {
      SUBAPI: 'https://subapi.cmliussss.net',
      SUBCONFIG: 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/refs/heads/master/Clash/config/ACL4SSR_Online_Mini_MultiMode.ini',
      SUBEMOJI: false,
      SUBLIST: false,
    },
    CF: {
      Email: null,
      GlobalAPIKey: null,
      AccountID: null,
      APIToken: null,
      UsageAPI: null,
      Usage: { success: false },
    },
    PATH: '/',
    完整节点路径: '/?ed=2560',
    LINK: '',
    加载时间: '0ms',
  };

  if (reset) {
    if (env.KV?.put) await env.KV.put('config.json', JSON.stringify(defaults, null, 2));
    return defaults;
  }
  if (env.KV?.get) {
    try {
      const saved = await env.KV.get('config.json');
      if (saved) return { ...defaults, ...JSON.parse(saved) };
    } catch (_) {}
  }
  return defaults;
}