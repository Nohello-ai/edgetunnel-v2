# edgetunnel-v4 项目文档

> 本文档为接手开发者（AI 或人类）提供完整的项目介绍、文件结构、功能说明与开发指引。
> 阅读本文档前，请先阅读 `README.md` 了解项目定位；本文档聚焦"怎么继续开发"。

---

## 一、项目概述

edgetunnel-v4 是部署在 **Cloudflare Workers** 上的边缘代理项目，核心特性：

1. **多用户隔离**：每个用户通过「用户名 + 密码 + 环境变量 ID」生成唯一的 UUID，互不干扰
2. **API 系统**：用户管理、通知系统、全局配置、订阅、用量统计
3. **代理能力（规划）**：WebSocket / gRPC / XHTTP 三种传输层，支持 VLESS / Trojan / Shadowsocks 协议
4. **KV 存储**：所有用户配置、通知、用量均存于 Cloudflare KV

### 核心设计原则

- **指针式路由**：不遍历识别协议，直接根据 userID 查表调用对应 Handler
- **权限分离**：管理员（userID == 环境变量 `ID`）拥有全部权限，普通用户仅能操作自己的数据
- **前后端分离**：管理面板作为独立前端项目，通过 REST API 与 Worker 交互

---

## 二、文件结构总览

```
edgetunnel-v4/
├── src/
│   ├── index.js                 # 统一入口（只做请求类型判断 + 分发）
│   ├── constants.js             # 常量定义
│   ├── state.js                 # 全局状态（可选）
│   │
│   ├── api/                     # API 系统（用户管理 + 通知）
│   │   ├── index.js             # API 入口：认证 + 路由分发
│   │   ├── handler.js           # 用户/配置/订阅/用量 API 处理器
│   │   ├── notification.js      # 通知系统（私聊/全站/系统通知）
│   │   └── loader.js            # KV 读写封装（可选，或放 config/）
│   │
│   ├── config/                  # 配置系统
│   │   ├── user-routes.js       # 用户路由表（userID → Handler 指针）
│   │   ├── loader.js            # KV 读写封装
│   │   └── schema.js            # 配置结构校验
│   │
│   ├── utils/                   # 工具函数
│   │   ├── crypto.js            # 生成用户 ID（SHA-256）、MD5 等
│   │   ├── log.js               # 日志（调试开关 + 输出）
│   │   ├── base64.js            # Base64 编解码
│   │   ├── bytes.js             # 字节/二进制工具（规划）
│   │   └── misc.js              # 杂项工具
│   │
│   ├── proxy/                   # 代理模块（待实现）
│   │   ├── index.js             # 代理入口：UserID 校验 + 传输分发
│   │   ├── transport/           # 传输层（ws / grpc / xhttp）
│   │   ├── protocol/            # 协议解析（vless / trojan / shadowsocks）
│   │   ├── stream/              # 流处理（queue / grain / pipe / forward）
│   │   ├── connector/           # 出站连接器（factory / http / socks5 / turn）
│   │   └── net/                 # 网络工具（doh / address / resolver）
│   │
│   ├── transport/               # 【规划】传输层独立目录（或并入 proxy/）
│   │   ├── ws.js                # WebSocket 传输
│   │   ├── grpc.js              # gRPC 传输
│   │   └── xhttp.js             # XHTTP 传输
│   │
│   ├── protocol/                # 【规划】协议解析
│   │   ├── vless.js             # VLESS
│   │   ├── trojan.js            # Trojan
│   │   └── shadowsocks.js       # Shadowsocks（AEAD）
│   │
│   ├── stream/                  # 【规划】流处理
│   │   ├── queue.js             # 上行写入队列
│   │   ├── grain.js             # 下行数据包聚合
│   │   ├── pipe.js              # 双向流桥接
│   │   ├── forward.js           # TCP/UDP 转发核心
│   │   └── utils.js             # WebSocket 工具
│   │
│   ├── connector/               # 【规划】出站连接器
│   │   ├── factory.js           # TCP 连接器工厂
│   │   ├── http.js              # HTTP 代理连接
│   │   ├── socks5.js            # SOCKS5 代理连接
│   │   └── turn.js              # TURN 连接（可选）
│   │
│   ├── subscription/            # 【规划】订阅生成
│   │   ├── clash.js             # Clash 订阅
│   │   ├── singbox.js           # Sing-box 订阅
│   │   └── surge.js             # Surge 订阅
│   │
│   ├── net/                     # 【规划】网络工具
│   │   ├── address.js           # 地址解析
│   │   ├── doh.js               # DNS over HTTPS
│   │   ├── proxy.js             # 反代地址解析
│   │   └── resolver.js          # DNS 解析器
│   │
│   └── admin/                   # 【规划】管理面板（或独立前端项目）
│       └── placeholder.js       # 占位符
│
├── API.md                       # API 接口文档
├── README.md                    # 项目简介
├── CHANGELOG.md                 # 变更记录
├── package.json                 # 依赖与脚本
├── wrangler.toml                # Cloudflare 配置
└── scripts/
    └── build.mjs                # 构建为单文件脚本
```

---

## 三、模块功能说明

### 1. 统一入口 `src/index.js`（唯一入口）

职责：**判断请求类型并分发，不做任何业务逻辑**。

```
请求进来
   ↓
校验环境变量 ID（必须是 UUID v4）
   ↓
判断路径：
   /api/*         → 转发 api/index.js（API 系统）
   /login,/admin,
   /sub,/version  → 静态资源（占位）
   其他           → 转发 proxy/index.js（代理数据流）
```

关键约定：
- 环境变量 `ID`：一个 UUID v4，作为「盐」和管理员身份标识
- 管理员 userID **等于** 环境变量 `ID`
- 普通用户 userID = `生成用户ID(username, password, ID)`

### 2. API 系统 `src/api/`

#### `index.js` — API 入口
```
请求 → 提取 username/password → 计算 userID → 验证权限 → 按资源类型分发
```

#### `handler.js` — 核心 API 处理器
| 资源类型 | 路径 | 权限 | 说明 |
|---------|------|------|------|
| 用户 | `/api/user/list` | 管理员 | 列出所有用户 |
| 用户 | `/api/user/add` | 管理员 | 添加用户 |
| 用户 | `/api/user/update` | 管理员/本人 | 更新传输配置 |
| 用户 | `/api/user/disable` | 管理员 | 禁用用户 |
| 用户 | `/api/user/ban` | 管理员 | 封禁（可带原因/时长） |
| 用户 | `/api/user/unban` | 管理员 | 解封 |
| 用户 | `/api/user/:userID` | 管理员/本人 | 查询用户 + 封禁状态 |
| 配置 | `/api/config/global` | 管理员 | 获取/修改全局配置 |
| 订阅 | `/api/subscription/link` | 本人 | 获取订阅链接 |
| 订阅 | `/api/subscription/nodes` | 本人 | 获取节点列表 |
| 用量 | `/api/usage/:userID` | 管理员/本人 | 查询用量 |
| 用量 | `/api/usage/list` | 管理员 | 所有用户用量 |

#### `notification.js` — 通知系统
| 类型 | 说明 | 发送者 |
|------|------|--------|
| `private` | 私聊通知 | 管理员 |
| `global` | 全站广播 | 管理员 |
| `system` | 系统自动通知（封禁/解封时自动触发） | 系统 |

接口：`send` / `broadcast` / `list` / `unread` / `read` / `global`

### 3. 配置系统 `src/config/`

- `user-routes.js`：内存路由表，userID → handler 指针（指针式路由核心）
- `loader.js`：KV 读写封装（`get/set/delete` 用户、封禁、通知、用量、全局配置）
- `schema.js`：配置结构校验（可基于 zod）

### 4. 工具函数 `src/utils/`

#### `crypto.js`（**核心，必须优先实现**）
```js
// 生成用户唯一 ID（UUID v4 格式）
生成用户ID(username, password, ID)
// = SHA-256(`${ID}:${username}:${password}`)  →  格式化为 UUID v4
```

#### `log.js`
```js
log(message)    // 调试模式才输出
error(message)  // 始终输出
```

### 5. 代理模块 `src/proxy/`（待实现）

```
代理请求 → proxy/index.js
   → 校验 userID 有效性
   → 判断传输类型（WebSocket / gRPC / XHTTP）
   → 调用对应 transport Handler
   → 协议识别（VLESS / Trojan / Shadowsocks）
   → 建立到目标服务器的 TCP 连接（connector/）
   → 双向数据转发（stream/）
```

---

## 四、环境变量与使用

### 环境变量（wrangler.toml）

```toml
[vars]
ID = "你的 UUID v4"   # 必须，管理员身份 + 用户 ID 生成盐

[[kv_namespaces]]
binding = "KV"        # 必须，存储用户/通知/用量数据
id = "你的 KV 命名空间 ID"
```

### KV 键结构

| 键 | 内容 |
|----|------|
| `user:{userID}` | 用户配置 |
| `ban:{userID}` | 封禁记录 |
| `notification:{userID}` | 用户通知列表 |
| `notification:global` | 全局通知 |
| `usage:{userID}` | 用量统计 |
| `config:global` | 全局配置 |

### API 调用示例

```bash
# 管理员操作（username/password 计算后 == ID 即为管理员）
curl "https://域名/api/user/list?username=admin&password=你的密码"

# 添加用户
curl -X POST "https://域名/api/user/add?username=admin&password=你的密码" \
  -H "Content-Type: application/json" \
  -d '{"userID":"用户生成的UUID","transport":"websocket"}'

# 普通用户修改自己配置
curl -X POST "https://域名/api/user/update?username=张三&password=123456" \
  -H "Content-Type: application/json" \
  -d '{"transport":"grpc"}'

# 封禁用户
curl -X POST "https://域名/api/user/ban?username=admin&password=你的密码" \
  -H "Content-Type: application/json" \
  -d '{"userID":"xxx","reason":"滥用","duration":86400}'
```

---

## 五、已完成 / 未完成 / 规划

### ✅ 已完成（本次会话确定的设计）

| 模块 | 状态 |
|------|------|
| 统一入口设计（index.js 分发逻辑） | 设计完成 |
| 认证机制（username+password+ID → UUID） | 设计完成 |
| API 系统结构（handler / notification） | 设计完成 |
| KV 键结构设计 | 设计完成 |
| 封禁/解封/通知联动逻辑 | 设计完成 |

### ⚠️ 未完成（需要继续开发）

| 模块 | 优先级 | 说明 |
|------|--------|------|
| `src/index.js` 实现 | 高 | 已设计，需落代码 |
| `src/api/*` 实现 | 高 | handler/notification/index 完整实现 |
| `src/config/loader.js` | 高 | KV 读写封装 |
| `src/utils/crypto.js` | 高 | 生成用户 ID 核心函数 |
| `src/utils/log.js` | 高 | 日志工具 |
| `src/proxy/index.js` | 高 | 代理入口（用户校验 + 传输分发） |
| `src/transport/*` | 中 | ws/grpc/xhttp 传输层 |
| `src/protocol/*` | 中 | vless/trojan/shadowsocks 解析 |
| `src/stream/*` | 中 | queue/grain/pipe/forward |
| `src/connector/*` | 中 | factory/http/socks5 |
| `src/subscription/*` | 低 | clash/singbox/surge |
| `src/net/*` | 低 | doh/address/resolver |
| `wrangler.toml` | 高 | 配置 KV + ID 变量 |
| `package.json` | 高 | 依赖与脚本 |

### 🎯 发展方向

1. **短期**：完成 API 系统全部实现 → 跑通用户管理 + 通知
2. **中期**：实现 WebSocket 传输 + VLESS 协议 → 实现基本代理
3. **长期**：gRPC/XHTTP 传输、SS/Trojan 协议、订阅生成、管理面板前端
4. **优化**：构建为单文件、用量统计、限流、反代支持

---

## 六、关于重复实现的提示（重要）

> 以下提示用于避免重复造轮子或踩坑，接手开发前务必阅读。

### 1. 旧版（edgetunnel-v3/v2）已有成熟实现

历史仓库中已有经过验证的完整实现，**不要重新发明**，应参考迁移：

| 模块 | 旧版文件 | 说明 |
|------|---------|------|
| WebSocket 传输 | `transport/ws.js` | 444 行，含 EarlyData/SS/测速 |
| gRPC 传输 | `transport/grpc.js` | 328 行，帧解析/双向流 |
| XHTTP 传输 | `transport/xhttp.js` | 332 行，首包解析 |
| TCP/UDP 转发 | `stream/forward.js` | 337 行，反代/竞速/代理 |
| 流处理工具 | `stream/utils.js` | closeSocketQuietly/204 响应 |
| 字节工具 | `utils/bytes.js` | 数据转Uint8Array/拼接/长度 |

> 迁移时注意：**v4 的认证方式已改变**（从 ADMIN+KEY 的 doubleMd5 改为 username+password+ID 的 SHA-256），旧代码中所有 `yourUUID` 相关逻辑需适配新的用户 ID 生成方式。

### 2. 命名约定（中文变量名）

项目沿用中文命名风格，如 `处理API请求`、`验证用户权限`、`生成用户ID`。**新代码保持一致**，不要混用中英文命名。

### 3. 避免重复的功能

- **Base64 编解码**：Node 环境用内置，Workers 环境用 `atob/btoa`，已有 `utils/base64.js` 骨架，不要另写
- **日志**：统一用 `utils/log.js`，不要到处 `console.log` 后散落各处
- **KV 读写**：统一封装在 `config/loader.js`，各模块不要直接操作 `env.KV`（handler 中封禁/通知联动除外）
- **MD5/SHA**：统一放 `utils/crypto.js`，双 MD5 旧方案已废弃

### 4. 关键坑点

- **环境变量 `ID` 必须是 UUID v4 格式**，index.js 会校验，格式错误直接 503
- **管理员身份**：`userID === env.ID` 即为管理员，不要用别的方式判断
- **普通用户权限**：只能改自己的配置，update/query 时必须校验 `userID === 目标userID`
- **封禁与禁用区别**：disable（临时停用，无记录） vs ban（惩罚性，记录原因/时长，可自动解封）
- **通知上限**：KV 中每用户最多保留 100 条通知，超出删除最旧

---

## 七、快速上手

```bash
# 1. 安装依赖
npm install

# 2. 配置 wrangler.toml（ID + KV）

# 3. 本地调试
npm run dev

# 4. 部署
npm run deploy

# 5. 构建单文件
npm run build
```

---

*文档版本：v4.0.0 | 生成时间：2026-07-31*
