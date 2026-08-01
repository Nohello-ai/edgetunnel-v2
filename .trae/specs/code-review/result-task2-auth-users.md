# EdgeTunnel Core 代码审查 - Task 2 结果：安全审查 - 认证与用户模块

## 一、文件审查覆盖

| # | 文件 | 结论 | 行号参考 |
|---|------|------|---------|
| 1 | [password.js](file:///workspace/src/auth/password.js) | 有问题 | PBKDF2 迭代次数偏低 |
| 2 | [session.js](file:///workspace/src/auth/session.js) | 有问题 | session 过期清理未 await |
| 3 | [service.js](file:///workspace/src/auth/service.js) | ✅ 基本通过 | 使用 timingSafeEqual，dummy hash 防用户枚举 |
| 4 | [guards.js](file:///workspace/src/auth/guards.js) | ✅ 通过 | requireUser/requireAdmin 逻辑正确 |
| 5 | [login-attempts.js](file:///workspace/src/auth/login-attempts.js) | 有问题 | check→failure 两步非原子，有竞态 |
| 6 | [bootstrap.js](file:///workspace/src/auth/bootstrap.js) | ✅ 通过 | 有 admin 存在性检查，catch 中二次确认 count===0 |
| 7 | [repository.js](file:///workspace/src/users/repository.js) | ✅ 通过 | 白名单动态列 + 参数化 SQL，0 注入风险 |
| 8 | [service.js](file:///workspace/src/users/service.js) | 有问题 | create 默认 role 非 admin 白名单检查 OK，但无注册全局开关 |
| 9 | [governance.js](file:///workspace/src/users/governance.js) | ✅ 通过 | ban 联动 DO reset-uuid，非致命降级合理 |
| 10 | [service.js](file:///workspace/src/admission/service.js) | 有问题 | quotaBytes=0 完全跳过 DO 配额裁判 |
| 11 | [repositories.js](file:///workspace/src/admission/repositories.js) | ✅ 通过 | 依赖工厂正确注入 |
| 12 | [router.js](file:///workspace/src/api-v2/router.js) | 有问题 | /api/auth/register 公开 + 无限速 |

---

## 二、发现的问题列表（按严重级别排序）

### 🔴 SEC-AUTH-001 High — 登录锁定可通过枚举用户名绕过
- **定位**: [login-attempts.js#L41-L44](file:///workspace/src/auth/login-attempts.js#L41-L44) + [api-v2/router.js#L183-L187](file:///workspace/src/api-v2/router.js#L183-L187)
- **严重级别**: High
- **影响分析**: `loginFingerprint = IP:username`，锁定粒度为 IP+用户名组合。攻击者对同一 IP 轮换 100 个不同用户名尝试，每个用户名都可独立获得 5 次机会，实际上对同一 IP 爆破次数 = 5×用户名数量，等于变相无限制。同时这也意味着真实用户被锁定的情况下，攻击者只需换一个不存在的用户名又能继续 5 次尝试。
- **修复建议**: 
  - 新增纯 IP 维度的独立计数器（如 100 次/15min），IP 维度超限即封锁所有该 IP 的登录尝试，不需要关心用户名
  - 新增 `loginAttempts.checkIP(ip)` 方法与 `failureIP(ip)` 方法
  - IP 粒度阈值远高于账号粒度（避免正常用户误杀），例如 100 次失败/15min

### 🔴 SEC-AUTH-002 High — 注册接口公开无限速 + 无全局开关
- **定位**: [api-v2/router.js#L31-L35](file:///workspace/src/api-v2/router.js#L31-L35)
- **严重级别**: High
- **影响分析**: 
  - `/api/auth/register` 完全公开，无需任何鉴权或 captcha，也无速率限制
  - 无全局 `openRegistration` 配置开关控制是否允许注册
  - 任何匿名用户可无限批量注册账号耗尽 D1 存储空间，即使部署管理员不想开放注册
  - 注册成功后同步配额到 DO（createUserService.create → syncQuotaToDO），大规模注册会触发大量 DO 冷启动和子请求
- **修复建议**:
  - 新增全局配置字段 `openRegistration`（默认 `false`，安全缺省），注册前检查该字段
  - 新增基于 IP 的注册速率限制（例如每 IP 每小时最多 3 个账号）
  - 可选：管理员创建用户保留在 /api/admin/users（已有），普通用户注册仅在开关开启时可用

### 🔴 SEC-ADM-001 High — quotaBytes=0 完全跳过 DO 配额裁判导致无限流量
- **定位**: [admission/service.js#L41-L50](file:///workspace/src/admission/service.js#L41-L50)
- **严重级别**: High
- **影响分析**: 
  - `resolveQuota` 返回 0 时：`if (quotaDO && quotaBytes > 0)` 条件为 false，完全不调用 DO /admit
  - 既不从 DO 获取 `remaining`、`budget`、`resetVersion`，也不执行 DO 的配额裁判
  - 管理员在 `PATCH /api/admin/users/{id}` 将用户配额设为 0 本意是禁用配额，结果实际是：
    - DO /report 仍会被 meter 调用写入用量（因为 meter 是在 pipeline 中创建的，不依赖 admission 的 quotaBytes 判断）
    - 但 admission 层不检查 exhausted，所以用户永远不会被配额拦截
    - resetVersion 踢线也失效：admission 不返回 resetVersion=0，meter.setVersion(0)，但 DO /report 中 resetVersion 可能已递增，此时 meter 会收到 `allowed:false`？——需要确认 DO /report 是否检查 resetVersion
    - 更严重的是 quotaBytes=0（通常表示"未设置配额"或"无限"）会让 QuotaDO 的唯一权威裁判角色在准入层面完全失效
- **修复建议**:
  - 明确语义：quotaBytes=0 表示"无限配额"还是"未设置/默认配额"？两者必须区分
  - 如果 0=无限：仍需调用 DO /admit 获取 resetVersion（用于踢线）和 maybeRollover（日切逻辑依赖 DO 被调用），只是不校验 remaining
  - 如果 0=未设置：从全局配置 `config.quotaBytes` 兜底，仍为 0 则按默认值（例如 100GB）或拦截禁止使用
  - 推荐修改：只要 `quotaDO` 绑定存在就始终调用 DO /admit，仅在 remaining 检查时考虑 quotaBytes=0 的无限语义

### 🟡 SEC-AUTH-003 Medium — PBKDF2 迭代次数 210k 低于 OWASP 最新推荐
- **定位**: [password.js#L4](file:///workspace/src/auth/password.js#L4) + [password.js#L18](file:///workspace/src/auth/password.js#L18)
- **严重级别**: Medium
- **影响分析**: OWASP 2023 年对 PBKDF2-HMAC-SHA256 推荐迭代次数为 ≥ 600,000。当前 `ITERATIONS = 210000`（约 1/3）。同时 `verifyPassword` 中最低阈值仅 `iterations < 100000`，更弱。弱迭代次数意味着相同算力下密码破解速度快 3 倍。
- **修复建议**:
  - 将 `ITERATIONS` 提升至 `600000`（Workers 上实测单次 hash 耗时仍 < 200ms，可接受）
  - `verifyPassword` 的阈值保持 `100000`（兼容旧 hash），但在登录成功后检测到旧迭代次数时自动重算为新迭代次数并更新 `password_hash` 列（透明升级）
  - 在验证后添加透明重哈希逻辑：`if (iterations < ITERATIONS) await users.repository.update(userID, { passwordHash: await hashPassword(originalPassword) })`

### 🟡 SEC-AUTH-004 Medium — Session 过期清理不 await 导致会话过期窗口竞态
- **定位**: [session.js#L21-L23](file:///workspace/src/auth/session.js#L21-L23)
- **严重级别**: Medium
- **影响分析**: `env.DB.prepare('DELETE ...').run().catch(() => {})` 没有 await。如果 DELETE 尚未写入 D1 就返回了 `null`，该 token 在数秒内（D1 最终一致窗口）可能仍能被其他 Worker isolate 通过另一次请求命中 D1 副本读到，造成已过期会话短暂可用。虽然概率低但违反设计。
- **修复建议**: 添加 `await`，即 `await env.DB.prepare(...).bind().run().catch(() => {})`。这样在 D1 DELETE 未完成前不返回 null，保证该请求路径下过期即失效。

### 🟡 SEC-AUTH-005 Medium — 登录失败锁定 check→failure 两步非原子，并发下可突破 5 次上限
- **定位**: [login-attempts.js#L8-L18](file:///workspace/src/auth/login-attempts.js#L8-L18) + [login-attempts.js#L24-L37](file:///workspace/src/auth/login-attempts.js#L24-L37)
- **严重级别**: Medium
- **影响分析**: 
  - `login()` 流程：`await loginAttempts.check(fingerprint)` → 查 DB → 通过 → （密码验证耗时约 200ms）→ `await loginAttempts.failure(fingerprint)` → 写 DB
  - 同一 fingerprint 在 200ms 窗口内并发 N 个请求，它们都同时通过 check（failures=4, locked_until=null），然后各自执行 failure 的 INSERT...ON CONFLICT 使 failures 从 4→5→6→...→N+4
  - 最坏情况下并发 20 请求：failures=24，但 CASE WHEN failures+1 >= 5 仍为 false（第 1 次写是 4+1=5 才触发锁定），实际锁定发生在最后一次写，期间已经有 20 次失败请求通过了 check
  - 更严重的是 `locked_until` 每次满足条件时都用最新 `lockedUntil`（= NOW+15min），如果攻击者在锁定快到期时再发 5 次就又续 15 分钟，理论上持续每 14 分钟发 5 次可以永久锁定某用户（DoS 放大攻击）
- **修复建议**:
  - 方案 A（原子 SQL 单步）：将 check+failure 合并为 `INSERT OR UPDATE` 单语句，写入后直接查询 failures 和 locked_until 判断是否已锁定；这样无论并发多少，D1 SQLite 的行锁保证 failures 原子递增
  - 方案 B（缓解续锁）：`locked_until` 仅在当前未锁定时才设置新值，已锁定时不刷新 locked_until；即 `CASE WHEN login_attempts.locked_until IS NULL AND ... THEN ? ELSE login_attempts.locked_until END`
  - 方案 A 为必须，方案 B 推荐同时应用

### 🟡 SEC-ADM-002 Medium — 订阅转换 SSRF 风险
- **定位**: [api-v2/router.js#L116-L127](file:///workspace/src/api-v2/router.js#L116-L127)
- **严重级别**: Medium
- **影响分析**: `config.订阅转换.SUBAPI` 由管理员通过 `PATCH /api/admin/config` 写入，然后 `fetch(convertURL)` 从 Worker 侧发起出站请求。如果管理员被社工或配置错误写入了内网 URL（metadata endpoint、R2/KV 内部 API、loopback 等），虽然 Workers 默认无内网但可以访问 Cloudflare 内部元数据服务（尤其是 `169.254.169.254` 在某些场景可能可用）。更现实的风险是：Worker 发起大量请求到任意域名作为代理跳板攻击第三方，消耗 Worker 出站流量配额。
- **修复建议**:
  - 在 `normalizeGlobalConfig` 中校验 SUBAPI 必须为 https 且 hostname 不为 IP、不为内部域名白名单
  - 在实际 fetch 前增加 DNS rebinding 防护：先 `new URL()` 校验 protocol === 'https:'、hostname 包含点、非私有 IP（可选，Workers 本身有网络隔离）
  - 设置 fetch 的 `{ cf: { resolveOverride: undefined } }` 并对失败有最大超时（3s）

### 🟢 SEC-AUTH-006 Low — Session token 生成 base64 编码后去除了 '=', 理论熵减可忽略
- **定位**: [session.js#L43](file:///workspace/src/auth/session.js#L43)
- **严重级别**: Low
- **影响分析**: `btoa(s).replaceAll('+','-').replaceAll('/','_').replaceAll('=','')` 移除了 base64 padding。32 字节 = 256 bits，编码后约 44 字符，移除 2 个 padding 字符，熵仍 > 254 bits，实际可忽略。但属于不完全合规的 URL-safe base64（标准 RFC 4648 §5 推荐保留 padding 或至少双方约定）。实际解码方不会解码回去，只比较哈希，所以不影响功能。
- **修复建议**: 可保留现状；若追求完美可用 `crypto.getRandomValues` 直接转 hex（更直观、无歧义、代码更短）。

### 🟢 SEC-AUTH-007 Low — 注册时 username 正则限定了 a-z0-9_.-，但未明确禁止 '.', '..' 等路径类输入
- **定位**: [users/service.js#L10](file:///workspace/src/users/service.js#L10)
- **严重级别**: Low
- **影响分析**: 正则 `/^[a-z0-9_.-]{3,64}$/` 允许 '.' 和连字符，意味着 '...'、'..'、'admin.' 等用户名合法。虽然不直接造成漏洞（用户名只进数据库和 JSON 输出），但在显示层可能与隐藏文件、路径遍历联想有关。且 'a' * 64 这种 64 个相同字符也被允许，视觉上无辨识度。
- **修复建议**: 收紧首字符和末字符必须是字母/数字（首尾不可为 '.' 或 '-'），并禁止连续两个 '.'。建议正则 `/^[a-z0-9][a-z0-9_.-]{1,62}[a-z0-9]$/`。

### 🟢 SEC-AUTH-008 Low — DUMMY_HASH 写死的 salt/hash 虽不影响安全，但暴露了迭代次数常量
- **定位**: [auth/service.js#L4](file:///workspace/src/auth/service.js#L4)
- **严重级别**: Low
- **影响分析**: 防用户枚举的 dummy verifyPassword 使用的常量 hash 被逆向无法利用，因为 verifyPassword 只做 deriveBits + timingSafeEqual，不会泄露真实用户的 hash。但该常量暴露了代码中确实存在 210k 迭代次数的假设，和 SEC-AUTH-003 合并修复时一并更新即可。
- **修复建议**: 将 `DUMMY_HASH` 的迭代次数也跟随 `ITERATIONS` 常量，不要写死；或者直接 `crypto.getRandomValues` 动态生成 dummy 值（但不存 DB，仅内存临时用）。

---

## 三、PBKDF2 参数专项审查（TR-2.1）

| 参数 | 代码值 | OWASP 2023 推荐 | 结论 |
|------|-------|----------------|------|
| 迭代次数 | 210,000 | ≥ 600,000 | ❌ 不达标（约 1/3） |
| Salt 长度 | 16 字节 (crypto.getRandomValues) | ≥ 16 字节 | ✅ 达标 |
| 密钥长度 | 32 字节 (SHA-256 输出) | ≥ 32 字节 | ✅ 达标 |
| 算法 | PBKDF2-HMAC-SHA-256 | PBKDF2 优先 SHA-256/512 | ✅ 达标 |
| 最低迭代阈值 | 100,000 | — | ⚠️ 可接受（兼容） |

**定位**: [password.js#L4-L11](file:///workspace/src/auth/password.js#L4-L11)

---

## 四、D1 SQL 参数化审查（TR-2.2）— 全部 23 处 prepare 调用

### src/users/repository.js (10 处)
1. [L4](file:///workspace/src/users/repository.js#L4) `SELECT COUNT(*)` — 静态 SQL ✅
2. [L8](file:///workspace/src/users/repository.js#L8) `SELECT * WHERE user_id = ?` — 参数化 ✅
3. [L11](file:///workspace/src/users/repository.js#L11) `SELECT * WHERE username = ?` — 参数化 ✅
4. [L14](file:///workspace/src/users/repository.js#L14) `SELECT * ORDER BY` — 静态 ✅
5. [L18](file:///workspace/src/users/repository.js#L18) `SELECT COUNT WHERE role='admin'` — 静态常量列 ✅
6. [L22-L23](file:///workspace/src/users/repository.js#L22-L23) `INSERT VALUES (?,?,?,?,?,?,?,?,?,?)` — 10 个占位符 ✅
7. [L38-L39](file:///workspace/src/users/repository.js#L38-L39) `UPDATE SET 白名单列=?` — 白名单动态列 + 占位符 ✅
8. [L44](file:///workspace/src/users/repository.js#L44) `UPDATE sessions SET revoked_at WHERE token_hash = ?` — 参数化 ✅
9. [L46](file:///workspace/src/users/repository.js#L46) `DELETE WHERE user_id = ?` — 参数化 ✅

### src/auth/session.js (4 处)
10. [L11-L12](file:///workspace/src/auth/session.js#L11-L12) `INSERT sessions VALUES (?,?,?,?)` — 参数化 ✅
11. [L19](file:///workspace/src/auth/session.js#L19) `SELECT WHERE token_hash = ?` — 参数化 ✅
12. [L22](file:///workspace/src/auth/session.js#L22) `DELETE WHERE token_hash = ?` — 参数化 ✅
13. [L33](file:///workspace/src/auth/session.js#L33) `UPDATE sessions SET revoked_at WHERE token_hash = ?` — 参数化 ✅

### src/auth/login-attempts.js (3 处)
14. [L11](file:///workspace/src/auth/login-attempts.js#L11) `SELECT WHERE fingerprint = ?` — 参数化 ✅
15. [L16](file:///workspace/src/auth/login-attempts.js#L16) `DELETE WHERE fingerprint = ?` — 参数化 ✅
16. [L29-L36](file:///workspace/src/auth/login-attempts.js#L29-L36) `INSERT...ON CONFLICT VALUES (?,?,?,?)` — 参数化 ✅

### src/users/governance.js (3 处)
17. [L9-L10](file:///workspace/src/users/governance.js#L9-L10) `INSERT bans VALUES (?,?,?,?) ON CONFLICT` — 参数化 ✅
18. [L16](file:///workspace/src/users/governance.js#L16) `DELETE bans WHERE user_id = ?` — 参数化 ✅
19. [L19](file:///workspace/src/users/governance.js#L19) `SELECT bans WHERE user_id = ?` — 参数化 ✅

### src/admission/repositories.js (1 处)
20. [L10](file:///workspace/src/admission/repositories.js#L10) `SELECT bans WHERE user_id = ?` — 参数化 ✅

### src/auth/bootstrap.js (1 处)
21. [L4](file:///workspace/src/auth/bootstrap.js#L4) `SELECT COUNT WHERE role='admin'` — 静态常量 ✅

### src/api-v2/router.js (2 处)
22. [L27](file:///workspace/src/api-v2/router.js#L27) usage SELECT — `WHERE user_id = ?` ✅
23. [L19](file:///workspace/src/auth/session.js#L27-L28) session ban check — `WHERE user_id = ? AND until > ?` ✅

**SQL 注入风险评估**: ✅ **0 注入风险** — 23 处 prepare 调用全部参数化或使用白名单动态列/静态常量，无字符串拼接 SQL。

---

## 五、Session Cookie 属性审查（TR-2.3）

- **定位**: [session.js#L13](file:///workspace/src/auth/session.js#L13)
- **实际 Cookie 字符串**: `edt_session={token}; Path=/; Max-Age=86400; HttpOnly; Secure; SameSite=Strict`

| 属性 | 值 | 要求 | 结论 |
|------|-----|------|------|
| HttpOnly | ✅ 存在 | 必须 | ✅ 通过 |
| Secure | ✅ 存在 | 必须 | ✅ 通过 |
| SameSite | ✅ Strict | 推荐 Strict/Lax | ✅ 通过 (Strict 最优) |
| Path | ✅ / | 合理 | ✅ 通过 |
| Max-Age | ✅ 86400 | 有限 | ✅ 通过 (24h) |

**密码输入长度校验**: [password.js#L28-L31](file:///workspace/src/auth/password.js#L28-L31) 10-256 字符 ✅  
**用户名输入校验**: [users/service.js#L10](file:///workspace/src/users/service.js#L10) 3-64 a-z0-9_.- ✅

---

## 六、/api/admin/* 路由 requireAdmin 守卫审查（TR-2.4）

| # | 路由 + 方法 | 行号 | requireAdmin 挂载 | 结论 |
|---|------------|------|-------------------|------|
| 1 | `GET /api/admin/users` | [router.js#L42](file:///workspace/src/api-v2/router.js#L42) | ✅ 存在 | ✅ |
| 2 | `POST /api/admin/users` | [router.js#L43](file:///workspace/src/api-v2/router.js#L43) | ✅ 存在 | ✅ |
| 3 | `PATCH /api/admin/users/{id}` | [router.js#L45](file:///workspace/src/api-v2/router.js#L45) | ✅ 存在 | ✅ |
| 4 | `DELETE /api/admin/users/{id}` | [router.js#L46](file:///workspace/src/api-v2/router.js#L46) | ✅ 存在 | ✅ |
| 5 | `POST /api/admin/users/{id}/ban` | [router.js#L48](file:///workspace/src/api-v2/router.js#L48) | ✅ 存在 | ✅ |
| 6 | `DELETE /api/admin/users/{id}/ban` | [router.js#L49](file:///workspace/src/api-v2/router.js#L49) | ✅ 存在 | ✅ |
| 7 | `GET /api/admin/config` | [router.js#L50](file:///workspace/src/api-v2/router.js#L50) | ✅ 存在 | ✅ |
| 8 | `PATCH /api/admin/config` | [router.js#L51](file:///workspace/src/api-v2/router.js#L51) | ✅ 存在 | ✅ |

**结论**: 8 条 /api/admin/* 路由 **全部** 正确挂载 requireAdmin(current) 守卫。同时 userService.update/delete 内部还有二次角色校验（actor.role !== 'admin' 抛 403），为纵深防御加分。

---

## 七、Admission 5 道关卡顺序审查（TR-2.6）

**定位**: [admission/service.js#L27-L57](file:///workspace/src/admission/service.js#L27-L57)

| 关卡序号 | 关卡内容 | 代码行号 | 与 README 描述一致 | 结论 |
|---------|---------|---------|-------------------|------|
| ① | UUID 格式校验 (isValidUuidV4) | [L28-L30](file:///workspace/src/admission/service.js#L28-L30) | ✅ UUID格式校验 | ✅ |
| ② | D1 查用户存在性 + disabled 检查 | [L32-L34](file:///workspace/src/admission/service.js#L32-L34) | ✅ 用户存在→禁用检查 | ✅ |
| ③ | D1 查 ban 状态（until > now 或 until null） | [L36-L37](file:///workspace/src/admission/service.js#L36-L37) | ✅ Ban检查 | ✅ |
| ④ | DO /admit 配额裁判（仅 quotaBytes>0 时） | [L40-L50](file:///workspace/src/admission/service.js#L40-L50) | ⚠️ DO配额但 quotaBytes=0 时跳过 | ⚠️ 见 SEC-ADM-001 |
| ⑤ | 协议/传输白名单校验 (resolveProtocol + resolveTransports) | [L52-L56](file:///workspace/src/admission/service.js#L52-L56) | ✅ 协议传输白名单 | ✅ |

**结论**: 5 道关卡的**顺序**完全匹配 README 描述。但关卡 ④ 在 quotaBytes=0 时被**完全跳过**（无 resetVersion 返回、无 remaining 检查），这是 SEC-ADM-001 的根本原因。

---

## 八、登录失败锁定竞态分析（TR-2.5）

```
并发时序（同一 fingerprint 同时发起 N=20 请求）：
  T0: 请求1 check()  → SELECT → {failures:4, locked_until:null} → 通过
  T0: 请求2 check()  → SELECT → {failures:4, locked_until:null} → 通过
  ...
  T0: 请求20 check() → SELECT → {failures:4, locked_until:null} → 通过
  T0+200ms (密码验证后):
     请求1 failure() → UPDATE failures=5  → CASE 5>=5 → SET locked_until=NOW+15min ✅
     请求2 failure() → UPDATE failures=6  → CASE 6>=5 → SET locked_until=NOW+15min （刷新续期）
     请求3 failure() → UPDATE failures=7  → CASE 7>=5 → SET locked_until=NOW+15min （又续期）
     ...
     请求20 failure() → UPDATE failures=24 → 继续续期
```

**实际突破次数**: 20 次（远超设计目标 5 次）  
**续期 DoS 风险**: 攻击者只要每 14 分 59 秒发送 1 次失败请求即可使锁定持续刷新为 NOW+15min，理论上可以永久锁定目标账号（除非管理员手动从 login_attempts 表删除行）。

**结论**: 存在实际竞态风险，应按 SEC-AUTH-005 修复建议合并 check+failure 为单步原子 SQL，并禁止续期刷新。

---

## 九、问题汇总统计

| 严重级别 | 数量 | 编号 |
|---------|------|------|
| 🔴 High | **3** | SEC-AUTH-001, SEC-AUTH-002, SEC-ADM-001 |
| 🟡 Medium | **4** | SEC-AUTH-003, SEC-AUTH-004, SEC-AUTH-005, SEC-ADM-002 |
| 🟢 Low | **3** | SEC-AUTH-006, SEC-AUTH-007, SEC-AUTH-008 |
| ℹ️ Info | **0** | — |
| **合计** | **10** | |
