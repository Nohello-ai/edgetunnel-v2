# EdgeTunnel Core 3.0.0

这是一个面向 Cloudflare Workers 的独立模块化代理核心。v3 只用于行为对照；本项目的数据路径、认证、存储和节点生成均为独立实现。

## 当前能力

- 协议：VLESS、Trojan（增量首包解析）
- 传输：WebSocket、标准 Hunk protobuf gRPC、XHTTP `stream-one`
- 出站：Cloudflare Sockets 直连 TCP、UDP/53 经 DNS-over-TCP
- 控制面：D1 用户、PBKDF2 密码、随机 Session、角色、禁用、封禁、配额、全局配置
- 订阅：协议 × 传输 × HOSTS 节点展开，支持随机路径、0-RTT、TLS 分片参数和 ECH 参数
- 发布：esbuild 打包为两个单文件 `_worker-transmission.js` 与 `_worker-admin.js`，GitHub Actions artifact 与 Release

## 模块边界

`transport-v2` 只把 HTTP/WebSocket 请求转换成字节流；`protocol-v2` 只解析首包；`admission` 只做 D1 准入；`connector` 只建立出站；`subscription` 只生成 URI。组合只发生在两个入口 `src/index-transmission.js`、`src/index-admin.js` 和 `src/proxy/pipeline.js`。`src/index.js` 为旧单入口，仅作行为对照，不再用于打包。

数据流路径固定为：

```text
/ws/{userID}/{vless|trojan}[/{randomSuffix}]
/grpc/{userID}/{vless|trojan}[/{randomSuffix}]
/xhttp/{userID}/{vless|trojan}[/{randomSuffix}]
```

## 初始化

1. 创建新的 D1 数据库并执行 `migrations/0001_initial.sql`。
2. 参考 `wrangler.example.toml` 绑定数据库为 `DB`。
3. 首次启动前在管理层 Worker 设置 `BOOTSTRAP_ADMIN_USER` 与 `BOOTSTRAP_ADMIN_PASSWORD` secret。
4. 首次请求会在空数据库创建管理员。创建成功后可删除两个 bootstrap secret。
5. 执行 `npm ci && npm test && npm run bundle`，得到 `_worker-transmission.js` 与 `_worker-admin.js`，分别上传到各自的 Cloudflare Worker（唯一的部署方式：JS 文件上传）。

两个 Worker 的变量不同：传输层只需 `DB`/`KV`/`QUOTA_DO`（导出 `QuotaDO` 类）；管理层额外用 `ADMIN_BUCKET`、`BOOTSTRAP_*`、`TURNSTILE_*`，并通过 `QUOTA_DO` 跨 Worker 调用传输层的 DO。详见 README「环境变量与 Secrets」。

密码不会明文存储或放入 URL。控制面使用 `HttpOnly; Secure; SameSite=Strict` Cookie；VLESS UUID 和 Trojan secret 与网页登录密码互相独立。

旧版表中的 `users.password` 是明文，不能通过纯 SQL 安全转换为 PBKDF2。已有旧库不要直接套用新 schema：应创建新库并重新建立用户，或通过受控的密码重置流程逐个迁移。新代码不会读取旧明文密码列。

## API

| 方法 | 路径 | 权限 | 功能 |
| --- | --- | --- | --- |
| POST | `/api/auth/login` | 公开 | 用户名密码登录 |
| POST | `/api/auth/logout` | 登录 | 注销 Session |
| GET | `/api/auth/me` | 登录 | 当前用户 |
| GET/POST | `/api/admin/users` | 管理员 | 用户列表/创建 |
| PATCH/DELETE | `/api/admin/users/{id}` | 管理员 | 修改/删除用户 |
| POST/DELETE | `/api/admin/users/{id}/ban` | 管理员 | 封禁/解封 |
| GET/PATCH | `/api/admin/config` | 管理员 | 全局配置 |
| GET | `/api/users/me/subscription` | 登录 | 当前用户节点列表 |

全局配置字段包括 `protocols`、`transports`、`HOSTS`、`PROXYIP`、`SOCKS5`、`ECH`、`ECHConfig`、`节点参数`、`订阅生成` 和 `反代配置`。当前第一阶段数据路径使用直连；PROXYIP/SOCKS5/复杂反代保留为独立后续连接器配置，不会隐式改变核心链路。

配额会在准入和单连接内执行。多个 Worker isolate 同时建立连接时，D1 计量写回前仍可能产生小幅并发超额；若需要计费级严格配额，应后续接入独立的 Durable Object 配额租约模块。

## 验证命令

```bash
npm test
npm run check
npm run build
```
