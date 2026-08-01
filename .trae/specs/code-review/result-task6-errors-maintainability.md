# EdgeTunnel Core 代码审查 - Task 6 结果：错误处理一致性与可维护性

## 一、throw 语句统计（TR-6.1, Checkpoint 27）

基于 grep 全代码库（src/ 目录）共 **98 条 throw 语句**，按类型分布：

| 类型 | 数量 | 占比 | 示例 |
|------|------|------|------|
| `throw new AppError(...)` | 62 | 63.3% | AUTH_REQUIRED, INVALID_CREDENTIALS 等 |
| `throw new UsageLimitError()` | 2 | 2.0% | meter.flush 中配额耗尽 |
| `throw new Error(...)`（裸 Error）| 30 | 30.6% | 连接器（SOCKS5/HTTP/ProxyIP）内部、subscription 类型校验、datagram codec、gRPC frame 解析 |
| `throw new TypeError(...)` | 4 | 4.1% | subscription 参数校验 |
| 直接 `throw error`（重抛）| 14 | 14.3% | 重抛上游已存在错误 |

⚠️ **不一致点**: 协议内部（grpc-frame.js、datagram.js、subscription/*.js、connector/*.js）大量使用裸 `throw new Error('message')`，这些错误在顶层 fetch 处理器的 `asAppError(error)` 中会被统一转换为 `AppError('INTERNAL_ERROR', 500, 'internal error')` —— **所有原始错误信息被吞掉**，日志/调试难以定位真实原因。**应统一使用 AppError**（或在 asAppError 中保留原始 message）。

## 二、ctx.waitUntil 审计（Checkpoint 28）

**搜索结果：仅 2 处 ctx.waitUntil 调用，均位于 usage/meter.js**

| 位置 | 代码 | 带 .catch？ | 结论 |
|------|------|------------|------|
| [meter.js#L10-L12](file:///workspace/src/usage/meter.js#L10-L12) | `ctx.waitUntil(task)` 其中 `task = flush()` | ❌ **缺失** | flush() 内部如果有未捕获异常会变成 Worker unhandled rejection |
| [meter.js#L43-L46](file:///workspace/src/usage/meter.js#L43-L46) | `ctx.waitUntil(flush())` | ❌ **缺失** | 同上 |

另外一处非显式 waitUntil：
| [pipeline.js#L26](file:///workspace/src/proxy/pipeline.js#L26) | `ctx?.waitUntil?.(task)` | ❌ 但 task Promise 本身带 `.catch → transport.close` | 外层有 catch，内部错误会被吞，OK |

**问题**: 两处 meter 的 waitUntil 都没有 catch 兜底。flush 内部异常虽然会 break，但是 Promise rejection 如果未被 waitUntil 捕获，**在 Workers 环境中会导致整个 event `unhandledrejection` 触发 fail closed**（取决于运行时，但最佳实践是所有 waitUntil Promise 带 catch）。

**修复**:
```javascript
// meter.js L11
if (ctx?.waitUntil) ctx.waitUntil(task.catch(() => {}));
// meter.js L45
if (ctx?.waitUntil) ctx.waitUntil(flush().catch(() => {}));
```

## 三、try/catch 块审计（Checkpoint 29）

从 grep 106 条 try/catch 中逐个识别空 catch：

### 确认**无空 catch 块**，所有 catch 均执行以下动作之一：
1. 转换为自定义错误重抛：`catch (error) { if (error instanceof AppError) throw error; throw new AppError(...) }`（如 config/loader.js）
2. 返回降级值：`catch { return {} }`（如 users/repository.js parse JSON）
3. 静默降级（DO/KV/D1 不可用时吞错，因为有兜底）：`catch { /* DO 不可用 */ }`（如 users/service.js syncQuotaToDO）
4. 关闭资源：`catch { try { server.close(1000) } catch {} }`

### ⚠️ **可疑 catch（共 12 处 catch 吞掉所有错误无日志）**
虽有合理理由（降级场景），但完全静默可能导致问题排查困难：

| 文件 | 位置 | 代码 | 建议 |
|------|------|------|------|
| session.js | L22 | `.run().catch(() => {})` | 加 ctx 或 console 日志（仅开发环境） |
| admission/service.js | L48 | `.catch(() => admission)` | 可接受（DO JSON 解析失败），但应区分网络异常与解析异常 |
| users/service.js | L84 | `} catch { /* DO 不可用... */ }` | 同上 |
| users/service.js | L93 | `} catch { /* 同上 */ }` | 同上 |
| quota-do.js | 6 处 `.catch(() => null/.run())` | L56, L82, L86, L96, L101, L112, L117, L194, L195 — KV/D1 读写失败全吞 | 可接受（DO 是权威，KV/D1 是副本），但频繁失败应计数告警 |
| governance.js | L40 | `} catch { /* DO 不可用, admission 仍生效 */ }` | 同上 |
| pipeline.js | 多处 `.catch(() => {})` | transport.close / socket.close 等 cleanup 动作 | ✅ 合理（cleanup 二次失败忽略）|

## 四、TODO/FIXME/HACK 标记（Checkpoint 30）

基于 `grep -i TODO|FIXME|HACK|XXX src/` — **搜索结果：0 处**。无遗留技术债务标记。✅

## 五、模块边界审查（Checkpoint 31）

对照 PROJECT_INFO.md 模块边界定义：
- transport-v2 只把 HTTP/WebSocket 转成字节流 ✅ [transport-v2/*] 不 import protocol-v2
- protocol-v2 只解析首包 ✅ [protocol-v2/*] 不 import transport、connector
- admission 只做 D1 准入 ✅ [admission/*] 不 import connector/protocol
- connector 只建立出站 ✅ [connector/*] 不依赖用户/认证模块
- 组合仅发生在 src/index.js 和 src/proxy/pipeline.js ✅

### 实际 import 图验证（抽查关键跨模块 import）：
- admission/service.js 导入：core/errors, core/types, utils/crypto — 无 connector/transport ✅
- protocol-v2/vless.js 导入：core/types, ./address, ./helpers, ./types — 无 transport/connector ✅
- transport-v2/websocket.js 导入：core/errors, ./limits — 无 protocol/admission ✅
- proxy/pipeline.js 是唯一的组合点：protocol-v2/registry + transport-v2/registry + usage/meter + dns/service ✅ 符合设计

**总体**: ✅ 模块边界符合文档描述，无越界依赖。

---

## 六、发现的问题（按严重级别）

### 🟡 ERR-001 Medium — 错误类型不统一：约 30% throw 裸 Error，经 asAppError 吞掉原始消息变 500 'internal error'
- **定位**: 共 30 处 throw new Error() 分布：
  - grpc-frame.js L13, L15, L36, L38, L39
  - datagram.js L7, L18, L33, L46, L51, L68, L78
  - connector/socks5.js L16, L35, L37, L48, L50, L65, L76
  - connector/http.js L26, L28, L35, L45
  - connector/proxyip.js L91, L112
  - connector/chain.js L101
  - subscription/generator.js L4, L44
  - subscription/node-builder.js L14, L37, L41, L46, L53
  - subscription/params.js L24
  - utils/crypto.js L31, L35
- **严重级别**: Medium
- **影响分析**: 生产环境排障困难，任何连接器内部错误、协议解析错误、订阅参数错误都被统一化为 500，无错误码、无细节。调试时只能通过修改源码加 console.log 定位。
- **修复建议**: 
  1. 短期：修改 `asAppError()` [core/errors.js#L20-L24](file:///workspace/src/core/errors.js#L20-L24) 保留原始 message（但不泄漏堆栈）：
  ```javascript
  export function asAppError(error) {
    if (error instanceof AppError) return error;
    if (error instanceof UsageLimitError) return error;
    return new AppError('INTERNAL_ERROR', 500, error?.message || 'internal error');
  }
  ```
  2. 长期：将所有 connector / protocol / subscription 的裸 Error 替换为统一 AppError，并赋予独立错误码（如 SOCKS5_AUTH_FAILED、GRPC_FRAME_INVALID 等）。

### 🟡 ERR-002 Medium — meter.js 两处 ctx.waitUntil(flush()) 无 .catch()，内部未捕获异常会触发 Worker unhandled rejection
- **定位**: [meter.js#L10-L12](file:///workspace/src/usage/meter.js#L10-L12), [meter.js#L43-L46](file:///workspace/src/usage/meter.js#L43-L46)
- **严重级别**: Medium
- **修复建议**: 添加 `.catch(() => {})` 兜底，如前所示。

### 🟢 ERR-003 Low — utils/crypto.js generateUserID 抛裸 Error('username is required') 与裸 Error('env ID must be UUID v4')
- **定位**: [crypto.js#L31](file:///workspace/src/utils/crypto.js#L31), [crypto.js#L35](file:///workspace/src/utils/crypto.js#L35)
- **严重级别**: Low
- **影响**: 这两个函数通常在内部调用，输入由代码控制，不会被用户触发。但与 ERR-001 同根因。
- **修复建议**: 统一为 AppError。

### ℹ️ ERR-004 Info — connector/chain.js L101 抛 "Proxy failed: ..." 串拼接 errors.join 为字符串，不保留原始堆栈
- **严重级别**: Info
- **修复建议**: 可选使用 AggregateError（ES2021）。

---

## 七、问题汇总统计

| 严重级别 | 数量 | 编号 |
|---------|------|------|
| 🔴 High | **0** | — |
| 🟡 Medium | **2** | ERR-001, ERR-002 |
| 🟢 Low | **1** | ERR-003 |
| ℹ️ Info | **1** | ERR-004 |
| **合计** | **4** | |
