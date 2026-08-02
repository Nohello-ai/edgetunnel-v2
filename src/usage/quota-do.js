/**
 * Quota Durable Object — 连接注册中心 + stop 标志管理。
 *
 * 每个 UUID 对应一个 DO 实例（以 user_id 作为 Object ID）。
 * 改造后职责：
 *   ① stopVersion 管理 — 管理层封禁/超限时递增，活跃连接下次检查时发现并断开
 *   ② 每日 Alarm — 25 小时兜底 alarm，无实际清理逻辑（stopVersion 是持久化的）
 *
 * 移除的职责：
 *   - 流量计数（改用传输层本地变量 + Service Binding 攒批上报）
 *   - 配额存储（改用管理层 D1）
 *   - 配额判断（改由管理层决策）
 *   - D1/KV 对账（不再需要，D1 是唯一真相源）
 *
 * 对外接口（fetch RPC）：
 *   GET  /status     → { stopVersion }
 *   POST /stop       → 递增 stopVersion，活跃连接下次检查时断开
 *   POST /set-quota  → 保留接口（no-op，DO 不再存储配额）
 *   GET  /snapshot   → { stopVersion }（兼容旧调用方）
 */

export class QuotaDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.state.storage.setAlarm(Date.now() + 25 * 60 * 60 * 1000).catch(() => {});
  }

  async alarm() {
    // 25 小时兜底 alarm：无实际清理逻辑，续设下一个
    this.state.storage.setAlarm(Date.now() + 25 * 60 * 60 * 1000).catch(() => {});
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === '/status' && request.method === 'GET') return await this.handleStatus();
      if (path === '/stop' && request.method === 'POST') return await this.handleStop();
      if (path === '/set-quota' && request.method === 'POST') return await this.handleSetQuota();
      if (path === '/snapshot' && request.method === 'GET') return await this.handleSnapshot();
      return json({ error: 'NOT_FOUND' }, 404);
    } catch (error) {
      return json({ error: error.code || 'INTERNAL_ERROR', message: error.message }, 500);
    }
  }

  async loadState() {
    const stored = await this.state.storage.get('state');
    if (stored) return stored;
    const fresh = { stopVersion: 0 };
    await this.state.storage.put('state', fresh);
    return fresh;
  }

  async handleStatus() {
    const s = await this.loadState();
    return json({ stopVersion: s.stopVersion });
  }

  async handleStop() {
    const s = await this.loadState();
    s.stopVersion += 1;
    await this.state.storage.put('state', s);
    return json({ ok: true, stopVersion: s.stopVersion });
  }

  async handleSetQuota() {
    // 保留接口：DO 不再存储配额，配额在管理层 D1 中
    return json({ ok: true });
  }

  async handleSnapshot() {
    const s = await this.loadState();
    return json({ stopVersion: s.stopVersion });
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
