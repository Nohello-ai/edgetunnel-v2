# Tasks

> 本次审查为**只读分析**，主交付物是 `spec.md` 中的「不适配项详述」。下列任务仅在用户**确认要修复**时才执行；不确认则不改动任何代码。

- [x] Task 1: 确认部署形态（决定是否需要修复不适配 2/3）
  - [x] SubTask 1.1: 用户确认——前后端分仓、单独部署（跨源）
  - [x] SubTask 1.2: 跨源 → 进入 Task 3、Task 4
- [x] Task 2: 前端补 Turnstile 适配（修复不适配 1，**最优先**，发生在 login-globe 仓库）
  - [x] SubTask 2.1: 在 `pages/index.html` 表单内增加 Turnstile widget 容器（`<div id="turnstile-container">`，第 467 行）
  - [x] SubTask 2.2: 引入 `https://challenges.cloudflare.com/turnstile/v0/api.js` 异步脚本（第 257 行）
  - [x] SubTask 2.3: 在 `doLogin/doRegister` 中检测 `403 + data.error === 'REQUIRE_CAPTCHA'`，读取 `turnstileSiteKey`，调用 `renderTurnstile()` 渲染 widget（第 734、757 行）
  - [x] SubTask 2.4: 用户完成验证后 `state.turnstileToken` 自动写入，submit 时随请求体重发（第 726、749、787、789 行）
  - [x] SubTask 2.5: 验证流程已构建（catch 中识别 sentinel 错误 → 渲染 widget → 用户验证 → 重发携带 token）
- [x] Task 3: 后端跨域 Cookie 调整（修复不适配 2，**仅跨源部署时需要**）
  - [x] SubTask 3.1: [src/auth/session.js](file:///workspace/src/auth/session.js#L13) cookie 由 `SameSite=Strict` 改为 `SameSite=None`
  - [x] SubTask 3.2: `revoke` 清除 cookie 同步改为 `SameSite=None`（第 34 行）
  - [x] SubTask 3.3: admin Worker 域名天然 HTTPS（Cloudflare Workers 强制 HTTPS，`Secure` 前置条件已满足）
- [x] Task 4: 后端 CORS 支持（修复不适配 3，**仅跨源部署时需要**）
  - [x] SubTask 4.1: [src/index-admin.js](file:///workspace/src/index-admin.js#L41-L43) 顶部处理 `OPTIONS` 预检（未配置允许源返回 403）
  - [x] SubTask 4.2: 新建 [src/utils/cors.js](file:///workspace/src/utils/cors.js) 注入 `Access-Control-Allow-Origin`、`Allow-Credentials: true`、`Allow-Headers: Content-Type, x-turnstile-token`、`Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS`；所有响应出口经 `withCorsHeaders()` 包裹
  - [x] SubTask 4.3: 配置项简化为环境变量 `CORS_ORIGINS`（逗号/换行分隔），未触碰 KV `global_config`
- [x] Task 5: 前端登录后跳转（修复不适配 4，**可选**，发生在 login-globe 仓库）
  - [x] SubTask 5.1: `doLogin` 成功后 `destroyTurnstile()` 清理 widget，再 `showMessage('登录成功')`
  - [x] SubTask 5.2: 跨源（`ET_API_BASE` 非空）→ 跳 `/api/users/me/subscription`；同源 → 跳 `/`（第 743-744 行）
- [ ] Task 6: 静态资源部署方案确认（次要点，**可选**，待用户决策）
  - [ ] SubTask 6.1: 因前后端分仓跨源部署，login-globe 自行托管（如 Pages/Vercel/Nginx），不再上传 admin Worker 的 R2
  - [ ] SubTask 6.2: 不存在覆盖原管理面板首页的问题

# Task Dependencies
- Task 2 独立，可立即执行（最优先）
- Task 3、Task 4 依赖 Task 1 的结论（同源则不做）
- Task 5 独立，可与 Task 2 并行
- Task 6 依赖用户对部署形态的决策
