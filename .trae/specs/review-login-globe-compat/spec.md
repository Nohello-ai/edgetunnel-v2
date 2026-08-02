# EdgeTunnel × login-globe 适配审查 Spec

## Why
`https://github.com/Nohello-ai/login-globe` 是一个为 EdgeTunnel 设计的「旋转地球登录页」（纯静态 HTML，100% HTML），其提交说明明确写明 "login page with edgetunnel-v2 API integration"。需要审查当前 EdgeTunnel Core 代码与该登录页的契约是否真正适配，并把不匹配的点明确列出，避免直接部署后出现「登录失败 / 登录后无态 / 卡在人机验证」等问题。

## 审查范围

### 已审查的 EdgeTunnel 代码
- [src/api-v2/router.js](file:///workspace/src/api-v2/router.js) — 控制面路由（login/register/logout/me/admin/subscription）
- [src/auth/service.js](file:///workspace/src/auth/service.js) — 登录主流程
- [src/auth/password.js](file:///workspace/src/auth/password.js) — 密码校验规则（10-256 位）
- [src/auth/session.js](file:///workspace/src/auth/session.js) — Session Cookie 设置
- [src/auth/login-attempts.js](file:///workspace/src/auth/login-attempts.js) — 失败计数 / Turnstile 门槛 / 锁定
- [src/users/service.js](file:///workspace/src/users/service.js) — 注册（用户名正则 / 配额同步）
- [src/users/repository.js](file:///workspace/src/users/repository.js#L50-L54) — `publicUser` 输出形状
- [src/utils/crypto.js](file:///workspace/src/utils/crypto.js#L48-L50) — `normalizeUsername`
- [src/routes/router.js](file:///workspace/src/routes/router.js) — 请求分类
- [src/index-admin.js](file:///workspace/src/index-admin.js) — 静态资源托管（R2）

### 已审查的 login-globe 代码
- `pages/index.html`（751 行，唯一交互页面）
- `validation-report.json`、`.design`、`runtime-orchestration-summary.json`

## What Changes
本次为**只读审查**，不改动任何代码。下面列出适配结论与不匹配项；如需修复，见 `tasks.md`。

## 适配结论总览

| 契约点 | EdgeTunnel 后端 | login-globe 前端 | 是否适配 |
|--------|----------------|------------------|---------|
| 登录路径 `POST /api/auth/login` | ✓ 实现 | ✓ 调用 | ✅ 适配 |
| 注册路径 `POST /api/auth/register` | ✓ 实现 | ✓ 调用 | ✅ 适配 |
| 请求体 `{ username, password }` | ✓ 接受 | ✓ 发送 | ✅ 适配 |
| 响应体 `{ ok: boolean, ... }` | ✓ 返回 | ✓ 解析 `data.ok` | ✅ 适配 |
| 错误体 `{ ok:false, error, message }` | ✓ 返回 | ✓ 读取 `message/error` | ✅ 适配 |
| 用户名正则 `[a-z0-9_.-]{3,64}` | ✓ 一致 | ✓ HTML `pattern` 一致 | ✅ 适配 |
| 密码长度 10-256 | ✓ 校验 | ✓ HTML `minlength/maxlength` | ✅ 适配 |
| 注册成功 201 状态码 | ✓ 返回 201 | ✓ `response.ok` 201 仍为 true | ✅ 适配 |
| **Turnstile 人机验证** | ✓ 失败 2 次后返回 `REQUIRE_CAPTCHA` + `turnstileSiteKey` | ✗ **完全未实现** widget / token / 错误码分支 | ❌ **不适配** |
| **跨域 Cookie** | `SameSite=Strict; HttpOnly; Secure` | 用 `credentials:'include'` + `window.ET_API_BASE` 支持跨域 | ❌ **跨域不适配**（同域可用） |
| **CORS 响应头** | ✗ 未注入任何 CORS 头 | 跨域时浏览器会预检失败 | ❌ **跨域不适配** |
| 登录后跳转 / 后续面板 | 后端有 R2 静态托管 + admin API | 仅 `showMessage('登录成功')`，无跳转、无 `/api/auth/me` | ⚠️ 流程不完整 |
| 静态资源 R2 key | `/assets/...` → key `assets/...` | `mask-image:url(../assets/...)` 解析为 `/assets/...` | ✅ 同 bucket 部署可适配 |
| `forgot password` | 无对应 API | 仅提示「联系管理员」 | ✅ 设计一致，非不适配 |

## Impact
- 受影响的能力：登录 / 注册 / 人机验证 / 跨域部署 / 登录后流程
- 受影响的代码（若要修复，见 tasks.md）：
  - 前端 `pages/index.html`（login-globe 仓库，非本仓库）
  - 后端 [src/auth/session.js](file:///workspace/src/auth/session.js)（SameSite 策略）
  - 后端 [src/api-v2/router.js](file:///workspace/src/api-v2/router.js) 或 [src/index-admin.js](file:///workspace/src/index-admin.js)（CORS 头）

## 不适配项详述（核心交付）

### 不适配 1：Turnstile 人机验证前端缺失（最严重）
**现象**：
- 后端 [src/auth/login-attempts.js](file:///workspace/src/auth/login-attempts.js#L4-L6) 设定 `CAPTCHA_THRESHOLD = 2`：同一 IP 或同一用户名失败 2 次后（且后端配置了 `TURNSTILE_*`），[src/api-v2/router.js](file:///workspace/src/api-v2/router.js#L64-L66) 会抛 `REQUIRE_CAPTCHA`（403）并在响应体附加 `turnstileSiteKey`。
- login-globe 的 `pages/index.html` 第 688-716 行的 `doLogin/doRegister` **只读取 `data.message/data.error`**，没有：
  - 渲染 Cloudflare Turnstile widget 的容器
  - 在请求体里附带 `turnstileToken` 字段
  - 捕获 `error === 'REQUIRE_CAPTCHA'` 后展示 widget、拿到 token 再重发的分支
- **后果**：一旦触达 2 次失败门槛，前端会无限循环「登录失败 → 重试 → 仍缺 token → 失败」，直到 10 次失败被锁 IP 15 分钟。用户无法自助解锁。

### 不适配 2：跨域 Cookie 不可用（SameSite=Strict）
**现象**：
- 后端 [src/auth/session.js](file:///workspace/src/auth/session.js#L13) 下发的 cookie 为 `edt_session=...; Path=/; Max-Age=86400; HttpOnly; Secure; SameSite=Strict`。
- login-globe 第 614 行 `const API_BASE = window.ET_API_BASE || ''` 暴露了「跨域调用」的预期，且 fetch 用 `credentials: 'include'`。
- `SameSite=Strict` 在**跨站**请求下浏览器不会发送 cookie，更关键的是：**跨站首次 Set-Cookie 也会被浏览器丢弃**（Strict 模式下跨站响应的 cookie 不写入）。
- **后果**：若 login-globe 部署在与 admin Worker 不同域名（哪怕不同子域）下，`POST /api/auth/login` 即使返回 200，cookie 也不会被浏览器保存，后续 `/api/auth/me` 等接口拿不到 session，登录态无法保持。前端显示「登录成功」但实际未登录。
- **规避**：必须**同源部署**（login-globe 与 admin Worker 同一域名同一端口），或后端将 SameSite 改为 `None; Secure` 并配套 CORS。

### 不适配 3：后端无 CORS 支持
**现象**：
- 后端 [src/utils/http.js](file:///workspace/src/utils/http.js) 的 `jsonResponse` 与 [src/index-admin.js](file:///workspace/src/index-admin.js) 均未注入 `Access-Control-Allow-Origin`、`Access-Control-Allow-Credentials`、`Access-Control-Allow-Headers`、`Access-Control-Allow-Methods`。
- 跨域 fetch + `credentials: 'include'` 时，浏览器会先发 `OPTIONS` 预检，后端无 OPTIONS 处理器也无 CORS 头 → 请求被浏览器拦截。
- **后果**：跨域部署时连登录请求都发不出去（浏览器预检失败）。
- **规避**：同源部署可完全绕过此问题。

### 不适配 4：登录后流程缺失（功能性不完整）
**现象**：
- 后端 admin Worker 支持 R2 托管完整管理面板（`/index.html`、用户列表、配置、订阅等），并有 `GET /api/auth/me` 拉取当前用户与实时用量。
- login-globe 登录成功仅 `showMessage('登录成功', 'success')`（第 699 行），**无任何跳转**、**无 `/api/auth/me` 调用**、**无管理面板链接**。
- **后果**：用户登录后停留在登录页，看不到下一步。这不算严格的 API 不适配（接口调用本身成功），但作为「登录页」与 EdgeTunnel 的完整流程对接是不完整的。需要前端补一个登录成功后跳转（如 `location.href = '/'` 跳到面板首页，或显示订阅链接）。

### 次要点（非阻塞，记录在案）
- **静态资源路径**：login-globe 引用 `../assets/icons/dl_builtin_apple/user.svg`（相对 `/index.html` 解析为 `/assets/icons/dl_builtin_apple/user.svg`）。若把 login-globe 的 `pages/index.html` 重命名为 `index.html` 放 R2 根，并把 `assets/` 目录一并上传，则与 [src/index-admin.js](file:///workspace/src/index-admin.js#L50-L63) 的 R2 托管逻辑兼容。但会**覆盖**原管理面板首页。
- **CDN 依赖**：login-globe 依赖 `cdn.jsdelivr.net`（tailwind/d3/world-atlas）与 `unpkg.com`（lucide），在受限网络下可能加载失败，与后端无关。
- **忘记密码**：前端仅提示「联系管理员」，后端无对应 API，属设计一致。

## ADDED Requirements

### Requirement: 前端 Turnstile 适配（修复不适配 1）
login-globe 的登录/注册表单 SHALL 在收到 `403 REQUIRE_CAPTCHA` 响应后，读取响应体的 `turnstileSiteKey`，渲染 Cloudflare Turnstile widget，用户完成验证后将 token 以 `turnstileToken` 字段重发原请求。

#### Scenario: 失败 2 次后人机验证
- **WHEN** 同一 IP 或用户名连续登录/注册失败达到 2 次，且后端配置了 `TURNSTILE_SECRET_KEY`/`TURNSTILE_SITE_KEY`
- **THEN** 后端返回 `403 { ok:false, error:'REQUIRE_CAPTCHA', turnstileSiteKey:'...' }`
- **AND** 前端应展示 Turnstile widget，拿到 token 后带 `turnstileToken` 重发，登录/注册恢复正常

### Requirement: 跨域部署支持（修复不适配 2 & 3，可选）
**仅在 login-globe 与 admin Worker 不同源部署时才需要**。系统 SHALL 通过以下任一方式支持跨域：
- 方式 A（推荐，零后端改动）：login-globe 与 admin Worker **同源部署**（同一域名），此时 `SameSite=Strict` 与无 CORS 均不影响。
- 方式 B：后端将 session cookie 改为 `SameSite=None; Secure`，并在 [src/api-v2/router.js](file:///workspace/src/api-v2/router.js) 增加 CORS 头（`Access-Control-Allow-Origin: <login-globe 域名>`、`Access-Control-Allow-Credentials: true`、允许 `Content-Type` 头、处理 `OPTIONS` 预检）。

#### Scenario: 同源部署（默认推荐）
- **WHEN** login-globe 与 admin Worker 部署在同一域名下
- **THEN** cookie 正常写入与发送，无需任何后端改动

#### Scenario: 跨源部署
- **WHEN** login-globe 部署在与 admin Worker 不同的域名
- **AND** 后端未做 CORS / SameSite 调整
- **THEN** 登录请求被浏览器预检拦截或 cookie 无法写入，登录态无法建立

### Requirement: 登录后跳转（修复不适配 4，可选）
login-globe 登录成功后 SHALL 调用 `GET /api/auth/me` 确认身份并跳转到管理面板首页（如 `location.href = '/'`），或显示用户订阅链接。

#### Scenario: 登录成功跳转
- **WHEN** `POST /api/auth/login` 返回 `{ ok:true, user }`
- **THEN** 前端跳转到管理面板（同源时）或显示用户信息与订阅入口

## MODIFIED Requirements
无（本次为只读审查，未修改任何现有需求）。

## REMOVED Requirements
无。
