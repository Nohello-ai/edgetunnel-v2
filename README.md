# EdgeTunnel Core

> 面向 Cloudflare Workers 的模块化代理核心，内置强一致流量计量与用户管理系统。

[![Build and release](https://github.com/Nohello-ai/edgetunnel-v2/actions/workflows/build-release.yml/badge.svg)](https://github.com/Nohello-ai/edgetunnel-v2/actions/workflows/build-release.yml)

---

## 目录

- [项目简介](#项目简介)
- [与普通代理项目的区别](#与普通代理项目的区别)
- [架构总览](#架构总览)
- [运行流程](#运行流程)
- [目录结构](#目录结构)
- [部署指南](#部署指南)
- [环境变量与 Secrets](#环境变量与-secrets)
- [Bindings 配置详解](#bindings-配置详解)
- [数据库表结构](#数据库表结构)
- [全局配置字段](#全局配置字段)
- [API 接口](#api-接口)
- [构建与测试](#构建与测试)
- [GitHub Actions 发布](#github-actions-发布)

---

## 项目简介

EdgeTunnel Core 是一个运行在 Cloudflare Workers 上的代理隧道系统，核心特征：

- **协议**：VLESS、Trojan（增量首包解析，不全量缓存）
- **传输**：WebSocket、标准 Hunk protobuf gRPC、XHTTP `stream-one`
- **出站**：Cloudflare Sockets 直连 TCP、UDP/53 经 DNS-over-TCP
- **流量计量**：基于 Durable Object 的强一致实时计数，支持配额控制与即时断连
- **用户管理**：D1 数据库存储用户/会话/封禁/配额，PBKDF2 密码哈希
- **订阅生成**：协议 × 传输 × HOSTS 笛卡尔积展开，支持随机路径、0-RTT、TLS 分片、ECH
- **构建**：esbuild 单文件打包，零运行时依赖，产物为两个独立 JS 文件，直接上传部署

### 双 Worker 架构

项目拆分为两个独立 Worker，各自打包成一个单 JS 文件、独立部署、绑定不同资源：

| Worker | 入口源码 | 构建产物 | 职责 |
|--------|---------|---------|------|
| 传输层 | `src/index-transmission.js` | `_worker-transmission.js` | 代理隧道 + 强一致流量计量 + DO（导出 `QuotaDO` 类） |
| 用户管理层 | `src/index-admin.js` | `_worker-admin.js` | API + 认证 + 配置 + 订阅 + 管理面板 |

两个产物是**唯二需要上传的文件**，分别上传到各自的 Cloudflare Worker。`src/index.js` 仅作为行为对照的旧单入口保留，不再用于打包部署。

---

## 与普通代理项目的区别

本项目与典型的「单文件 Worker 代理」（如 edge-tunnel、edgetunnel 等社区项目）有本质架构差异：

### 1. 存储架构：从单 KV 到三层存储

| 维度 | 普通代理项目 | 本项目 |
|------|-------------|--------|
| 用户身份 | 单个 UUID 写死在代码里 | D1 数据库管理用户，用户名/密码登录，UUID 自动生成 |
| 配置存储 | 环境变量/代码常量 | KV `global_config` 键，支持运行时 PATCH 热更新 |
| 流量统计 | 无，或写 D1（最终一致，有并发超额） | Durable Object 强一致计数 + KV 异步展示 + D1 对账 |
| 配额控制 | 无 | DO 实时裁判，超额毫秒级断连 |

### 2. 流量计量：从「事后统计」到「实时裁判」

普通项目通常在连接结束后把流量写入 D1，存在两个问题：
- **并发超额**：多个 Worker isolate 同时连接，D1 写回前无法互相感知，可能大幅超额
- **无法断连**：流量超标后只能等连接自然结束，无法主动切断

本项目引入 `QuotaDO`（Durable Object），每用户一个实例，串行处理该用户所有连接的流量计数：

```
普通项目:  连接 → 代理 → 结束 → 写 D1（可能已超额）
本项目:    连接 → DO /admit 拿预算 → 本地计量 → 每 256KB 上报 DO → 超额即断
```

- **预算下推**：DO 给每个连接下推一个本地预算（剩余的 90%，最少 100MB），连接在本地累积到预算或 256KB 才上报，减少 DO 调用频率
- **即时断连**：DO 返回 `allowed: false` 时，meter 立即抛出 `UsageLimitError`，管道关闭 transport，2-3 秒内断干净
- **UUID 重置踢线**：封禁/禁用用户时 DO 递增 `resetVersion`，活跃连接下次上报时校验不通过被拒

### 3. 控制面与数据面分离

| 维度 | 控制面 | 数据面 |
|------|--------|--------|
| 路径 | `/api/*`、`/sub` | `/{ws\|grpc\|xhttp}/{uuid}/{protocol}` |
| 鉴权 | Session Cookie + 角色守卫 | UUID + DO 配额裁判 |
| 请求模型 | 同步请求-响应 | 响应先行 + 异步流式（`ctx.waitUntil`） |
| 延迟敏感度 | 不敏感（管理操作） | 极敏感（代理热路径不查 D1 引导管理员） |

### 4. 日切对账机制

每天 UTC 00:00，DO 执行 `maybeRollover`：
- 把 `todayUsed` 并入 `historyUsed` 后归零
- 归零前用 DO 权威值校验 KV/D1，不一致则**以 DO 为准覆盖**
- 归零后再写一次 KV/D1，确保新一天起点一致

这解决了 KV 最终一致性和 D1 写入延迟导致的数据漂移问题。

---

## 架构总览

```
   传输层 Worker _worker-transmission.js        用户管理层 Worker _worker-admin.js
   ┌─────────────────────────────────────┐     ┌─────────────────────────────────────┐
   │  数据面 /ws /grpc /xhttp            │     │  控制面 /api/* /sub                  │
   │  Admission → Pipeline → Connector   │     │  Auth → Users → Config → Sub         │
   │  QuotaDO（导出类，强一致计量）        │     │  R2 静态面板（可选）                   │
   └─────────────────────────────────────┘     └─────────────────────────────────────┘
                          │                              │
              ┌───────────┴───────────┐      ┌──────────┴──────────┐
              │                       │      │                      │
        ┌─────▼─────┐          ┌──────▼──────┐ │
        │  QuotaDO  │          │  D1 / KV    │ │
        │ (每用户实例)│         │ (用户/配置)  │ │
        │ 强一致计数  │          └─────────────┘ │
        └─────┬─────┘                            │
              │ 每 10s 增量同步                   │
        ┌─────▼─────┐    ┌──────────┐    ┌──────▼──────┐
        │    KV     │───►│    D1    │    │  Connector  │
        │ usage:uuid│    │  usage   │    │ Direct/Chain│
        └───────────┘    └──────────┘    └─────────────┘
```

---

## 运行流程

### 控制面流程（管理 API）

以 `GET /api/admin/config` 为例：

```
请求进入
  │
  ├─ env.DB 存在性检查（不存在 → 500）
  │
  ├─ R2 静态资源检查（/api/ 路径跳过）
  │
  ├─ classifyRequest → kind: 'api'
  │
  ├─ createUserRepository(env)           ← 创建 D1 用户仓库
  ├─ bootstrapAdmin(env, users)          ← 首次请求创建管理员（仅控制面执行）
  ├─ createSessionService(env, users)    ← 创建会话服务
  │
  └─ createApiRouter({ users, sessions })(request, env)
       │
       ├─ createUserService(users, env)  ← 用户服务（含 DO 同步）
       ├─ auth.resolve(request)          ← Cookie → Session → User
       ├─ requireAdmin(current)          ← 角色守卫
       │
       └─ 业务逻辑
            ├─ getGlobalConfig(env)      ← KV 读取配置
            ├─ normalizeGlobalConfig()   ← 规范化
            └─ jsonResponse({ config })  ← 返回
```

### 数据面流程（代理隧道）

以 `wss://host/ws/{uuid}/vless` 为例：

```
请求进入
  │
  ├─ classifyRequest → parseDataFlowRoute + matchesTransport → kind: 'data-flow'
  │
  ├─ createAdmissionDependencies(env)    ← 注入: users/bans/config/quotaDO
  │
  ├─ admission.admit(route)              ← 五道关卡
  │    ├─ ① UUID 格式校验
  │    ├─ ② D1 查用户存在性 + disabled 检查
  │    ├─ ③ D1 查 ban 状态
  │    ├─ ④ DO /admit 配额裁判 → 返回 { allowed, remaining, budget, resetVersion }
  │    └─ ⑤ 协议/传输白名单校验
  │    → 返回 frozen DataFlowSession
  │
  ├─ createDirectConnector + createFallbackConnector（若配置反代）
  │
  └─ startDataFlowPipeline({...})
       │
       ├─ openTransport(transport)       ← WebSocket/gRPC/XHTTP → 字节流
       ├─ 二次配额校验（remaining ≤ 0 → 立即拒绝）
       ├─ createUsageMeter({ quotaDO, resetVersion })
       │    └─ meter.setBudget(session.budget)  ← DO 下推的本地预算
       │
       ├─ runPipeline (ctx.waitUntil 异步托管)
       │    │
       │    ├─ createProtocolParser(protocol)   ← VLESS/Trojan 首包解析
       │    ├─ 读协议头（10s 超时，每段 meter.addUpload）
       │    │
       │    ├─ UDP? → forwardDnsDatagrams
       │    │    └─ 仅允许端口 53，DNS-over-TCP，5s 超时
       │    │
       │    └─ TCP → forwardTcp
       │         ├─ connector.connect({ hostname, port })  ← 5s 连接超时
       │         ├─ upload 流: client → remote（meter.addUpload）
       │         └─ download 流: remote → client（meter.addDownload）
       │
       ├─ 立即 return transport.response    ← 响应先行，流量异步搬运
       │
       └─ 后台计量循环:
            ├─ pending ≥ 256KB 或 counted ≥ budget → meter.flush()
            ├─ flush → POST DO /report { delta, resetVersion }
            │    ├─ allowed: true → 更新 budget，继续
            │    ├─ allowed: false → 抛 UsageLimitError → 断连
            │    └─ 网络异常 → pending 回滚，稍后重试
            ├─ DO 内部: 每 10s 增量写 KV（usage:uuid）
            └─ 连接结束 → finally meter.flush() 最后一次上报
```

### DO 内部机制（QuotaDO）

```
QuotaDO 状态（每用户一个实例）:
  totalQuota     套餐总额度（字节）
  historyUsed    历史累计已用（不含今天）
  todayUsed      今天已用
  resetVersion   UUID 重置版本号
  lastRollover   上次日切日期

RPC 接口:
  GET  /admit            → { allowed, remaining, budget, resetVersion }
  POST /report { delta } → { allowed, remaining, budget }    累加 todayUsed
  POST /set-quota        → 更新 totalQuota（续费）
  POST /reset-uuid       → resetVersion++（踢线）
  GET  /snapshot         → 完整快照（面板用）

日切对账（maybeRollover，每天 UTC 00:00）:
  1. doTotal = historyUsed + todayUsed
  2. 对比 KV/D1，不一致则以 DO 为准覆盖
  3. historyUsed = doTotal, todayUsed = 0
  4. 再写一次 KV/D1 确保起点一致
```

---

## 目录结构

```
edgetunnel-v2/
├── src/
│   ├── index.js                    # 旧单入口（行为对照，不再用于打包）
│   ├── index-transmission.js       # 传输层入口 → _worker-transmission.js
│   ├── index-admin.js              # 用户管理层入口 → _worker-admin.js
│   ├── admission/
│   │   ├── repositories.js         # 准入依赖工厂
│   │   └── service.js              # 准入服务（5 道关卡）
│   ├── api-v2/
│   │   └── router.js               # 控制面 API 路由
│   ├── auth/
│   │   ├── bootstrap.js            # 首次引导管理员
│   │   ├── guards.js               # 鉴权守卫
│   │   ├── login-attempts.js       # 登录失败锁定
│   │   ├── password.js             # PBKDF2 密码哈希
│   │   ├── service.js              # 认证业务
│   │   └── session.js              # Session 服务
│   ├── config/
│   │   ├── loader.js               # KV 配置读写
│   │   ├── runtime.js              # 运行时配置
│   │   └── schema.js               # 配置规范化
│   ├── connector/
│   │   ├── chain.js                # 回退连接链
│   │   ├── direct.js               # CF Sockets 直连
│   │   ├── http.js                 # HTTP 出站
│   │   ├── proxyip.js              # ProxyIP 连接器
│   │   └── socks5.js               # SOCKS5 连接器
│   ├── core/
│   │   ├── errors.js               # 错误类型
│   │   └── types.js                # 核心类型（DataFlowSession 等）
│   ├── dns/
│   │   └── service.js              # DNS-over-TCP
│   ├── net/
│   │   ├── cidr.js                 # CIDR 解析
│   │   ├── ip-pool.js              # IP 池
│   │   └── operator.js             # 运营商识别
│   ├── protocol-v2/
│   │   ├── address.js              # 地址解析
│   │   ├── datagram.js             # UDP 数据报编解码
│   │   ├── helpers.js              # 协议辅助
│   │   ├── registry.js             # 协议注册表
│   │   ├── trojan.js               # Trojan 首包解析
│   │   ├── types.js                # 协议类型
│   │   └── vless.js                # VLESS 首包解析
│   ├── proxy/
│   │   └── pipeline.js             # 数据流管道编排
│   ├── routes/
│   │   └── router.js               # 路由分类
│   ├── subscription/
│   │   ├── ech.js                  # ECH 参数
│   │   ├── generator.js            # URI 生成
│   │   ├── node-builder.js         # 节点构建
│   │   └── params.js               # 节点参数
│   ├── transport-v2/
│   │   ├── grpc-frame.js           # gRPC 帧封装
│   │   ├── grpc.js                 # gRPC 传输
│   │   ├── limits.js               # 限制
│   │   ├── registry.js             # 传输注册表
│   │   ├── websocket.js            # WebSocket 传输
│   │   └── xhttp.js                # XHTTP 传输
│   ├── usage/
│   │   ├── meter.js                # 本地计量器
│   │   ├── quota-do.js             # QuotaDO 强一致配额
│   │   └── repository.js           # 用量仓库
│   ├── users/
│   │   ├── governance.js           # 治理（封禁/解封）
│   │   ├── repository.js           # 用户仓库
│   │   └── service.js              # 用户业务
│   └── utils/
│       ├── crypto.js               # 加密工具
│       └── http.js                 # HTTP 响应工具
├── test/                           # 21 个测试文件
├── scripts/
│   └── build-single.mjs            # esbuild 打包脚本
├── migrations/
│   ├── 0001_initial.sql            # 初始迁移
│   └── 0002_login_attempts.sql     # 补充迁移
├── .github/workflows/
│   └── build-release.yml           # CI/CD 发布工作流
├── schema.sql                      # 完整 D1 schema（幂等）
├── wrangler.example.toml           # Cloudflare 配置模板
├── package.json
├── _worker-transmission.js         # 构建产物·传输层（上传到传输 Worker）
└── _worker-admin.js                # 构建产物·用户管理层（上传到管理 Worker）
```

---

## 部署指南

部署方式**有且只有一种**：把构建出的单 JS 文件上传到 Cloudflare Dashboard 对应的 Worker。本项目不使用 `wrangler deploy`、不通过 Git 自动部署。下面分别给出两个 Worker 的资源准备与上传步骤。

> 资源（D1 / KV / R2 / DO 命名空间）只需创建一次，两个 Worker 共用同一个 D1 与 KV；Durable Object 命名空间归属于传输层 Worker。资源创建可用 Wrangler CLI 或 Dashboard，但**代码部署只用 JS 文件上传**。

### 前置条件

- Cloudflare 账户
- Node.js 20+（仅本地构建产物用）
- Wrangler CLI（`npm install -g wrangler`，仅用于一次性创建 D1/KV/R2 资源，不用于部署）

### 一次性资源准备

#### 1. 克隆仓库并构建产物

```bash
git clone https://github.com/Nohello-ai/edgetunnel-v2.git
cd edgetunnel-v2
npm ci
npm test          # 运行测试
npm run check     # 语法检查
npm run bundle    # 打包出两个产物
```

构建完成后得到两个 JS 文件（唯二需要上传的文件）：

- `_worker-transmission.js` → 上传到**传输层 Worker**
- `_worker-admin.js` → 上传到**用户管理层 Worker**

#### 2. 创建 D1 数据库（两个 Worker 共用）

```bash
wrangler d1 create edgetunnel-db
# 记下返回的 database_id
wrangler d1 execute edgetunnel-db --remote --file=migrations/0001_initial.sql
wrangler d1 execute edgetunnel-db --remote --file=migrations/0002_login_attempts.sql
```

#### 3. 创建 KV Namespace（两个 Worker 共用）

```bash
wrangler kv namespace create KV
# 记下返回的 id
```

#### 4. 创建 R2 Bucket（可选，仅管理层用）

```bash
wrangler r2 bucket create edgetunnel-admin
```

---

### 传输层 Worker 部署

**上传文件**：`_worker-transmission.js`

**所需 Bindings**：

| Binding | 类型 | 必要性 | 说明 |
|---------|------|--------|------|
| `DB` | D1 | 必须 | 用户/封禁查询（只读） |
| `KV` | KV | 必须 | 全局配置读取（只读） |
| `QUOTA_DO` | Durable Object | 必须 | 强一致流量计量与断连；**此 Worker 导出 `QuotaDO` 类，DO 实例归属于此** |

**上传步骤**：

1. Cloudflare Dashboard → Workers & Pages → 创建新 Worker（如 `edgetunnel-transmission`）
2. 进入 Worker → 编辑代码 → 上传 `_worker-transmission.js` → 保存部署
3. Settings → Bindings，依次添加：
   - D1 database：变量名 `DB` → 选择 `edgetunnel-db`
   - KV namespace：变量名 `KV` → 选择上一步创建的 KV
   - Durable Object：变量名 `QUOTA_DO` → class `QuotaDO`（此 Worker 导出该类，命名空间在此创建）

> 传输层不需要 `ADMIN_BUCKET`、`BOOTSTRAP_*`、`TURNSTILE_*`。

---

### 用户管理层 Worker 部署

**上传文件**：`_worker-admin.js`

**所需 Bindings / Secrets / Vars**：

| Binding / 变量 | 类型 | 必要性 | 说明 |
|---------------|------|--------|------|
| `DB` | D1 | 必须 | 用户/会话/封禁/用量/配置/登录失败记录（读写） |
| `KV` | KV | 必须 | `global_config` 读写 + 用量展示 |
| `QUOTA_DO` | Durable Object | 推荐 | 续费 `set-quota` / 踢线 `reset-uuid` / 快照实时生效所需。绑定到**传输层 Worker 的 `QuotaDO` 命名空间**（跨 Worker 绑定）；不配置则这些操作不实时下发到在线 DO（DO 冷启动后会从 D1 重新加载配额） |
| `ADMIN_BUCKET` | R2 | 可选 | 管理面板静态文件 |
| `BOOTSTRAP_ADMIN_USER` | Secret | 首次必须 | 引导管理员用户名，创建后可删除 |
| `BOOTSTRAP_ADMIN_PASSWORD` | Secret | 首次必须 | 引导管理员密码，创建后可删除 |
| `TURNSTILE_SECRET_KEY` | Secret | 可选 | Cloudflare Turnstile 后端密钥 |
| `TURNSTILE_SITE_KEY` | 文本变量 | 可选 | Cloudflare Turnstile 前端公钥 |

**上传步骤**：

1. Cloudflare Dashboard → Workers & Pages → 创建新 Worker（如 `edgetunnel-admin`）
2. 进入 Worker → 编辑代码 → 上传 `_worker-admin.js` → 保存部署
3. Settings → Bindings，依次添加：
   - D1 database：变量名 `DB` → 选择同一个 `edgetunnel-db`
   - KV namespace：变量名 `KV` → 选择同一个 KV
   - Durable Object：变量名 `QUOTA_DO` → 选择传输层 Worker 的 `QuotaDO` 命名空间（跨 Worker）
   - R2 bucket（可选）：变量名 `ADMIN_BUCKET` → 选择 `edgetunnel-admin`
4. Settings → Variables and Secrets，添加：
   - Secret `BOOTSTRAP_ADMIN_USER` = 管理员用户名（首次登录后可删除）
   - Secret `BOOTSTRAP_ADMIN_PASSWORD` = 管理员密码（首次登录后可删除）
   - （可选）Secret `TURNSTILE_SECRET_KEY`、文本变量 `TURNSTILE_SITE_KEY`

> 管理层不导出 `QuotaDO` 类，只通过 `QUOTA_DO` 绑定远程调用传输层的 DO。

---

### 验证

```bash
# 传输层版本探测
curl https://edgetunnel-transmission.<你的子域>.workers.dev/version
# {"name":"edgetunnel-transmission","version":"3.0.0"}

# 管理层版本探测
curl https://edgetunnel-admin.<你的子域>.workers.dev/version
# {"name":"edgetunnel-admin","version":"3.0.0"}

# 管理层登录（首次用 bootstrap 凭据）
curl -X POST https://edgetunnel-admin.<你的子域>.workers.dev/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"你的密码"}'
```

---

## 环境变量与 Secrets

两个 Worker 的变量互不相同，下面分开列出。所有 Secret / 文本变量都在 Cloudflare Dashboard → Worker → Settings → Variables and Secrets 中配置（不使用 `wrangler secret put` 部署）。

### 传输层 Worker（`_worker-transmission.js`）

| 变量/Binding | 类型 | 必要性 | 说明 |
|-------------|------|--------|------|
| `DB` | D1 | **必须** | 用户存在性 / 封禁查询（只读） |
| `KV` | KV | **必须** | 全局配置读取（只读） |
| `QUOTA_DO` | Durable Object | **必须** | 强一致流量计量与即时断连；此 Worker 导出 `QuotaDO` 类，DO 实例归属此 |

> 传输层**不需要** `ADMIN_BUCKET`、`BOOTSTRAP_*`、`TURNSTILE_*`。

### 用户管理层 Worker（`_worker-admin.js`）

| 变量/Binding | 类型 | 必要性 | 说明 |
|-------------|------|--------|------|
| `DB` | D1 | **必须** | 用户/会话/封禁/用量/配置/登录失败记录（读写） |
| `KV` | KV | **必须** | `global_config` 读写 + 用量展示 |
| `QUOTA_DO` | Durable Object | **推荐** | 续费 `set-quota` / 踢线 `reset-uuid` / 快照实时生效所需，绑定到传输层 Worker 的 `QuotaDO` 命名空间。不配置则这些操作不实时下发到在线 DO |
| `ADMIN_BUCKET` | R2 | 可选 | 管理面板静态文件 |
| `BOOTSTRAP_ADMIN_USER` | Secret | **首次必须** | 引导管理员用户名，创建后可删除 |
| `BOOTSTRAP_ADMIN_PASSWORD` | Secret | **首次必须** | 引导管理员密码，创建后可删除 |
| `TURNSTILE_SECRET_KEY` | Secret | 可选 | Cloudflare Turnstile 后端密钥；配置后启用登录/注册人机验证，不配置则跳过验证，仅靠失败次数锁定兜底 |
| `TURNSTILE_SITE_KEY` | 文本变量 | 可选 | Cloudflare Turnstile 前端公钥，需与 `TURNSTILE_SECRET_KEY` 同时配置 |

> 其余配置（协议、传输、反代、订阅转换等）全部通过 KV `global_config` 键存储，用 `PATCH /api/admin/config` 运行时修改，不需要环境变量。

### Turnstile 人机验证（仅管理层）

在 [Cloudflare Dashboard](https://dash.cloudflare.com/) → Turnstile 创建一个 Widget，获取 Site Key 和 Secret Key，然后在**管理层 Worker** 的 Settings → Variables and Secrets 中添加：

- Secret `TURNSTILE_SECRET_KEY` = 你的 Secret Key（加密存储）
- 文本变量 `TURNSTILE_SITE_KEY` = 你的 Site Key（明文）

**行为逻辑**：

| 场景 | 第 1-2 次 | 第 3-9 次 | 第 10 次 |
|------|----------|----------|---------|
| 登录失败 | 正常放行 | 要求 Turnstile 验证 | 锁 IP 15 分钟 |
| 注册 | 正常放行 | 要求 Turnstile 验证 | 锁 IP 15 分钟 |
| 未配置 Turnstile | 正常放行 | 正常放行（跳过验证） | 锁 IP 15 分钟 |

前端收到 `403 REQUIRE_CAPTCHA` 时，响应体包含 `turnstileSiteKey`，前端渲染 Turnstile widget，用户完成验证后带 `turnstileToken` 字段重发请求。

### Bindings 总览（按 Worker）

| `env.*` | 归属 Worker | 对应 Binding | 类型 |
|---------|------------|-------------|------|
| `env.DB` | 两者 | `DB` | D1 数据库 |
| `env.KV` | 两者 | `KV` | KV Namespace |
| `env.QUOTA_DO` | 两者（传输层导出类，管理层跨 Worker 调用） | `QUOTA_DO` | Durable Object |
| `env.ADMIN_BUCKET` | 仅管理层 | `ADMIN_BUCKET` | R2 Bucket（可选） |
| `env.BOOTSTRAP_ADMIN_USER` | 仅管理层 | — | Secret（首次） |
| `env.BOOTSTRAP_ADMIN_PASSWORD` | 仅管理层 | — | Secret（首次） |
| `env.TURNSTILE_SITE_KEY` | 仅管理层 | — | 文本变量 |
| `env.TURNSTILE_SECRET_KEY` | 仅管理层 | — | Secret |

---

## Bindings 配置详解

### D1 数据库（`DB`）

存储用户、会话、封禁、通知、用量历史、登录失败记录、全局配置。7 张表，全部外键 `ON DELETE CASCADE`。

### KV Namespace（`KV`）

| Key 格式 | 内容 | 写入方 | 读取方 |
|----------|------|--------|--------|
| `global_config` | 全局配置 JSON | `PUT /api/admin/config` | 所有请求 |
| `usage:{userID}` | 用户总用量（字符串数字） | DO 每 10s 增量写 | 面板降级读取 |
| `usage_delta:{userID}` | 最近一次增量 | DO 每 10s 写 | 内部 |

### R2 Bucket（`ADMIN_BUCKET`，可选）

存储管理面板静态文件（HTML/CSS/JS）。`/api/`、`/logout`、`/sub`、`/version` 路径不走 R2。未绑定时不影响核心功能。

### Durable Object（`QUOTA_DO`）

| 属性 | 值 |
|------|-----|
| Class | `QuotaDO` |
| 实例粒度 | 每用户一个（以 `userID` 为 Object ID） |
| 一致性 | 强一致（单线程串行） |
| 存储 | `this.state.storage`（DO 内部存储） |
| 迁移 Tag | `v1` |

DO 是流量配额的唯一权威裁判。KV 和 D1 的用量数据仅作为展示和对账副本。

---

## 数据库表结构

完整 schema 见 `schema.sql`（幂等，带 `IF NOT EXISTS`）或 `migrations/0001_initial.sql`。

### users

```sql
CREATE TABLE users (
  user_id        TEXT PRIMARY KEY,           -- UUID v4，系统自动生成
  username       TEXT NOT NULL UNIQUE COLLATE NOCASE,  -- 用户名（不区分大小写）
  password_hash  TEXT NOT NULL,              -- PBKDF2 哈希
  role           TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  disabled       INTEGER NOT NULL DEFAULT 0,
  quota_bytes    INTEGER NOT NULL DEFAULT 0, -- 流量配额（字节），0 = 无限
  trojan_secret  TEXT NOT NULL,              -- Trojan 协议密码（独立于登录密码）
  subscription_token_hash TEXT,              -- 订阅 token 哈希
  settings       TEXT NOT NULL DEFAULT '{}', -- 用户设置 JSON
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
```

### sessions

```sql
CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,              -- Session token 的 SHA-256
  user_id     TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  revoked_at  TEXT,                           -- 非空 = 已注销
  created_at  TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);
```

### bans

```sql
CREATE TABLE bans (
  user_id    TEXT PRIMARY KEY,
  reason     TEXT NOT NULL DEFAULT '',
  until      TEXT,                           -- NULL = 永久封禁
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);
```

### usage

```sql
CREATE TABLE usage (
  user_id    TEXT PRIMARY KEY,
  upload     INTEGER NOT NULL DEFAULT 0,
  download   INTEGER NOT NULL DEFAULT 0,
  total      INTEGER NOT NULL DEFAULT 0,     -- DO 日切时对账覆盖
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);
```

### login_attempts

```sql
CREATE TABLE login_attempts (
  fingerprint  TEXT PRIMARY KEY,             -- 前缀:Key（ip:1.2.3.4 / user:alice / register:1.2.3.4）
  failures     INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,                         -- 10 次失败后锁定 15 分钟
  updated_at   TEXT NOT NULL
);
```

### notifications

```sql
CREATE TABLE notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT,                           -- NULL = 全局通知
  type       TEXT NOT NULL,
  message    TEXT NOT NULL DEFAULT '',
  read_at    TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);
```

### global_config

```sql
CREATE TABLE global_config (
  key        TEXT PRIMARY KEY,               -- 固定为 "global_config"
  value      TEXT NOT NULL DEFAULT '{}',     -- 配置 JSON
  updated_at TEXT NOT NULL
);
```

---

## 全局配置字段

通过 `PATCH /api/admin/config` 修改，存储在 KV `global_config` 键。

### 基础配置

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `siteName` | string | `"edgetunnel"` | 站点名称 |
| `protocol` | string | `"vless"` | 默认协议（`vless`/`trojan`） |
| `protocols` | string[] | `["vless"]` | 启用的协议列表 |
| `transport` | string | `"websocket"` | 默认传输 |
| `transports` | string[] | `["websocket"]` | 启用的传输列表 |
| `HOST` | string | `"edgetunnel"` | 主机名 |
| `HOSTS` | string[] | `["edgetunnel"]` | 主机名列表（逗号或换行分隔） |

### 反代配置（`反代`）

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `反代.模式` | string | `""` | `""`/`proxyip`/`socks5`/`auto` |
| `反代.PROXYIP` | string | `"auto"` | ProxyIP 地址 |
| `反代.SOCKS5.启用` | string\|null | `null` | `null`/`socks5`/`http`/`https` |
| `反代.SOCKS5.全局` | boolean | `false` | `true` = 全局走代理，不尝试直连 |
| `反代.SOCKS5.账号` | string | `""` | `user:pass@host:port` 格式 |
| `反代.SOCKS5.白名单` | string[] | `[]` | 不走代理的目标列表 |

**反代模式说明**：

| 模式 | 行为 |
|------|------|
| `""` | 纯直连 |
| `proxyip` | 直连失败 → ProxyIP 降级 |
| `socks5` | 非全局：直连失败 → SOCKS5 降级；全局：始终走 SOCKS5 |
| `auto` | 目标在 CF 段 → 走反代；否则直连 |

### 节点参数（`节点参数`）

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `节点参数.Fingerprint` | string | `"chrome"` | TLS 指纹 |
| `节点参数.随机路径` | boolean | `false` | 追加随机路径段 |
| `节点参数.启用0RTT` | boolean | `false` | TLS 0-RTT |
| `节点参数.TLS分片` | string\|null | `null` | TLS 分片参数 |
| `节点参数.节点数量` | integer | `16` | 1-64 |
| `节点参数.优选IP.模式` | string | `""` | `""`/`optimized`/`random`/`custom` |
| `节点参数.优选IP.随机端口` | boolean | `true` | 随机端口 |
| `节点参数.优选IP.自定义IP源` | string | `""` | IP 源 URL 或文本（custom 模式） |
| `节点参数.优选IP.优选网站URL` | string | `""` | 优选 IP 网站 URL |

### ECH 配置

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `ECH` | boolean | `false` | 是否启用 ECH |
| `ECHConfig.dns` | string | `"https://odvr.nic.cz/doh"` | ECH DNS |
| `ECHConfig.domain` | string | `"cloudflare-ech.com"` | ECH SNI 域名（`"0"` = 跟随节点 host） |

### 订阅转换（`订阅转换`）

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `订阅转换.SUBAPI` | string | `"https://SUBAPI.cmliussss.net"` | 订阅转换 API 地址 |
| `订阅转换.emoji` | boolean | `true` | 添加 emoji |
| `订阅转换.list` | boolean | `false` | 列表模式 |
| `订阅转换.udp` | boolean | `true` | 启用 UDP |
| `订阅转换.xudp` | boolean | `false` | 启用 XUDP |
| `订阅转换.tls13` | boolean | `true` | TLS 1.3 |
| `订阅转换.append_type` | boolean | `false` | 追加类型 |
| `订阅转换.sort` | boolean | `false` | 排序 |
| `订阅转换.config` | string | `""` | 额外配置 |

---

## API 接口

所有 API 返回 `{ ok: boolean, ... }` 格式，错误时附 `error`/`message`/`details`。

### 认证

| 方法 | 路径 | 权限 | 功能 |
|------|------|------|------|
| POST | `/api/auth/login` | 公开 | 用户名密码登录，返回 user + Set-Cookie |
| POST | `/api/auth/register` | 公开 | 注册普通用户 |
| POST | `/api/auth/logout` | 登录 | 注销 Session |
| GET | `/api/auth/me` | 登录 | 当前用户信息 + 实时用量（优先 DO /snapshot） |

### 用户管理

| 方法 | 路径 | 权限 | 功能 |
|------|------|------|------|
| GET | `/api/admin/users` | 管理员 | 用户列表 |
| POST | `/api/admin/users` | 管理员 | 创建用户 |
| PATCH | `/api/admin/users/{id}` | 管理员 | 修改用户（配额/密码/角色/禁用） |
| DELETE | `/api/admin/users/{id}` | 管理员 | 删除用户 |
| POST | `/api/admin/users/{id}/ban` | 管理员 | 封禁用户（触发 DO /reset-uuid 踢线） |
| DELETE | `/api/admin/users/{id}/ban` | 管理员 | 解封 |

### 配置

| 方法 | 路径 | 权限 | 功能 |
|------|------|------|------|
| GET | `/api/admin/config` | 管理员 | 读取全局配置 |
| PATCH | `/api/admin/config` | 管理员 | 修改全局配置（写入 KV） |

### 订阅

| 方法 | 路径 | 权限 | 功能 |
|------|------|------|------|
| GET | `/api/users/me/subscription` | 登录 | 生成当前用户订阅（Base64） |

订阅链接支持 `?target=` 参数触发云端订阅转换（需配置 `订阅转换.SUBAPI`）。

### 数据流路径

```
/ws/{userID}/{vless|trojan}[/{randomSuffix}]
/grpc/{userID}/{vless|trojan}[/{randomSuffix}]
/xhttp/{userID}/{vless|trojan}[/{randomSuffix}]
```

- `userID` 必须是 UUID v4
- 传输层 HTTP 头校验：WebSocket 需 `Upgrade: websocket`；gRPC 需 `Content-Type: application/grpc`；XHTTP 需 `application/x-http` 或 `application/octet-stream`

---

## 构建与测试

### 命令

```bash
npm ci              # 安装依赖（仅 esbuild）
npm test            # 运行测试（node --test test/*.test.js）
npm run check       # 语法检查（node --check）
npm run bundle      # 打包两个产物（esbuild）
```

> `npm run build` 等同于 `npm run bundle`，均产出两个 JS 文件。

### 构建产物

- 传输层入口：`src/index-transmission.js` → 产物 `_worker-transmission.js`
- 管理层入口：`src/index-admin.js` → 产物 `_worker-admin.js`
- 格式：ESM，`target: es2022`，`platform: browser`
- 外部依赖：`cloudflare:sockets`（运行时由 Cloudflare 提供）
- 产物顶部标记：`// edgetunnel-transmission {version}` 与 `// edgetunnel-admin {version}`
- 两个产物是唯二需要上传的文件，分别上传到各自的 Worker

### 测试覆盖

21 个测试文件，覆盖：路由分类、准入控制、协议解析（VLESS/Trojan）、传输层（WebSocket/gRPC/XHTTP）、流量计量器、用户治理、密码哈希、会话管理、登录锁定、配置规范化、CIDR/IP 池、订阅节点生成、数据报编解码等。

---

## GitHub Actions 发布

工作流文件：`.github/workflows/build-release.yml`

### 触发方式

1. **推送 tag**：推送 `v*` 格式的 tag（如 `v3.0.1`）自动触发
2. **手动触发**：在 GitHub Actions 页面 `workflow_dispatch`，输入版本号

### 流程

```
Checkout → Node.js 20 → npm ci → 设置版本号
→ npm test → npm run check → npm run bundle
→ 校验 _worker-transmission.js 与 _worker-admin.js 存在且含版本标记
→ 上传两个 artifact → 发布 GitHub Release（含两个 _worker-*.js）
```

> 工作流**不自动部署**到 Cloudflare。需要手动下载 Release 中的 `_worker-transmission.js` 与 `_worker-admin.js`，分别上传到各自的 Worker（唯一的部署方式：JS 文件上传）。

### 版本规则

- 初始版本 `3.0.0`，语义化版本
- 版本号写在 `package.json` 的 `version` 字段
- 两个产物顶部各保留各自版本标记：`// edgetunnel-transmission {version}`、`// edgetunnel-admin {version}`

---

## 安全说明

- 密码使用 PBKDF2 哈希存储，不明文存储或放入 URL
- 控制面使用 `HttpOnly; Secure; SameSite=Strict` Cookie
- VLESS UUID 和 Trojan secret 与网页登录密码互相独立
- 登录/注册双维度频率限制：IP 维度 + 用户名维度独立计数，2 次失败后触发 Cloudflare Turnstile 人机验证，10 次失败锁定 15 分钟（详见 [Turnstile 人机验证](#turnstile-人机验证)）
- /report 流量上报 delta 参数强制校验安全整数范围，防止负数绕过或 Infinity 归零
- 旧版 `users.password` 明文列不能直接 SQL 迁移到 PBKDF2，应新建库重建用户

---

## License

私有项目，未声明开源许可证。
