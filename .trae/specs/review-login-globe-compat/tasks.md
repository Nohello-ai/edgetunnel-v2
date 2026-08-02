# Tasks

> 本次审查为**只读分析**，主交付物是 `spec.md` 中的「不适配项详述」。下列任务仅在用户**确认要修复**时才执行；不确认则不改动任何代码。

- [ ] Task 1: 确认部署形态（决定是否需要修复不适配 2/3）
  - [ ] SubTask 1.1: 与用户确认 login-globe 是否与 admin Worker 同源部署
  - [ ] SubTask 1.2: 若同源 → 跳过 Task 3、Task 4；若跨源 → 进入 Task 3、Task 4
- [ ] Task 2: 前端补 Turnstile 适配（修复不适配 1，**最优先**，发生在 login-globe 仓库）
  - [ ] SubTask 2.1: 在 `pages/index.html` 表单内增加 Turnstile widget 容器（`<div id="cf-turnstile">`）
  - [ ] SubTask 2.2: 引入 `https://challenges.cloudflare.com/turnstile/v0/api.js` 异步脚本
  - [ ] SubTask 2.3: 在 `doLogin/doRegister` 的 catch 分支捕获 `error === 'REQUIRE_CAPTCHA'`，读取响应体 `turnstileSiteKey`，渲染 widget
  - [ ] SubTask 2.4: 用户完成验证后，将 token 以 `turnstileToken` 字段加入请求体重发
  - [ ] SubTask 2.5: 验证流程：故意失败 2 次 → 出现 widget → 通过后登录成功
- [ ] Task 3: 后端跨域 Cookie 调整（修复不适配 2，**仅跨源部署时需要**）
  - [ ] SubTask 3.1: 修改 [src/auth/session.js](file:///workspace/src/auth/session.js#L13) 的 cookie 由 `SameSite=Strict` 改为 `SameSite=None; Secure`
  - [ ] SubTask 3.2: 同步修改 `revoke` 的清除 cookie（第 34 行）
  - [ ] SubTask 3.3: 确认 admin Worker 域名为 HTTPS（`Secure` 前置条件）
- [ ] Task 4: 后端 CORS 支持（修复不适配 3，**仅跨源部署时需要**）
  - [ ] SubTask 4.1: 在 [src/index-admin.js](file:///workspace/src/index-admin.js) 顶部处理 `OPTIONS` 预检请求
  - [ ] SubTask 4.2: 在 `jsonResponse` 或路由出口注入 `Access-Control-Allow-Origin`（白名单 login-globe 域名）、`Access-Control-Allow-Credentials: true`、`Access-Control-Allow-Headers: Content-Type, x-turnstile-token`、`Access-Control-Allow-Methods: GET, POST, PATCH, DELETE`
  - [ ] SubTask 4.3: 增加配置项（如 KV `global_config` 增加 `corsOrigins`）控制允许的来源
- [ ] Task 5: 前端登录后跳转（修复不适配 4，**可选**，发生在 login-globe 仓库）
  - [ ] SubTask 5.1: `doLogin` 成功后调用 `GET /api/auth/me` 确认身份
  - [ ] SubTask 5.2: 跳转到管理面板（`location.href = '/'`）或显示订阅链接 `/api/users/me/subscription`
- [ ] Task 6: 静态资源部署方案确认（次要点，**可选**）
  - [ ] SubTask 6.1: 决定是否把 login-globe 的 `pages/index.html`（重命名为 `index.html`）+ `assets/` 上传到 admin Worker 的 R2 bucket
  - [ ] SubTask 6.2: 注意会覆盖原管理面板首页，需评估是否保留原面板或用子路径区分

# Task Dependencies
- Task 2 独立，可立即执行（最优先）
- Task 3、Task 4 依赖 Task 1 的结论（同源则不做）
- Task 5 独立，可与 Task 2 并行
- Task 6 依赖用户对部署形态的决策
