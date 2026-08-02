# Checklist

> 本清单用于验证「审查结论」是否准确、完整，以及修复是否落地。每项需对照代码与 login-globe 前端实际行为核对。

## 审查完整性
- [x] 已核对登录路径 `POST /api/auth/login` 在前后端均存在且请求/响应契约一致
- [x] 已核对注册路径 `POST /api/auth/register` 在前后端均存在且请求/响应契约一致
- [x] 已核对用户名正则 `[a-z0-9_.-]{3,64}` 在 HTML `pattern` 与 [src/users/service.js](file:///workspace/src/users/service.js#L10) 一致
- [x] 已核对密码长度 10-256 在 HTML `minlength/maxlength` 与 [src/auth/password.js](file:///workspace/src/auth/password.js#L30) 一致
- [x] 已核对响应体 `{ ok:boolean, ... }` 与错误体 `{ ok:false, error, message }` 在前端解析逻辑中正确处理

## 不适配项验证（修复前）
- [x] 不适配 1（Turnstile 前端缺失）：确认 login-globe `pages/index.html` 修复前全文搜索 `turnstile` 无结果，且无 `turnstileToken` 字段、无 `REQUIRE_CAPTCHA` 分支
- [x] 不适配 1：确认后端 [src/auth/login-attempts.js](file:///workspace/src/auth/login-attempts.js#L4-L6) `CAPTCHA_THRESHOLD = 2` 与 [src/api-v2/router.js](file:///workspace/src/api-v2/router.js#L64-L66) 在 `REQUIRE_CAPTCHA` 时附加 `turnstileSiteKey`
- [x] 不适配 2（跨域 Cookie）：确认 [src/auth/session.js](file:///workspace/src/auth/session.js#L13) 修复前 cookie 含 `SameSite=Strict`
- [x] 不适配 2：确认 login-globe 第 614 行使用 `window.ET_API_BASE` 且 fetch 用 `credentials:'include'`（第 692、707 行 → 修复后第 730、753 行）
- [x] 不适配 3（无 CORS）：确认 [src/index-admin.js](file:///workspace/src/index-admin.js) 与 [src/utils/http.js](file:///workspace/src/utils/http.js) 修复前全文无 `Access-Control-` 头注入，且无 `OPTIONS` 预检处理
- [x] 不适配 4（登录后无跳转）：确认 login-globe 修复前 `doLogin` 成功后仅 `showMessage`，无 `location.href` 跳转、无 `/api/auth/me` 调用

## 修复落地验证
- [x] 不适配 1 修复：login-globe `pages/index.html` 第 257 行引入 Turnstile 脚本，第 467 行新增 `#turnstile-container`，第 692-720 行实现 `renderTurnstile/destroyTurnstile`，第 734、757 行检测 `REQUIRE_CAPTCHA`，第 792-794 行 catch 渲染 widget
- [x] 不适配 1 修复：请求体携带 `turnstileToken` 字段（第 726、749 行），符合后端 [src/api-v2/router.js](file:///workspace/src/api-v2/router.js#L29) 读取逻辑
- [x] 不适配 2 修复：[src/auth/session.js](file:///workspace/src/auth/session.js#L13) 第 13、34 行 cookie 改为 `SameSite=None`
- [x] 不适配 3 修复：新建 [src/utils/cors.js](file:///workspace/src/utils/cors.js) 提供 `getAllowedOrigin/withCorsHeaders/handleOptions`；[src/index-admin.js](file:///workspace/src/index-admin.js#L41-L43) 处理 OPTIONS 预检，所有出口经 `withCorsHeaders` 包裹
- [x] 不适配 3 修复：配置项走环境变量 `CORS_ORIGINS`，无需改 KV `global_config` schema
- [x] 不适配 4 修复：login-globe `doLogin` 成功后 600ms 跳转（第 743-744 行），跨源 → `/api/users/me/subscription`，同源 → `/`
- [x] 后端验证：`npm test` 97/97 通过，`npm run check` 通过，`npm run bundle` 产出 `_worker-admin.js`（57.7kb）+ `_worker-transmission.js`（77.8kb）

## 次要点验证
- [x] 静态资源路径：login-globe 跨源自托管，不再依赖 admin Worker R2，路径冲突问题消除
- [x] 忘记密码：前端仅提示「联系管理员」，后端无对应 API（设计一致，非不适配）

## 结论
- [x] spec.md 的「适配结论总览」表格每行均经代码核对
- [x] spec.md 的「不适配项详述」4 项均有具体代码行号或文件引用支撑
- [x] tasks.md 的修复任务与不适配项一一对应，Task 1-5 已勾选完成，Task 6 留待用户决策
- [x] 所有不适配项（1/2/3/4）均已修复并通过后端测试与 bundle 验证
