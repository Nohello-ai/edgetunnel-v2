# EdgeTunnel Core 代码审查 - The Implementation Plan (Decomposed and Prioritized Task List)

## [x] Task 1: 基础验证 - 语法检查与测试运行
- **Priority**: high
- **Depends On**: None
- **Description**:
  - 执行 `npm run check` 对所有 .js 文件做语法检查
  - 执行 `npm test` 运行现有 21 个测试文件
  - 记录测试通过数、失败数、跳过数
  - 保存两份命令的完整输出供后续分析
- **Acceptance Criteria Addressed**: AC-5, AC-6
- **Test Requirements**:
  - `programmatic` TR-1.1: `npm run check` 返回 exit code 0，无 SyntaxError 输出
  - `programmatic` TR-1.2: `npm test` 返回 exit code 0，记录通过/失败/跳过的断言数量
  - `human-judgement` TR-1.3: 如有失败测试，逐个标注失败用例文件名 + 错误信息 + 可疑代码位置
- **Notes**: 此任务是所有后续审查的前置条件；如果测试大面积失败需先报告，不阻塞静态审查继续

## [x] Task 2: 安全审查 - 认证与用户模块
- **Priority**: high
- **Depends On**: Task 1
- **Description**:
  - 审查 `src/auth/` 下 6 个文件：password.js（PBKDF2 参数）、session.js（token 生成/哈希/过期）、service.js（登录/注册/注销）、guards.js（角色守卫）、login-attempts.js（锁定逻辑）、bootstrap.js（首次引导）
  - 审查 `src/users/` 下 3 个文件：repository.js（SQL 注入）、service.js（用户 CRUD）、governance.js（封禁/解封与 DO 踢线联动）
  - 审查 `src/admission/` 下 2 个文件：service.js（5 道关卡）、repositories.js（依赖工厂）
- **Acceptance Criteria Addressed**: AC-1, AC-7, AC-8
- **Test Requirements**:
  - `human-judgement` TR-2.1: PBKDF2 迭代次数、salt 长度、密钥长度三项参数是否符合 OWASP 推荐（>= 600k 迭代 / 16B salt / 32B key）
  - `human-judgement` TR-2.2: 所有 D1 SQL 使用参数化查询，无字符串拼接 SQL；标注所有 .prepare() 调用点
  - `human-judgement` TR-2.3: Session Cookie 属性包含 HttpOnly + Secure + SameSite=Strict；登录/注册密码输入长度校验
  - `human-judgement` TR-2.4: 角色守卫 requireAdmin / requireLogin 在所有 /api/admin/* 路由正确使用，检查 createApiRouter 中每条路由的守卫挂载
  - `human-judgement` TR-2.5: 登录失败锁定（5 次/15min）逻辑在并发失败时无竞态，锁定后仍可计数
  - `programmatic` TR-2.6: admission 5 道关卡顺序与 README 描述一致，标注文件与行号
- **Notes**: 每个发现必须标注 file://path#Lstart-Lend 与严重级别

## [x] Task 3: 安全审查 - 协议解析与输入验证
- **Priority**: high
- **Depends On**: Task 1
- **Description**:
  - 审查 `src/protocol-v2/` 下 7 个文件，重点 vless.js 与 trojan.js 的首包增量解析
  - 审查 `src/routes/router.js` 的 classifyRequest 与 URL 参数解析
  - 审查 `src/transport-v2/` 下请求头校验（websocket.js/grpc.js/xhttp.js）
  - 审查 `src/core/types.js` 的 DataFlowSession 冻结与字段验证
- **Acceptance Criteria Addressed**: AC-1, AC-3, AC-7, AC-8
- **Test Requirements**:
  - `human-judgement` TR-3.1: VLESS 首包：检查版本字节 + UUID(16B) + 附加信息长度字节 + 指令(1B) + 端口(2B) + 地址类型(1B) + 地址 各段读取前是否有足够字节数检查
  - `human-judgement` TR-3.2: Trojan 首包：检查 56B hex password + \r\n + 命令(1B) + 地址类型(1B) + 地址 + 端口(2B) + \r\n 各段边界检查
  - `human-judgement` TR-3.3: 所有 new Uint8Array / .subarray / DataView.getUint* 调用点，长度参数是否来源于外部输入且无上界限制
  - `human-judgement` TR-3.4: classifyRequest 中 {uuid} 路径参数使用 UUID v4 正则校验，标注校验位置
  - `human-judgement` TR-3.5: 三种传输层的 Content-Type / Upgrade 头校验是否严格（不接受模糊匹配）
- **Notes**: 协议解析是 RCE/DoS 高风险区，任何无界分配或越界读取都标记 High 以上

## [x] Task 4: 正确性审查 - QuotaDO 配额与计量
- **Priority**: high
- **Depends On**: Task 1
- **Description**:
  - 深度审查 `src/usage/quota-do.js`：/admit、/report、/set-quota、/reset-uuid、/snapshot、maybeRollover 六个 RPC
  - 审查 `src/usage/meter.js`：本地预算、256KB 阈值、resetVersion 校验、异常回滚、finally 上报
  - 审查 `src/usage/repository.js`：KV/D1 对账写回逻辑
- **Acceptance Criteria Addressed**: AC-2, AC-7, AC-8
- **Test Requirements**:
  - `human-judgement` TR-4.1: 预算下推公式：budget = min(remaining * 0.9, 至少 100MB?)；逐行核对代码计算
  - `human-judgement` TR-4.2: 256KB 阈值：meter.pending >= 256KB 或 counted >= budget 触发 flush；两处触发条件在代码中均存在
  - `human-judgement` TR-4.3: resetVersion 踢线：admission.admit 返回 session.resetVersion → meter.setVersion → /report 入参 → DO 比对不通过返回 allowed:false，整条链路完整
  - `human-judgement` TR-4.4: 日切对账 maybeRollover：① doTotal 计算 → ② 读 KV/D1 对比 → ③ 不一致则 DO 覆盖写 → ④ historyUsed+=todayUsed todayUsed=0 → ⑤ 再写 KV/D1；5 步顺序正确无遗漏
  - `human-judgement` TR-4.5: 并发串行化：DO 本身单线程 + /report 中 todayUsed += delta 使用 += 原子操作 + await storage.put；确认无读改写间隔
  - `human-judgement` TR-4.6: flush 网络异常时 pending 回滚逻辑存在且不丢失计数；finally 块中 flush 忽略异常保证不阻塞
- **Notes**: QuotaDO 是唯一权威计量源，任何状态不一致都会直接影响计费；逐行审查

## [x] Task 5: 正确性审查 - 数据流管道与传输层
- **Priority**: high
- **Depends On**: Task 1
- **Description**:
  - 审查 `src/proxy/pipeline.js`：runPipeline 编排、双向流搬运、超时、错误传播
  - 审查 `src/transport-v2/`：websocket.js（WS ↔ 字节流）、grpc.js（gRPC frame）、xhttp.js（XHTTP）、limits.js
  - 审查 `src/connector/`：direct.js（CF Sockets）、chain.js（回退链）、socks5.js、proxyip.js、http.js
  - 审查 `src/dns/service.js`：DNS-over-TCP、UDP/53 仅允许
- **Acceptance Criteria Addressed**: AC-4, AC-7, AC-8
- **Test Requirements**:
  - `human-judgement` TR-5.1: pipeline 中每条流（upload/download）的错误事件被监听，错误通过 cancel()/abort() 传播到对侧并关闭所有资源
  - `human-judgement` TR-5.2: 首包解析 10s 超时、TCP 连接 5s 超时、DNS 5s 超时三处超时在代码中存在且正确使用 AbortSignal
  - `human-judgement` TR-5.3: meter.addUpload / meter.addDownload 在所有读写字节路径均被调用（不含协议头、握手帧的开销？明确标注哪些字节计入）
  - `human-judgement` TR-5.4: WebSocket 帧分片、gRPC frame 长度前缀、XHTTP chunked 编码的边界处理，不会把半包误判为完整包
  - `human-judgement` TR-5.5: connector 回退链（direct → proxyip → socks5）顺序与配置一致，失败后异常正确向上抛出不会卡住
  - `human-judgement` TR-5.6: DNS 连接器仅允许目标端口 53，其他端口 UDP 请求被拒绝
- **Notes**: stream 生命周期问题是资源泄漏和挂起连接的主因；特别注意 finally 和 cancel 回调

## [x] Task 6: 错误处理一致性与可维护性审查
- **Priority**: medium
- **Depends On**: Task 1
- **Description**:
  - 审查 `src/core/errors.js` 中所有自定义错误类定义
  - 全代码库搜索 `throw ` 与 `try {` 与 `catch (` 与 `Promise.catch` 与 `.then(`
  - 识别未使用的 import、未使用的变量、死代码分支
  - 审查模块间耦合（循环 import、过度依赖内部实现）
- **Acceptance Criteria Addressed**: AC-4, AC-7, AC-8
- **Test Requirements**:
  - `programmatic` TR-6.1: 全代码库 throw 语句总数、throw new 自定义错误类占比、throw 字符串/普通 Error 占比统计并输出
  - `programmatic` TR-6.2: 所有 ctx.waitUntil() 包裹的 Promise 是否带 .catch() 防止 unhandled rejection；搜索 ctx.waitUntil 列出每个调用点
  - `human-judgement` TR-6.3: 每个 try/catch 的 catch 块是否：记录上下文、转换为自定义错误、重新抛出或返回正确的 HTTP 状态；禁止空 catch
  - `programmatic` TR-6.4: 全代码库搜索 TODO/FIXME/HACK 标记，列出全部带行号
  - `human-judgement` TR-6.5: 模块边界符合 PROJECT_INFO.md 描述（transport-v2 不依赖 protocol 细节、admission 不依赖 connector 等），如发现越界依赖报告
- **Notes**: 不一致的错误处理会导致 HTTP 500 吞没真实原因或泄漏堆栈

## [x] Task 7: Workers 最佳实践与性能审查
- **Priority**: medium
- **Depends On**: Task 1
- **Description**:
  - 审查三个入口：src/index.js、src/index-transmission.js、src/index-admin.js 的 fetch 事件处理
  - 审查 `src/utils/http.js` 响应构造、stream 响应头
  - 识别热路径上的性能问题：JSON.parse/stringify 大对象、正则重复编译、数组无界追加
  - 评估 Durable Object 存储访问模式（storage.get/put 批量、频率）
- **Acceptance Criteria Addressed**: AC-7, AC-8
- **Test Requirements**:
  - `human-judgement` TR-7.1: fetch 事件处理函数对每个分类请求都有明确的 try/catch，异常转换为合适的 HTTP 响应（非 500 透传堆栈）
  - `programmatic` TR-7.2: 列出所有 Response 构造点，检查 stream 响应是否带 `content-type`、`transfer-encoding`、无 `content-length`（流式不能有）
  - `human-judgement` TR-7.3: 数据面热路径（pipeline 循环、协议字节循环）中无 JSON.parse、正则编译、字符串拼接分配
  - `human-judgement` TR-7.4: QuotaDO 中 storage.put/get 是否使用 await 正确串行；无无意义的多次读同一 key
  - `human-judgement` TR-7.5: 子请求（fetch() 到外部）数量是否合理，无循环子请求（可能触发 Workers 子请求数限制 50）
- **Notes**: Workers 有 30s CPU 墙、50 个子请求限制；超限时直接断连

## [x] Task 8: 测试覆盖评估与测试逻辑审查
- **Priority**: medium
- **Depends On**: Task 1
- **Description**:
  - 审查 test/ 下 21 个测试文件的测试逻辑正确性
  - 对照 src/ 模块列出覆盖矩阵：哪些模块有测试、哪些没有
  - 识别测试中的脆弱断言（依赖时间、随机值、执行顺序）
- **Acceptance Criteria Addressed**: AC-7, AC-8
- **Test Requirements**:
  - `programmatic` TR-8.1: 列出 src/ 下每个 .js 文件 → 对应 test/ 文件的映射；标注哪些模块无对应测试（高风险标红：quota-do.js、pipeline.js、所有 connector）
  - `human-judgement` TR-8.2: 每个测试文件中是否含负面测试（非法输入、边界值），不仅是 happy path
  - `human-judgement` TR-8.3: 测试中使用 mock/stub 是否合理，不真实的 mock 可能给出假阳性通过
  - `human-judgement` TR-8.4: 识别 flaky 测试风险：依赖 Date.now()、Math.random()、setTimeout 精确值的断言
- **Notes**: 输出覆盖盲区列表，供后续写新测试用

## [x] Task 9: 汇总输出最终审查报告
- **Priority**: high
- **Depends On**: Task 2, Task 3, Task 4, Task 5, Task 6, Task 7, Task 8
- **Description**:
  - 汇总 Task 2-8 的所有发现，按严重级别排序（Critical → High → Medium → Low → Info）
  - 结构化为：摘要统计（总数 + 各级别数量）、详细发现（每条带定位+级别+影响+修复建议）、覆盖矩阵、优先修复路线图
- **Acceptance Criteria Addressed**: AC-1, AC-2, AC-3, AC-4, AC-7, AC-8
- **Test Requirements**:
  - `human-judgement` TR-9.1: 摘要包含总问题数 + Critical/High/Medium/Low/Info 各计数
  - `human-judgement` TR-9.2: 每条问题有唯一编号、file://path#Lstart-Lend 定位、严重级别、影响分析、具体修复建议
  - `human-judgement` TR-9.3: 附一张 Top 5 优先修复建议（按 Critical 先，然后 High 按修复复杂度升序）
  - `programmatic` TR-9.4: 覆盖矩阵：src/ 文件审查完成率 100%（45+ 文件每一个都有审查记录，哪怕无问题）
- **Notes**: 这是最终交付物；审查的完整性和可读性都在这里体现
