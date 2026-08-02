# Worker 解耦改造方案 Spec

## 背景

当前架构中，传输层 Worker 与管理层 Worker **共享 D1 数据库**，并通过**跨 Worker Durable Object 绑定**让管理层操作传输层的 `QuotaDO`。这导致：

1. **部署复杂**：必须在 Dashboard 创建 DO 命名空间并跨 Worker 绑定，但 Dashboard UI 创建 DO 经常失败
2. **耦合严重**：两个 Worker 都直连 D1，表结构变更需同步两边
3. **职责模糊**：流量统计逻辑分散在传输层（DO 计数）和管理层（D1 持久化）

## 改造目标

通过 **Service Bindings（Worker 间零延迟 RPC）** 替代跨 Worker DO 绑定和 D1 共享，实现：

- 传输层**不绑定 D1**，所有数据库操作集中在管理层
- DO 不跨 Worker 绑定，只在传输层内部使用
- 两个 Worker 之间仅通过 Service Binding 通信
- 部署只需 KV 共享 + 双向 Service Binding，无需跨 Worker DO

## 架构对比

### 改造前

```
传输层 Worker                          管理层 Worker
├── DB（D1，共享）                     ├── DB（D1，共享）
├── KV（共享）                         ├── KV（共享）
├── QUOTA_DO（跨 Worker 绑定）         ├── QUOTA_DO（跨 Worker 绑定）
└── 直接查 D1 做准入                   └── 直接操作 D1 + DO
```

### 改造后

```
┌─────────────────────┐         ┌─────────────────────┐
│  传输层 Worker       │         │  管理层 Worker       │
│                     │         │                     │
│  独占：              │         │  独占：              │
│  • QuotaDO ✅       │         │  • D1 ✅            │
│    （不跨Worker绑定）│         │  • R2（已禁用）      │
│                     │         │                     │
│  共享：              │         │  共享：              │
│  • KV（只读）───────┼─────────┼─→ KV（读写）        │
│                     │         │                     │
│  通信：              │         │  通信：              │
│  • USER_ADMIN ──────┼────────►├─ (被传输层调用)      │
│    (Service Binding)│         │                     │
│                     │         │                     │
│  (被管理层调用)◄─────┼─────────┤  TRANSMISSION ──────┤
│                     │         │  (Service Binding)  │
└─────────────────────┘         └─────────────────────┘
```

## 资源归属

| 资源 | 传输层 | 管理层 | 说明 |
|------|--------|--------|------|
| **D1 数据库** | ❌ 不绑定 | ✅ 独占 | 用户/会话/封禁/用量/配置 |
| **KV 命名空间** | ✅ 只读 | ✅ 读写 | 只存全局传输配置 |
| **Durable Object** | ✅ 独占 | ❌ 不跨 Worker 绑定 | 连接注册中心 + stop 标志 |
| **R2 Bucket** | ❌ | ✅ 代码保留但禁用 | 功能封闭，不删除代码 |
| **Service Binding** | `USER_ADMIN` → 管理层 | `TRANSMISSION` → 传输层 | 双向绑定 |

## KV 职责

KV **只存全局传输配置**，作为管理层向传输层下发配置的通道：

- 传输协议组合（VLESS/Trojan + WebSocket/gRPC/XHTTP）
- 通信相关配置（反代模式、传输参数等）

**不存**：用户数据、封禁列表、配额——这些全部走 Service Binding 实时查询管理层。

## 流量上报机制（攒批策略）

| 维度 | 设计 |
|------|------|
| **攒批阈值** | 5 MB |
| **最低配额** | 10 GB |
| **偷跑损失** | ≤ 0.05%（单连接）/ ≤ 0.25%（5 并发连接） |
| **上报时机** | ① 攒满 5MB ② 连接结束（剩余未满 5MB 的部分） |
| **通信方式** | Service Binding（无状态 RPC） |
| **决策方** | 管理层（收到上报后写 D1 + 查配额 + 返回决策） |
| **断连方式** | 传输层收到「拒绝」决策后主动断开当前连接 |

### 阈值选择理由

Cloudflare 免费版限制 10 万请求/天，Service Binding 调用算入请求数：

| 阈值 | 重度用户(10GB/天)上报次数 | 可支撑用户数 | 偷跑占比 |
|------|------------------------|------------|---------|
| 1 MB | 10000次/天 | 90 人 | 0.01% |
| **5 MB** | **2000次/天** | **450 人** | **0.05%** |
| 10 MB | 1000次/天 | 900 人 | 0.1% |

选 **5 MB** 作为平衡点。

## DO 职责（改造后）

| 职责 | 说明 |
|------|------|
| ① 连接注册中心 | 记录该用户所有活跃连接（closerId + stop 标志） |
| ② stop 标志管理 | 收到管理层停止命令时标记 stopped = true |
| ③ 每日重置 | Alarm 定时清理已断开连接的注册 |

**移除的职责**：流量计数（改用传输层本地变量）、配额存储（改用管理层 D1）、配额判断（改由管理层决策）

## Service Binding 通信场景

| 场景 | 方向 | Binding 变量 | 触发时机 | 用途 |
|------|------|-------------|---------|------|
| ① 准入决策 | 传输层 → 管理层 | `USER_ADMIN` | 用户连接开始 | 问"放行吗" |
| ② 流量上报 | 传输层 → 管理层 | `USER_ADMIN` | 攒满 5MB / 连接结束 | 报告用量 + 查是否超限 |
| ③ 配额变更 | 管理层 → 传输层 | `TRANSMISSION` | 管理员续费 | 通知 DO 更新配额（保留接口） |
| ④ 断连通知 | 管理层 → 传输层 | `TRANSMISSION` | 管理员封禁 / 系统检测超限 | 通知 DO 设置 stop 标志 |

## 完整流程

### 阶段 1：用户首次连接（准入决策）

```
用户设备 → 传输层 Worker
  → 读 KV 获取全局传输配置
  → Service Binding 调管理层 USER_ADMIN.admit(userId)
  → 管理层查 D1（用户存在? 已封禁? 配额剩余?）
  → 返回 放行/拒绝
  → 若放行：
    - 创建 QuotaDO 实例
    - 向 DO 注册连接
    - 本地累计 = 0
    - 开始代理流量
```

### 阶段 2：代理进行中（攒批上报 + 检查 stop）

```
传输层代理数据流
  → 本地累计 += 本次流量
  → 累计 < 5MB → 继续代理
  → 累计 ≥ 5MB → Service Binding 上报管理层
    → 管理层写 D1 (usage += 5MB)
    → 管理层查是否超限
    → 返回决策：放行 / 拒绝
  → 放行：本地累计清零，继续代理
  → 拒绝：
    - 调 DO.setStop(userId)
    - 关闭当前 socket
    - 该用户其他活跃连接下次传输时发现 stop 标志 → 断开
```

### 阶段 3：管理员主动封禁（实时断连触发）

```
管理员 → 管理层 POST /api/admin/ban
  → 管理层写 D1 (bans 表)
  → Service Binding 调传输层 TRANSMISSION.stopUser(userId)
  → 传输层调 DO.setStop(userId)
  → DO 标记 stopped = true
  → 该用户其他活跃连接在下次数据传输时检查发现 → 主动关闭 socket
```

### 阶段 4：用户连接结束（剩余流量上报）

```
用户断开连接 → 传输层
  → 本地累计 > 0?
    → 是：Service Binding 上报剩余流量
    → 管理层写 D1 (usage += 剩余)
  → 调 DO 注销连接
```

### 阶段 5：管理员续费（配额变更通知）

```
管理员 → 管理层 POST /api/admin/quota
  → 管理层写 D1 (quota_bytes)
  → Service Binding 调传输层 TRANSMISSION.updateQuota(userId, newQuota)
  → 传输层调 DO.setQuota(userId, newQuota)（保留接口，当前 DO 不存配额）
```

### 阶段 6：每日重置（DO Alarm）

```
QuotaDO 每日 00:00（Alarm 触发，25小时周期）
  → 清除已断开连接的注册
  → 重置本地统计
  → 设置下一个 Alarm
  → 无活跃连接时 DO 自动 Hibernation，零费用
```

## 断连机制说明

### stop 标志检查时机

| 时机 | 频率 | 延迟 |
|------|------|------|
| 攒满 5MB 上报后 | 每 5MB 一次 | 最多多跑 5MB |
| 连接自然结束时 | 一次 | 0 |

### 管理员封禁的断连路径

```
管理员点封禁
  → 管理层写 D1
  → Service Binding 调传输层.stopUser()
  → 传输层调 DO.setStop()
  → DO 标记该用户 stopped = true
  → 该用户其他活跃连接在下次数据传输时检查发现 → 主动关闭 socket
```

### 配额超限的断连路径

```
传输层攒满 5MB 上报
  → 管理层写 D1
  → 管理层查配额，发现超限
  → 返回决策"拒绝"
  → 传输层收到拒绝
  → 调 DO.setStop()
  → 关闭当前 socket
  → 该用户其他活跃连接下次传输时也会发现并断开
```

## R2 处理

- **代码保留**：R2 读取逻辑不删
- **功能禁用**：入口判断改为永远不进入 R2 分支
- **Binding 可选**：不配置 `ADMIN_BUCKET` 也不会报错

```javascript
// 修改前
if (env.ADMIN_BUCKET) { ... }

// 修改后
const R2_ENABLED = false;  // R2 静态托管功能已禁用
if (R2_ENABLED && env.ADMIN_BUCKET) { ... }
```

## 改造涉及的代码范围

| 文件 | 改动 |
|------|------|
| `src/index-admin.js` | 移除 D1 共享给传输层的假设；新增 Service Binding `TRANSMISSION`；R2 功能禁用 |
| `src/index-transmission.js` | 移除 D1 读取；改为通过 `USER_ADMIN` Service Binding 准入；新增 5MB 攒批上报 |
| `src/usage/quota-do.js` | 改为连接注册中心 + stop 标志管理；移除配额存储（配额在管理层 D1） |
| `src/admission/service.js` | 准入逻辑从查 D1 改为调 Service Binding |
| `src/admission/repositories.js` | 删除 D1 准入仓库，改为 Service Binding 仓库 |
| `src/users/service.js` | 封禁/续费操作新增调 `TRANSMISSION` Service Binding 通知传输层 |
| `src/proxy/pipeline.js` | 流量统计从 DO 改为本地累计 + 攒批上报；断连检查 stop 标志 |

## 部署后的 Bindings 配置

### 传输层 Worker

| Binding | 类型 | 必要性 | 说明 |
|---------|------|--------|------|
| `KV` | KV | ✅ 必须 | 只读全局传输配置 |
| `USER_ADMIN` | Service Binding | ✅ 必须 | 调用管理层（准入/上报） |
| `QUOTA_DO` | Durable Object | ✅ 必须 | 连接注册中心（自己 export class） |

### 管理层 Worker

| Binding | 类型 | 必要性 | 说明 |
|---------|------|--------|------|
| `DB` | D1 | ✅ 必须 | 用户/会话/封禁/用量/配置 |
| `KV` | KV | ✅ 必须 | 读写全局配置 |
| `TRANSMISSION` | Service Binding | ✅ 必须 | 调用传输层（封禁/续费通知） |
| `ADMIN_BUCKET` | R2 | ❌ 可选 | 功能已禁用，不需要配置 |

### 环境变量（管理层 Worker）

| 变量 | 类型 | 必要性 | 值 |
|------|------|--------|-----|
| `BOOTSTRAP_ADMIN_USER` | Secret | 首次必须 | 管理员用户名 |
| `BOOTSTRAP_ADMIN_PASSWORD` | Secret | 首次必须 | 管理员密码 |
| `CORS_ORIGINS` | Text | 跨源必须 | 前端域名 |
| `TURNSTILE_SECRET_KEY` | Secret | 可选 | Turnstile 密钥 |
| `TURNSTILE_SITE_KEY` | Text | 可选 | Turnstile 公钥 |

## 关键延迟指标

| 场景 | 延迟 | 原因 |
|------|------|------|
| 准入决策 | 毫秒级 | Service Binding 零延迟 + D1 查询 |
| 超限检测 | 最多多消耗 5MB | 攒批周期内不检测 |
| 超限断连 | 最多多跑 5MB | 下次攒批时发现拒绝 |
| 管理员封禁断连 | 最多多跑 5MB | 下次数据传输时检查 stop 标志 |
