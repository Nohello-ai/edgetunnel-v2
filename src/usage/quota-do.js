/**
 * Quota Durable Object — 强一致流量计量与断连裁判。
 *
 * 每个 UUID 对应一个 DO 实例(以 user_id 作为 Object ID)。
 * 同一用户的所有连接请求被路由到同一实例,串行处理,无竞争。
 *
 * State(仅3个数字,每天归零 todayUsed,不会膨胀):
 *   totalQuota    — 套餐总额度(字节),续费时由用户管理更新
 *   historyUsed   — 历史累计已用(不含今天),每天从 D1/KV 校准
 *   todayUsed     — 今天已用,每天 00:00 并入 historyUsed 后归零
 *
 * 对外接口(fetch RPC):
 *   GET  /admit           → 返回 { allowed, remaining, budget, resetVersion }
 *   POST /report { delta }→ 累加 todayUsed,返回 { allowed, remaining, budget }
 *   POST /set-quota { quota } → 更新总额度(续费用)
 *   POST /reset-uuid       → 递增 resetVersion(旧连接下次校验失效)
 *   GET  /snapshot         → 返回 { totalQuota, historyUsed, todayUsed }(面板用)
 */

export class QuotaDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    // 设置 25 小时后的 alarm，确保即使无 RPC 也能触发日切
    this.state.storage.setAlarm(Date.now() + 25 * 60 * 60 * 1000).catch(() => {});
  }

  async alarm() {
    const stored = await this.state.storage.get('quota');
    if (stored) {
      await this.maybeRollover(stored);
      await this.state.storage.put('quota', stored);
    }
    // 续设下一个 alarm
    this.state.storage.setAlarm(Date.now() + 25 * 60 * 60 * 1000).catch(() => {});
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === '/admit' && request.method === 'GET') return await this.handleAdmit();
      if (path === '/report' && request.method === 'POST') return await this.handleReport(request);
      if (path === '/set-quota' && request.method === 'POST') return await this.handleSetQuota(request);
      if (path === '/reset-uuid' && request.method === 'POST') return await this.handleResetUuid();
      if (path === '/snapshot' && request.method === 'GET') return await this.handleSnapshot();
      return json({ error: 'NOT_FOUND' }, 404);
    } catch (error) {
      return json({ error: error.code || 'INTERNAL_ERROR', message: error.message }, 500);
    }
  }

  // ── 内部:加载/校准 ──────────────────────────────────────────

  async loadState() {
    const stored = await this.state.storage.get('quota');
    if (stored) {
      await this.maybeRollover(stored);
      return stored;
    }
    // 冷启动:从 D1 拉历史用量,从 KV 拉 ban 状态
    const userID = this.state.id.name;
    let historyUsed = 0;
    let totalQuota = 0;

    if (this.env.DB) {
      const row = await this.env.DB.prepare('SELECT total, quota_bytes FROM usage u JOIN users ON u.user_id = users.user_id WHERE u.user_id = ?').bind(userID).first().catch(() => null);
      if (row) {
        historyUsed = Number(row.total || 0);
        totalQuota = Number(row.quota_bytes || 0);
      }
    }

    const fresh = { totalQuota, historyUsed, todayUsed: 0, resetVersion: 0, lastRollover: todayUTC() };
    await this.state.storage.put('quota', fresh);
    return fresh;
  }

  async maybeRollover(stored) {
    const today = todayUTC();
    if (stored.lastRollover === today) return;

    const userID = this.state.id.name;
    const doTotal = stored.historyUsed + stored.todayUsed;

    // ── 对账:归零前,用 DO 权威值校验 KV/D1 ──────────────────
    // KV 是每10秒异步写的,可能丢增量;D1 也可能滞后。
    // DO 是权威,不一致就覆盖。
    let kvTotal = null;
    let d1Total = null;

    if (this.env.KV) {
      const raw = await this.env.KV.get(`usage:${userID}`).catch(() => null);
      kvTotal = raw !== null ? Number(raw) : null;
    }
    if (this.env.DB) {
      const row = await this.env.DB.prepare('SELECT total FROM usage WHERE user_id = ?').bind(userID).first().catch(() => null);
      d1Total = row ? Number(row.total || 0) : null;
    }

    const kvMismatch = kvTotal !== null && kvTotal !== doTotal;
    const d1Mismatch = d1Total !== null && d1Total !== doTotal;

    if (kvMismatch || d1Mismatch) {
      // DO 为准,覆盖 KV 和 D1
      if (this.env.KV) {
        await this.env.KV.put(`usage:${userID}`, String(doTotal)).catch(() => {});
      }
      if (this.env.DB) {
        await this.env.DB.prepare('UPDATE usage SET total = ?, updated_at = ? WHERE user_id = ?')
          .bind(doTotal, new Date().toISOString(), userID)
          .run().catch(() => {});
      }
    }

    // ── 归零:把 todayUsed 并入 historyUsed ──────────────────────
    stored.historyUsed = doTotal; // 确保用对账后的权威值
    stored.todayUsed = 0;
    stored.lastRollover = today;

    // 归零后再写一次,确保 KV/D1 与新起点一致
    if (this.env.KV) {
      await this.env.KV.put(`usage:${userID}`, String(stored.historyUsed)).catch(() => {});
    }
    if (this.env.DB) {
      await this.env.DB.prepare('UPDATE usage SET total = ?, updated_at = ? WHERE user_id = ?')
        .bind(stored.historyUsed, new Date().toISOString(), userID)
        .run().catch(() => {});
    }
    await this.state.storage.put('quota', stored);
  }

  // ── RPC handlers ────────────────────────────────────────────

  async handleAdmit() {
    const s = await this.loadState();
    const remaining = s.totalQuota > 0 ? Math.max(0, s.totalQuota - s.historyUsed - s.todayUsed) : 0;
    const allowed = s.totalQuota === 0 || remaining > 0;
    // 预下推预算:给当前连接一个本地计数额度(剩余的 90%,或固定上限取小)
    const budget = s.totalQuota > 0 ? Math.min(remaining, Math.max(remaining * 0.9, 100 * 1024 * 1024)) : 0;
    return json({ allowed, remaining, budget, resetVersion: s.resetVersion });
  }

  async handleReport(request) {
    const body = await request.json().catch(() => ({}));
    const delta = Number(body.delta);
    const resetVersion = Number(body.resetVersion);

    // delta 必须是安全正整数，上限 1GB（单次上报不可能超过）
    if (!Number.isSafeInteger(delta) || delta < 0 || delta > 1_073_741_824) {
      return json({ error: 'INVALID_DELTA' }, 400);
    }
    // resetVersion 必须是安全非负整数
    if (!Number.isSafeInteger(resetVersion) || resetVersion < 0) {
      return json({ error: 'INVALID_RESET_VERSION' }, 400);
    }

    const s = await this.loadState();

    // UUID 已重置,旧连接拒绝
    if (resetVersion !== s.resetVersion) return json({ allowed: false, reason: 'UUID_RESET' }, 403);

    s.todayUsed += delta;
    await this.state.storage.put('quota', s);

    // 每10秒把增量写 KV(供面板展示)
    await this.syncToKV(s, delta);

    const remaining = s.totalQuota > 0 ? Math.max(0, s.totalQuota - s.historyUsed - s.todayUsed) : 0;
    const allowed = s.totalQuota === 0 || remaining > 0;
    const budget = s.totalQuota > 0 && allowed ? Math.min(remaining, Math.max(remaining * 0.9, 100 * 1024 * 1024)) : 0;

    return json({ allowed, remaining, budget });
  }

  async handleSetQuota(request) {
    const body = await request.json().catch(() => ({}));
    const quota = Number(body.quota) || 0;
    const s = await this.loadState();
    s.totalQuota = quota;
    await this.state.storage.put('quota', s);
    return json({ ok: true, totalQuota: quota });
  }

  async handleResetUuid() {
    const s = await this.loadState();
    s.resetVersion += 1;
    await this.state.storage.put('quota', s);
    return json({ ok: true, resetVersion: s.resetVersion });
  }

  async handleSnapshot() {
    const s = await this.loadState();
    return json({
      totalQuota: s.totalQuota,
      historyUsed: s.historyUsed,
      todayUsed: s.todayUsed,
      totalUsed: s.historyUsed + s.todayUsed,
      remaining: s.totalQuota > 0 ? Math.max(0, s.totalQuota - s.historyUsed - s.todayUsed) : 0,
      resetVersion: s.resetVersion,
    });
  }

  // ── KV 同步(增量,每10秒) ────────────────────────────────────

  async syncToKV(state, delta) {
    if (!this.env.KV) return;
    const now = Date.now();
    const last = await this.state.storage.get('lastKVSync') || 0;
    if (now - last < 10_000) return; // 10秒内不重复写

    const userID = this.state.id.name;
    const totalUsed = state.historyUsed + state.todayUsed;
    await this.env.KV.put(`usage:${userID}`, String(totalUsed)).catch(() => {});
    await this.env.KV.put(`usage_delta:${userID}`, String(delta)).catch(() => {});
    await this.state.storage.put('lastKVSync', now);
  }
}

// ── helpers ──────────────────────────────────────────────────

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function todayUTC() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}
