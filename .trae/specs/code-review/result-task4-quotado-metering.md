# EdgeTunnel Core 代码审查 - Task 4 结果：正确性审查 - QuotaDO 配额与计量

## 一、文件覆盖

| # | 文件 | 结论 |
|---|------|------|
| 1 | [usage/quota-do.js](file:///workspace/src/usage/quota-do.js) | 有问题（4 项） |
| 2 | [usage/meter.js](file:///workspace/src/usage/meter.js) | 有问题（2 项） |
| 3 | [usage/repository.js](file:///workspace/src/usage/repository.js) | ✅ 通过 |

---

## 二、发现的问题

### 🔴 CORR-DO-001 High — handleReport /report 中未检查 totalQuota > 0 判断 remaining 的 allowed 逻辑与 handleAdmit 不一致
- **定位**: [quota-do.js#L149-L151](file:///workspace/src/usage/quota-do.js#L149-L151) vs [quota-do.js#L126-L127](file:///workspace/src/usage/quota-do.js#L126-L127)
- **严重级别**: High
- **影响分析**:
  - **handleAdmit** (L127): `const allowed = s.totalQuota === 0 || remaining > 0;` — totalQuota=0 → allowed=true（无配额→无限）
  - **handleReport** (L150): 同样写法 `const allowed = s.totalQuota === 0 || remaining > 0;`
  - 实际上两者一致。**但 admission/service.js#L44 会在 quotaBytes=0 时跳过 DO 调用**，因此 DO 的 totalQuota=0 语义其实不被数据面用到，仅用于 snapshot。真正问题在 CORR-DO-002。
  - 但如果管理员把用户配额从 100GB → 0（想改无限），DO 的 totalQuota=0 之后，任何 todayUsed 累加都 allowed=true，用户确实无限。但 admission 层 quotaBytes=0 skip DO → resetVersion 不从 DO 取，可能是旧值 → 踢线链路 broken。见 SEC-ADM-001。

### 🔴 CORR-DO-002 High — handleReport delta 无上下界检查：负数 delta 可反向抵消流量，NaN/Infinity 写入 todayUsed 使 DO 进入异常状态
- **定位**: [quota-do.js#L133-L144](file:///workspace/src/usage/quota-do.js#L133-L144)
- **严重级别**: High
- **代码**:
  ```javascript
  const body = await request.json().catch(() => ({}));
  const delta = Number(body.delta) || 0;
  const resetVersion = Number(body.resetVersion) || 0;
  // ...
  s.todayUsed += delta;  // ← delta 可能为负、NaN、Infinity
  await this.state.storage.put('quota', s);
  ```
- **影响分析**:
  - `Number("-1") || 0` = **-1** （不被 0 拦截，因为 -1 truthy）
  - 恶意用户构造 `{"delta": -100000000000}` 上报 → todayUsed 减少 100GB，抵消真实用量 = **配额绕过漏洞**
  - `Number("NaN")` 是 NaN，`NaN || 0` = 0 ✅ 安全
  - `Number("1e1000")` 是 Infinity，`Infinity || 0` = Infinity → todayUsed += Infinity → storage.put 写入 Infinity → JSON.stringify 后 todayUsed 变成 `null` → 下次 loadState Number(null)=0 → 今天归零 = **配额被重置为 0 无限用**
- **修复建议**: 在 L135 后立即增加：
  ```javascript
  const delta = Number(body.delta) || 0;
  if (!Number.isSafeInteger(delta) || delta < 0 || delta > 1_000_000_000) return json({ error: 'INVALID_DELTA' }, 400);
  ```

### 🟡 CORR-DO-003 Medium — 预算下推公式 `Math.min(remaining, Math.max(remaining*0.9, 100MB))` 当 remaining 很小时会给出大于 remaining 的 budget
- **定位**: [quota-do.js#L129](file:///workspace/src/usage/quota-do.js#L129) + [quota-do.js#L151](file:///workspace/src/usage/quota-do.js#L151)
- **严重级别**: Medium
- **数学推导**: 当 remaining < ~111MB 时：
  - remaining=50MB → max(50*0.9=45MB, 100MB) = 100MB → min(50, 100) = 50MB ✅ 被 min 截断，没事
  - 但实际上：`Math.max(remaining*0.9, 100*1024*1024)` 当 remaining < ~111MB 时返回 100MB，min(remaining, 100MB)=remaining。预算 = remaining
  - 结果：budget ≈ remaining，meter.counted >= budget 阈值 = remaining，触发 flush 时基本快耗尽，256KB flushThreshold 兜底仍在，**不会造成超额**，但预算下推的 "只取 90% 留缓冲" 语义在小 remaining 时失效。
- **修复建议**: `Math.floor(Math.min(remaining * 0.9, 100*1024*1024))` 去掉外层 Math.min(remaining, ...) 冗余，或直接 `remaining > budget ? remaining : budget` 简化。

### 🟡 CORR-DO-004 Medium — maybeRollover 仅在 loadState 时调用，如果 DO 实例 24h+ 未接到任何 RPC 则日切不执行，todayUsed 跨天累计
- **定位**: [quota-do.js#L44-L49](file:///workspace/src/usage/quota-do.js#L44-L49) + [quota-do.js#L68-L120](file:///workspace/src/usage/quota-do.js#L68-L120)
- **严重级别**: Medium
- **影响分析**: DO 实例是按需冷启动，且空闲可能被回收。但长期不回收的 DO（用户每 3 天用一次，但实例一直驻留）且在 UTC 00:00 前后无 RPC 触发时，todayUsed 会跨天保留。例如 31 号 23:59 用了 5GB，8 月 1 号 00:05 第一次 RPC 触发 loadState → maybeRollover → 才执行对账并入 history。理论上驻留期间如果 UTC 日切发生过，应该 rollover。Durable Object 有 `alarm()` API，可设置定时触发器，但本项目未使用。
- **实际风险**: 很低，因为：① DO 空闲通常会被 Cloudflare 回收，下次请求必然冷启动 → loadState → maybeRollover；② 即使驻留跨天，下一次 RPC 进入的第一步都是 handleXxx → loadState() → maybeRollover → 立即纠正。最多延迟数小时才会发生跨天但无 RPC（罕见场景）。
- **修复建议**（可选，Low）：在 `syncToKV` 或其他高频路径中顺带检查 lastRollover，而不仅在 loadState 时。或者使用 DO Alarm：在 constructor 中设 `this.state.storage.setAlarm(Date.now() + 25*60*60*1000)`（25h 后），alarm 回调执行 maybeRollover。

### 🟡 CORR-METER-001 Medium — meter add() 中 budget > 0 && counted >= budget 触发 schedule()，但如果 flush 网络异常 pending 回滚，counted **不会回滚**，下一次 add 可能 counted 已达阈值但 pending 很小不触发 flush
- **定位**: [meter.js#L51-L63](file:///workspace/src/usage/meter.js#L51-L63) + [meter.js#L34-L39](file:///workspace/src/usage/meter.js#L34-L39)
- **严重级别**: Medium
- **影响分析**:
  - counted 是 "累计已通过 add() 计入的字节数"，只增不减
  - flush 异常回滚：`pendingUpload += upload`（只恢复 pending），但 counted 未回滚
  - 场景：budget=100MB，counted=99MB，add 1.5MB → counted=100.5MB ≥100 → schedule() → flush 失败 → pendingUpload 回滚（1.5MB 回到 pending），**counted 仍 100.5MB**
  - 后续 add 1KB：counted=100.5MB+1KB ≥100MB 再触发 schedule()？✅ 是的，因为 budget >0 条件仍满足。实际无 bug，只是重复调度。
  - **真正问题**: 如果 budget 被 result.budget 更新后变大（DO 续费时 set-quota 调大 totalQuota），此时 counted ≥ old budget 但远小于 new budget，add 仍会继续频繁调度 flush。轻微性能浪费。
- **修复建议**（Optional，Low）：在 setBudget() 中调整 counted，或用 "已上报累计" 单独追踪。

### 🟢 CORR-METER-002 Low — meter.flush finally 中 needsReschedule 再调 ctx.waitUntil(flush())，如果 flush() 持续失败可能链式调度无限 waitUntil
- **定位**: [meter.js#L41-L47](file:///workspace/src/usage/meter.js#L41-L47)
- **严重级别**: Low
- **代码**:
  ```javascript
  .finally(() => {
    flushing = null;
    if ((pendingUpload !== 0 || pendingDownload !== 0) && !needsReschedule) {
      needsReschedule = true;
      if (ctx?.waitUntil) ctx.waitUntil(flush());
    }
  })
  ```
- **影响分析**: needsReschedule 作为 "单次重调度开关" 在 flushing 开始时被置 false，finally 中如果还有 pending 且未重调度过，才触发。所以只重调度 1 次，不会无限递归。✅ 实际上安全。
- **轻微问题**: ctx.waitUntil 中的 flush() 如果失败会抛异常，需要 `.catch(() => {})` 防止 unhandled rejection。当前 flush() 内部有 catch 并 break，所以实际不会抛，但在 finally 中的 waitUntil Promise 若内部有未捕获异常会造成 Worker event `unhandledrejection`。
- **修复建议**: `ctx.waitUntil(flush().catch(() => {}))` 加 catch 兜底。

---

## 三、专项检查结论（Checkpoint 15-20）

### Checkpoint 15 — 预算下推公式 ✅ 有最小兜底
- 位置: [quota-do.js#L129](file:///workspace/src/usage/quota-do.js#L129)
- 公式: `budget = s.totalQuota > 0 ? Math.min(remaining, Math.max(remaining * 0.9, 100*1024*1024)) : 0;`
- 结论: remaining*0.9 或 100MB，取较大者；再 min(remaining) 截断。✅ 最小预算兜底 100MB（remaining ≥100MB 时），否则就是 remaining 本身。

### Checkpoint 16 — meter flush 双重触发 ✅ 两处均存在
- **触发条件 1 (budget)**: [meter.js#L58-L61](file:///workspace/src/usage/meter.js#L58-L61) `budget > 0 && counted >= budget`
- **触发条件 2 (256KB 阈值)**: [meter.js#L62](file:///workspace/src/usage/meter.js#L62) `pendingUpload + pendingDownload >= flushThreshold` (flushThreshold 默认 256×1024)
- 结论: 双重触发完整。任何一条满足立即 schedule()。

### Checkpoint 17 — resetVersion 踢线链路 ✅ 完整
```
admission → DO /admit 返回 resetVersion (s.resetVersion) [quota-do.js#L130]
  → session.resetVersion [admission/service.js#L65]
    → createUsageMeter({resetVersion}) [pipeline.js#L15-L21]
      → flush POST /report body.resetVersion [meter.js#L29]
        → DO handleReport: resetVersion !== s.resetVersion → allowed:false, 403 [quota-do.js#L141]
          → meter throw UsageLimitError() [meter.js#L32]
            → pipeline catch → transport.close() [pipeline.js#L24]
```
链路完整。⚠️ **例外**: quotaBytes=0 时 admission 跳过 DO 调用，resetVersion 返回默认值 0，踢线失效（已作为 SEC-ADM-001 High 报告）。

### Checkpoint 18 — maybeRollover 5 步对账 ✅ 顺序正确
1. doTotal 计算: [quota-do.js#L73](file:///workspace/src/usage/quota-do.js#L73)
2. 读 KV/D1 对比: [quota-do.js#L78-L91](file:///workspace/src/usage/quota-do.js#L78-L91)
3. 不一致 DO 覆盖写 KV/D1: [quota-do.js#L93-L103](file:///workspace/src/usage/quota-do.js#L93-L103)
4. historyUsed=doTotal; todayUsed=0; lastRollover=today: [quota-do.js#L106-L108](file:///workspace/src/usage/quota-do.js#L106-L108)
5. 再写一次 KV/D1: [quota-do.js#L111-L119](file:///workspace/src/usage/quota-do.js#L111-L119)

### Checkpoint 19 — /report 并发串行化 ✅ 基本正确
- DO 实例本身单线程串行，fetch handler 不可能并发进入
- `s.todayUsed += delta` 使用 `+=` 数字操作符，JavaScript 数字原子
- 后面立即 `await storage.put('quota', s)` → 无读改写间隔
- ⚠️ 唯一缺陷: delta 值未校验（见 CORR-DO-002），与并发无关但为正确性漏洞。

### Checkpoint 20 — flush 异常 pending 回滚 ✅ 存在；finally 上报忽略异常 ✅
- 网络异常 pending 回滚: [meter.js#L34-L39](file:///workspace/src/usage/meter.js#L34-L39)
  ```javascript
  } catch (error) {
    if (error instanceof UsageLimitError) throw error;
    pendingUpload += upload;   // ← 回滚
    pendingDownload += download;
    break;
  }
  ```
- finally flush 忽略异常不阻塞: [pipeline.js#L23-L25](file:///workspace/src/proxy/pipeline.js#L23-L25) `.finally(() => meter.flush())` — meter.flush() 本身不会抛异常（内部 catch break），异常被吞，✅ 不阻塞。

---

## 四、问题汇总统计

| 严重级别 | 数量 | 编号 |
|---------|------|------|
| 🔴 High | **2** | CORR-DO-001, CORR-DO-002 |
| 🟡 Medium | **3** | CORR-DO-003, CORR-DO-004, CORR-METER-001 |
| 🟢 Low | **1** | CORR-METER-002 |
| ℹ️ Info | **0** | — |
| **合计** | **6** | |
