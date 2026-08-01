# EdgeTunnel Core 代码审查 - Product Requirement Document

## Overview
- **Summary**: 对 EdgeTunnel Core v3.0.0 项目进行全面代码审查，覆盖安全审计、正确性验证、性能优化建议、可维护性评估和 Cloudflare Workers 最佳实践合规性检查五大维度。审查范围包括 src/ 下 45+ 个源码文件及配套的 21 个测试文件。
- **Purpose**: 识别潜在的安全漏洞、逻辑错误、性能瓶颈、架构缺陷和代码风格问题，确保代理核心在生产环境下的可靠性、安全性和可维护性。特别关注流量计量的一致性、协议解析的健壮性、认证授权的安全性等高风险模块。
- **Target Users**: 项目维护者、安全审计人员、Cloudflare Workers 部署管理员

## Goals
- 安全审计：识别认证、授权、密码哈希、协议解析、输入验证等环节的安全漏洞
- 正确性验证：验证 Durable Object 配额逻辑、协议首包解析、传输层帧处理、用户治理等核心逻辑的正确性
- 性能审查：发现热路径上的性能瓶颈，评估 DO 调用频率、内存分配、流处理效率
- 可维护性评估：检查模块边界、错误处理一致性、类型安全、代码可读性
- Workers 最佳实践：检查 ctx.waitUntil 使用、stream 生命周期、Durable Object 存储、fetch 事件处理

## Non-Goals (Out of Scope)
- 不进行功能开发或 Bug 修复（仅报告问题，不直接修改代码）
- 不重构代码结构或重写模块
- 不编写新的测试用例（仅评估现有测试覆盖）
- 不验证生产环境部署配置（wrangler.toml、Cloudflare Dashboard 设置等）
- 不审查第三方依赖（本项目零运行时依赖）
- 不审查构建脚本 esbuild 的内部实现细节

## Background & Context
EdgeTunnel Core 是运行在 Cloudflare Workers 上的代理隧道系统，核心特征：
- 协议：VLESS、Trojan（增量首包解析）
- 传输：WebSocket、gRPC、XHTTP stream-one
- 出站：Cloudflare Sockets 直连 TCP、DNS-over-TCP
- 计量：QuotaDO（Durable Object）强一致实时计数，预算下推 + 256KB 增量上报
- 用户：D1 数据库 + PBKDF2 密码哈希 + 登录失败锁定
- 构建：esbuild 单文件打包为 `_worker.js`，零运行时依赖

关键风险点：
1. QuotaDO 并发正确性：多连接同时上报时的 todayUsed 累加一致性
2. 协议解析安全：VLESS/Trojan 首包解析的边界检查、恶意输入防护
3. 鉴权链路：控制面 Session Cookie、数据面 UUID + DO 双重校验
4. Stream 生命周期：双向管道的错误传播和资源泄漏风险
5. 输入验证：所有外部输入（URL 参数、请求头、请求体、数据库读取）

## Functional Requirements
- **FR-1**: 安全审计报告 - 列出所有发现的安全漏洞，按严重程度（Critical/High/Medium/Low/Info）分级，包含定位、影响分析、修复建议
- **FR-2**: 正确性问题报告 - 列出逻辑错误、边界条件遗漏、状态不一致问题，包含复现路径（如可行）
- **FR-3**: 性能分析报告 - 识别 O(n) 热路径、不必要的内存分配、DO 调用可优化点、流背压处理
- **FR-4**: 可维护性报告 - 识别死代码、未使用变量、不一致的错误处理、缺失的注释、模块耦合
- **FR-5**: Workers 合规报告 - 检查 Workers 平台限制合规性（CPU 时间、子请求数、stream 生命周期）
- **FR-6**: 测试覆盖评估 - 评估现有 21 个测试文件的覆盖盲区，列出高风险未覆盖模块

## Non-Functional Requirements
- **NFR-1**: 审查完整性 - 每个 `src/**/*.js` 文件至少被审查一次，不遗漏任何模块
- **NFR-2**: 可追溯性 - 每个问题必须标注精确的文件路径和行号范围（file://path#Lstart-Lend）
- **NFR-3**: 可操作性 - 每个问题必须提供具体的修复建议，而非泛泛而谈
- **NFR-4**: 优先级排序 - 问题按严重程度/影响范围排序，Critical 必须在报告最前
- **NFR-5**: 可复现性 - 对于可自动化验证的问题（语法错误、可静态检测的问题），附验证命令或步骤

## Constraints
- **Technical**: 基于现有代码库静态审查 + 运行测试验证，不引入新工具依赖（仅用 node --check 和 npm test）
- **Business**: 审查在单次会话内完成，不跨多天持续
- **Dependencies**: 仅依赖项目已有的 Node.js 20+、内置 node:test、项目脚本（npm test / npm run check）

## Assumptions
- 代码库处于可运行状态（npm test 通过或已知失败状态明确）
- 审查者可读取所有源码文件和测试文件
- PROJECT_INFO.md、README.md、WORKFLOW.md 中的架构描述与实际代码一致，如有不一致以代码为准并报告
- 测试文件本身也纳入审查范围（测试逻辑正确性）

## Acceptance Criteria

### AC-1: 安全审计完整覆盖高风险模块
- **Given**: 代码库中存在 auth/、admission/、users/、protocol-v2/、usage/ 模块
- **When**: 完成安全审计
- **Then**: 每个高风险模块至少有 1 条安全相关发现（无论正/负面），认证、授权、密码哈希、输入验证四个维度全部覆盖
- **Verification**: `programmatic`
- **Notes**: 负面发现（确认安全）也需记录为 Info 级别

### AC-2: QuotaDO 逻辑正确性审查
- **Given**: src/usage/quota-do.js 和 src/usage/meter.js 存在
- **When**: 审查配额裁判逻辑（/admit、/report、maybeRollover）
- **Then**: 逐条验证：预算下推计算、256KB 阈值触发、resetVersion 踢线、日切对账覆盖写、并发串行化五点，每点有明确结论
- **Verification**: `human-judgment`

### AC-3: 协议解析边界检查
- **Given**: src/protocol-v2/vless.js 和 trojan.js 存在
- **When**: 审查首包增量解析逻辑
- **Then**: 识别所有对 Uint8Array/DataView 的访问，检查是否存在越界读取、长度不足时的无限等待、恶意长度值导致的内存问题
- **Verification**: `human-judgment`

### AC-4: 错误处理一致性检查
- **Given**: src/core/errors.js 定义了错误类型
- **When**: 全代码库搜索 throw 和 try/catch
- **Then**: 验证：自定义错误类型是否被正确使用、stream pipe 的错误是否被捕获、finally 块是否泄漏、未捕获的 Promise 是否有 catch
- **Verification**: `programmatic`

### AC-5: 所有文件语法正确
- **Given**: src/ test/ scripts/ 下的所有 .js 文件
- **When**: 执行 npm run check（node --check）
- **Then**: 所有文件通过语法检查，零 SyntaxError
- **Verification**: `programmatic`

### AC-6: 现有测试通过
- **Given**: test/ 下 21 个测试文件
- **When**: 执行 npm test（node --test test/*.test.js）
- **Then**: 所有测试用例通过，记录通过数量、失败数量、跳过数量
- **Verification**: `programmatic`

### AC-7: 审查发现带精确行号
- **Given**: 所有问题报告项
- **When**: 审阅输出
- **Then**: 每个问题必须包含 file:// 绝对链接 + #Lstart-Lend 行号范围，不可仅提文件名
- **Verification**: `human-judgment`

### AC-8: 问题分级与修复建议
- **Given**: 所有问题报告项
- **When**: 审阅输出
- **Then**: 每个问题标有严重级别（Critical/High/Medium/Low/Info），并附至少一条具体修复建议
- **Verification**: `human-judgment`

## Open Questions
- [ ] 是否需要特别关注 SOCKS5/ProxyIP 连接器的安全（当前第一阶段数据路径默认直连）？
- [ ] 是否已有已知的 Bug 或 Issue 列表，需要在审查中优先验证？
- [ ] 是否需要输出对比式审查（如与 v2 版本的实现差异对照）？
