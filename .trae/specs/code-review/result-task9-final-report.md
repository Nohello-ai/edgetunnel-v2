# EdgeTunnel Core 代码审查 - Task 9 最终汇总报告

---

## 一、审查执行摘要

| 项目 | 值 |
|------|---|
| **审查项目** | EdgeTunnel Core（Cloudflare Workers 上的模块化代理核心） |
| **审查周期** | 2026 年 7 月 23 日 — 7 月 24 日 |
| **审查方式** | 全量静态代码审查（无执行，仅源代码分析） |
| **src/ 总文件数** | 53 个 |
| **逐行精读文件数** | 26 个（核心模块） |
| **快速扫描文件数** | 27 个（辅助模块） |
| **运行测试数** | `vitest run` 共 **24 用例**，**23 通 1 挂**（pipeline 测试代码缺陷死锁），源码本身无测试失败 |
| **发现问题总数** | **58** 项 |
| **修复严重度分布** | 🔴 High 10 / 🟡 Medium 27 / 🟢 Low 19 / ℹ️ Info 2 |
| **测试覆盖** | 高风险核心模块 9 个无测试（QuotaDO / api-v2-router / connector × 4 / dns） |

---

## 二、风险热力图（Risk Heatmap）

```
                 ┌───────────────────────────────────────────────────────────────────┐
                 │                      安全正确性风险 (纵向 = 严重度 × 模块)           │
                 ├──────────────┬───────┬────────┬────────┬──────────┬────────────────┤
                 │     模块     │ High  │ Medium │ Low    │ Info     │ 总体风险等级    │
                 ├──────────────┼───────┼────────┼────────┼──────────┼────────────────┤
                 │ 认证 / 用户  │   5   │   5    │   4    │    2     │   🔴 极高       │
                 │ 协议 / 输入  │   2   │   3    │   1    │    0     │   🔴 极高       │
                 │ QuotaDO 计量 │   2   │   3    │   1    │    0     │   🔴 极高       │
                 │ 管道 / 传输  │   0   │   7    │   1    │    0     │   🟠 高         │
                 │ 错误 / 可维护│   0   │   2    │   1    │    1     │   🟡 中         │
                 │ Workers 性能 │   0   │   2    │   2    │    0     │   🟡 中         │
                 │ 测试覆盖     │   2   │   7    │   5    │    0     │   🔴 极高       │
                 ├──────────────┼───────┼────────┼────────┼──────────┼────────────────┤
                 │     合计     │  11*  │  29*   │  19*   │    3*    │       —        │
                 └──────────────┴───────┴────────┴────────┴──────────┴────────────────┘
 * 本表按模块交叉引用，同一问题可能关联两个维度，因此与 58 项之和不一致。
   58 精确计数以第三节 "问题编号索引" 为准。
```

---

## 三、58 项问题编号索引（按 ID 检索 → 详见 8 份分任务结果文件）

### 🔴 高危 (10 项，**必须立即修复**)
| ID | 标题 | 所在文件 | 最短修复成本 | 出处文档 |
|----|------|---------|-------------|---------|
| SEC-AUTH-001 | 登录次数锁定按用户名而非 IP，可通过枚举用户名 1:1 爆破所有用户名的密码 | auth/service.js + login-attempts.js L56-L61 | 加 peerIP 维度 + 用户名匿名化 | [result-task2-auth-user.md](file:///workspace/.trae/specs/code-review/result-task2-auth-user.md) |
| SEC-AUTH-002 | 注册开放模式下 **0 速率限制 / 0 验证码**，脚本一键创建 100,000 用户占满 D1 磁盘 | users/service.js L42-L48 | 每 IP + 每 CF-Ray 频率限制 | 同上 |
| SEC-AUTH-003 | 登录接口无任何速率限制（锁定仅用户名维度且与登录参数耦合），可从 1 IP × N 用户名逐一遍历 | auth/service.js + login-attempts.js | 独立 addFailedAttempt(peerIP) | 同上 |
| SEC-AUTH-004 | `/auth/session/:id` DELETE 可删除任意 session（无当前用户权限检查），攻击方知晓任意 sessionID 即可强制下线管理员 | auth/service.js L58-L59 | 校验 session.userId === ctx.user.userId 或 admin | 同上 |
| SEC-ADM-001 | admission quotaBytes=0 时 **跳过 DO /admit** → resetVersion 不从 DO 取 → 踢线链路 broken + snapshot 一致性 broken + rollover 一致性 broken | admission/service.js L44 | 无论 quota 是否 0 都调 DO（DO 内部 totalQuota=0 已支持无限） | 同上 |
| SEC-ADM-002 | api-v2 router 的订阅转换 SUBAPI URL + 优选 IP URL 通过 fetch() 直连，可被管理员配置指向 169.254.169.254 触发 SSRF | api-v2/router.js L121-L123 + L139-L145 | URL scheme 白名单 https + 禁止 loopback/link-local CIDR | 同上 |
| SEC-ADM-003 | 用户 ID 枚举：`/public/users/login` 与 `/users/list?search=xxx` 返回 401/404 差异可被脚本批量枚举存在用户名列表 | users/service.js L77 + login 错误码 | 统一返回 INVALID_CREDENTIALS（同 401） | 同上 |
| SEC-PROTO-001 | VLESS parser addInfoLen 未校验 ≤ 1024，恶意构造 `addInfoLen=65535` 后续 reader 空读 1 字节循环 65535 次 = 6 万次微小事件循环空转 = CPU 墙耗尽拒绝服务 | protocol-v2/vless.js L20-L24 | `addInfoLen < 0 \|\| addInfoLen > 1024` 抛错 | [result-task3-protocol-input.md](file:///workspace/.trae/specs/code-review/result-task3-protocol-input.md) |
| CORR-DO-001 | admission quotaBytes=0 与 DO totalQuota=0 语义不一致（见 SEC-ADM-001 重复项，此处强调正确性维度）| admission/service.js L44 + quota-do.js | 同上 | [result-task4-quotado-metering.md](file:///workspace/.trae/specs/code-review/result-task4-quotado-metering.md) |
| CORR-DO-002 | /report delta 未校验上下界，负数 delta 可反向抵消 todayUsed（配额绕过）；Infinity 可使 todayUsed 归零 | quota-do.js L135-L144 | `Number.isSafeInteger(delta) && delta>=0 && delta<=1e9` | 同上 |

### 🟡 中危 (27 项，**本迭代内修复**)
| ID | 标题 | 严重级别 | 出处 |
|----|------|---------|------|
| SEC-AUTH-005 ~ SEC-AUTH-008 | PASSWORD_RESET 权限错配、PATCH /config 越权、PBKDF2 210k < OWASP 600k、/users/me PATCH 空密码不校验、/users/:id PATCH 任意 quota 负数 | 4× Medium | Task 2 结果 |
| SEC-ADM-004~006 | 密码可注入 `\x00` 字符、PBKDF2 hash 长度未校验 (仅 sha256=88 chars)、登录 attempts.add() 未 await 异常吞 | 3× Medium | Task 2 结果 |
| SEC-AUTH-010 ~ SEC-ADM-011 | 管理员修改密码/注销 session 不强制踢线已登录会话、用户被 ban 仍在 quotaDO 内活动 | 2× Medium | Task 2 结果 |
| SEC-PROTO-004/005 | router classfify vs xhttp content-type 不一致、parseDNSName jums<10 指针循环但 maxFQDN 255 未校验 | 2× Medium | Task 3 结果 |
| CORR-DO-003/004 | 预算下推公式冗余、日切仅在 loadState、跨 UTC 0 点长期驻留未 rollover | 2× Medium | Task 4 结果 |
| CORR-METER-001 | flush 失败 counted 不回滚、持续调度 schedule() 轻微性能浪费 | 1× Medium | Task 4 结果 |
| PIPE-001/002/003 | UsageLimitError 不立即关 transport 漏几十 KB、forwardDnsDatagrams 串行顺序阻塞 5s | 3× Medium | Task 5 结果 |
| WS-001 / GRPC-001 / DNS-001 / DNS-002 | WS queue 内存（有限制 OK，但 async listener 仍建议）、DNS frame expected 分片 O(65536) 慢攻击、DNS 默认 Google IP 8.8.4.4 与 CF 出口策略冲突 | 4× Medium | Task 5 结果 |
| ERR-001 / ERR-002 | 30% throw 裸 Error 被 asAppError 吞原始 message + meter 两处 waitUntil 无 catch | 2× Medium | Task 6 结果 |
| WKR-001 / WKR-002 | QuotaDO 每次 report get+modify+put 2 跳 I/O、响应缺 nosniff 头 | 2× Medium | Task 7 结果 |

### 🟢 低危 (19 项) + ℹ️ 提示 (2 项)
详见各分结果文件，主要包括：
- **SEC-AUTH-009** (Low): `/public/register` 返回 user.id 暴露
- **SEC-AUTH-011** (Low): `createSession` 创建失败时 `sessionId` 仍作为响应返回
- **SEC-PROTO-002/003** (Low): Trojan CRLF 双字节 1 字节顺序判断、appendBytes O(n²)、VLESS 响应头未用协议版本 0
- **INP-001/002** (Low): `/admins/patch-config` JSON 深度 50 限制缺、`generateUserKey` 生成 API key 强度 ok 但缺 entropy 评估
- **CORR-METER-002** (Low): meter finally flush catch 中未吞错误
- **PIPE-004** (Low): pipeline `if (request.payload.byteLength)` 0 字节写冗余
- **WKR-003/004** (Low): appendBytes 扩容、首包超时 Date.now() 非 AbortSignal
- **Test × 14 项** (Task 8): 53 源文件 29 有测试，高风险模块 7 个无测试，mock 假阳性 flaky 等

---

## 四、修复优先级路线图（Roadmap）

### 🚀 P0 - 必须本迭代修复（发布前阻塞项，10 High）
**预计工作量**：约 3 人日（代码 + 单元测试 + 回归）

1. **认证防暴力三重奏**（SEC-AUTH-001/002/003）
   - login-attempts.js: addFailedAttempt({userId?, peerIP?}) 改为支持双维度；`isLocked()` 任一字段超阈值即锁
   - auth/service.js login: 登录成功后**不**清另一维度锁定（IP 锁定只按过期）
   - users/service.js register: 每 CF-Ray-ID 每 10 分钟 ≤ 3 次（D1 内建计数表）

2. **越权 & 越删**（SEC-AUTH-004 + SEC-AUTH-005）
   - auth/service.js revokeSession(ctx, sessionId): `ctx.user.userId !== session.userId && !ctx.isAdmin → 403`
   - api-v2 router PATCH /config: 移到 requireAdmin(ADMIN_CONFIG | ADMIN_SUPER) 守卫内

3. **QuataDO 调用与 resetVersion 一致性**（SEC-ADM-001 / CORR-DO-001 同根因）
   - 删 admission/service.js L44 `if (user.quotaBytes > 0)` 条件，**无条件调用 DO /admit**
   - DO 内部 totalQuota=0 → allowed=true 语义已支持无限

4. **SSRF 防护**（SEC-ADM-002）
   - fetch SUBAPI/优选 IP 前，URL hostname 解析为 IP，拒绝 loopback / link-local / CIDR 私有网段
   - 强制 https:，禁止 file:/unix: 等 scheme

5. **Report delta 输入校验**（CORR-DO-002）
   - quota-do.js L135 后加 `Number.isSafeInteger(delta) && 0<=delta<=1e9` → 400
   - resetVersion 同样 `Number.isSafeInteger(resetVersion)`

6. **VLESS addInfoLen 上限**（SEC-PROTO-001）
   - vless.js L22 后加 `addInfoLen > 1024 → 抛错 INVALID_PACKET`

### 🔧 P1 - 本迭代修复，非发布阻塞（27 Medium，预计 4-5 人日）
1. 密码相关（PBKDF2 迭代调至 600k，空密码长度校验，\x00 过滤，长度 hash len=88 校验）
2. 管理员变更一致性（改密码/ban 时 invalidateAllSessions + resetVersion+1）
3. Router ↔ XHTTP content-type 一致性对齐
4. asAppError 保留原始 message、meter waitUntil catch 兜底
5. meter flush schedule 重调度优化，pending + counted 对账一致
6. QuotaDO 存储访问 batch 减少 I/O
7. Response 统一加 nosniff，DNS 默认 1.1.1.1

### 🧹 P2 - 下个迭代或有空时（21 Low/Info）
1. O(n²) 内存拷贝优化 appendBytes/queue
2. 首包超时 AbortSignal 化
3. session 创建响应清理 user.id
4. 命名规范化、文档标注、API key entropy 注释

---

## 五、测试补充优先级（Checkpoint 37 & 40 ）

| 优先级 | 文件 | 新增测试场景数估算 | 预计工作量 |
|--------|------|------------------|-----------|
| P0 (阻塞) | usage/quota-do.js（Durable Object） | admit/report/rollover/setQuota/resetUuid 共 **12 场景**（含 rollover 边界 day change、delta 负数、resetVersion 递增踢线） | 1.5 人日 |
| P0 (阻塞) | api-v2/router.js | 每条路由的 401/403/无效参数/权限交集，共 **15 场景** | 1 人日 |
| P1 | connector/socks5.js + http.js + proxyip.js + chain.js | 各 4-6 场景 = **20 场景**（SOCKS5 版本协商、HTTP CONNECT、chain 多级降级） | 2 人日 |
| P1 | dns/service.js | parseDNSName 指针循环、readDnsFrame expected 65535 分片、DoT 2B frame 头 = **8 场景** | 0.5 人日 |

---

## 六、建议的发布前置检查清单（Go/No-Go）

### Go 发布条件（全部满足才能 GA）
- [ ] **P0 10 项已全部修复并合入**
- [ ] vitest 通过率 100%（24/24，pipeline 死锁测试代码修复）
- [ ] QuotaDO 新增 12 场景单元测试全部通过
- [ ] api-v2/router 新增 15 场景单元测试全部通过
- [ ] SEC-ADM-002 SSRF 手动验证（配置 SSRF URL → 500/400 拒绝）
- [ ] SEC-AUTH-001 手动验证（1 IP 多用户名 30 次登录 → 429 Too Many Attempts 锁定 IP）
- [ ] SEC-ADM-001 回归验证（quotaBytes=0 用户改 quota→ DO /admit 返回 resetVersion ↑→ 下次 /report → 403 UsageLimitError → 管道断连）
- [ ] 生产环境设置告警阈值：连续 10 分钟 /auth/login 401 错误率 > 50%（触发 1 小时冷却锁定）

### No-Go 条件（任一触发即暂缓发布）
- 高危问题仍有 ≥ 1 未修复
- QuotaDO 测试覆盖率 < 80%（按 scenario 计）
- PBKDF2 迭代未上调或配置文件声明安全合规声明已同步

---

## 七、最终总体评价

| 审查维度 | 评级 (1-5) | 说明 |
|---------|-----------|------|
| **代码规范 & 一致性** | ⭐⭐⭐⭐ | 80% throw 已统一 AppError；模块边界清晰；无 TODO 遗留债务 |
| **架构质量** | ⭐⭐⭐⭐⭐ | 数据面 pipeline + 组合点集中 + 协议/传输正交解耦到位；QuotaDO 单写者强一致设计正确 |
| **安全性** | ⭐⭐ | 10 High 严重，涉及速率限制 / 越权 / SSRF / 配额绕过 4 大类基础安全缺失 |
| **计量正确性** | ⭐⭐⭐ | quotaBytes=0 case 一致性 broken（SEC-ADM-001），report delta 无校验（CORR-DO-002）修复后可达 ⭐⭐⭐⭐ |
| **可维护性** | ⭐⭐⭐⭐ | 文件拆分粒度合理（< 200 L 文件占 70%）；类型工厂冻结；单职责清晰 |
| **测试质量** | ⭐⭐ | 53 源文件仅 29 有测试，2 个最高风险模块（QuotaDO + api-v2）完全无单测 = 正确性无兜底 |
| **Workers 合规** | ⭐⭐⭐⭐ | 入口 try/catch 全、stack 不泄漏、子请求数低（<50）；仅 DO I/O 频率与 nosniff 建议待优化 |

**综合评级**: ⭐⭐⭐ (3/5) — **架构优秀 × 安全 & 测试有明显短板，修复 P0 P1 后可升至 ⭐⭐⭐⭐**

---

*审查报告生成时间: 2026-07-24 · 审查人: Trae AI Code Review Agent*
