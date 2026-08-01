# EdgeTunnel Core 代码审查 - Task 3 结果：安全审查 - 协议解析与输入验证

## 一、文件覆盖

| # | 文件 | 结论 | 关键发现 |
|---|------|------|---------|
| 1 | [vless.js](file:///workspace/src/protocol-v2/vless.js) | 有问题 | 附加信息长度无 upper bound → 潜在 DoS |
| 2 | [trojan.js](file:///workspace/src/protocol-v2/trojan.js) | ✅ 通过 | 边界检查完整 |
| 3 | [address.js](file:///workspace/src/protocol-v2/address.js) | ✅ 通过 | IPv4/域名/IPv6 长度 check 齐全 |
| 4 | [helpers.js](file:///workspace/src/protocol-v2/helpers.js) | ✅ 通过 | appendBytes 无分配风险 |
| 5 | [routes/router.js](file:///workspace/src/routes/router.js) | 有问题 | xhttp 允许 octet-stream 过宽 |
| 6 | [transport-v2/websocket.js](file:///workspace/src/transport-v2/websocket.js) | ✅ 通过 | maxFrameBytes + 双限额 |
| 7 | [transport-v2/grpc.js](file:///workspace/src/transport-v2/grpc.js) | ✅ 通过 | content-type 严格匹配 |
| 8 | [transport-v2/xhttp.js](file:///workspace/src/transport-v2/xhttp.js) | 有问题 | VALID_XHTTP_TYPES 不含 octet-stream 双重标准 |
| 9 | [core/types.js](file:///workspace/src/core/types.js) | ✅ 通过 | Object.freeze 冻结 session |
| 10 | [utils/crypto.js](file:///workspace/src/utils/crypto.js#L23-L25) | ✅ 通过 | isValidUuidV4 正则严格 |

---

## 二、问题列表

### 🔴 SEC-PROTO-001 High — VLESS 附加信息长度无上界限制，潜在 DoS 内存耗尽
- **定位**: [vless.js#L17-L22](file:///workspace/src/protocol-v2/vless.js#L17-L22)
- **严重级别**: High
- **影响分析**: 
  ```javascript
  if (buffer.byteLength < 18) return NEED_MORE;                 // 1 = version + 16 = UUID
  const commandOffset = 18 + buffer[17];                        // buffer[17] = 附加信息长度（1 byte = 0-255）
  if (buffer.byteLength < commandOffset + 4) return NEED_MORE; // 再等 4 = cmd + port(2B) + addrType(1B)
  ```
  - `buffer[17]` 是附加信息长度字节，取值范围 0-255。当该值 = 255 时，`commandOffset = 18 + 255 = 273`，等待 `273 + 4 = 277B` → **名义上仍在 64KB 内**
  - 但真正的风险是：`maxFirstPacketBytes = 64 * 1024` (64KB) 是 parser buffer 硬上限。如果附加信息长度 = 255 后，实际等待时 attacker 只发送部分字节但反复 push 小 chunk，**每次 push 都会走 appendBytes（Uint8Array 重新分配 O(n) 内存拷贝）**
  - 在 64KB 之前，每 push 1B 就会触发 1 次 buffer 复制，累计 64K 次 push → O(64K²) = ~40 亿次字节拷贝，**CPU 墙耗尽 (Workers 30s CPU)**
- **修复建议**:
  1. 附加信息长度设置合理上限，例如 ≤ 64 字节：`if (buffer[17] > 64) return protocolError('ADDITIONAL_INFO_TOO_LONG')`
  2. 对 push 次数设置硬上限（如 ≤ 16 次）或改用自动扩容 + 增量 index 避免重复拷贝

### 🟡 SEC-PROTO-002 Medium — classifyRequest → xhttp matchesTransport 与 openXhttpTransport Content-Type 校验标准不一致
- **定位**: [routes/router.js#L30-L33](file:///workspace/src/routes/router.js#L30-L33) **vs** [transport-v2/xhttp.js#L6-L8](file:///workspace/src/transport-v2/xhttp.js#L6-L8)
- **严重级别**: Medium
- **影响分析**:
  - `classifyRequest` (router.js L31-32): `contentType.startsWith('application/x-http') || contentType.startsWith('application/octet-stream')` → **octet-stream 也被路由为数据面**
  - `openXhttpTransport` (xhttp.js L7): 仅检查 `application/x-http` → **不检查 octet-stream**
  - 这意味着：attacker 用 `Content-Type: application/octet-stream` 发送请求会被 classifyRequest 判为 `kind: 'data-flow'`，经过 admission 5 关（UUID 查询、Ban 查询、DO 调用、白名单校验）后，在 `startDataFlowPipeline → openXhttpTransport` **才会抛出 INVALID_XHTTP_REQUEST 400**
  - 结果：**绕过路由层直接触发 D1 查询 + DO 子请求**（高成本副作用），用 octet-stream 批量请求会造成 D1+DO 资源耗尽型 DoS
- **修复建议**:
  - 二选一做一致化：
    - A（推荐更严）：从 `classifyRequest` 中删除 `application/octet-stream` 分支，XHTTP 专用类型只认 `application/x-http`
    - B：在 `openXhttpTransport` 中也允许 `application/octet-stream`（不推荐，语义不清）
  - 同时在 admission 前加一层轻量 transport 头校验（即 parseDataFlowRoute 之后立即调用 matchesTransport，如果不过直接 404，不进入 admission.admit）

### 🟡 SEC-PROTO-003 Medium — XHTTP `x-http-mode` 校验在路由分类缺失
- **定位**: [routes/router.js#L24-L34](file:///workspace/src/routes/router.js#L24-L34) + [transport-v2/xhttp.js#L11-L13](file:///workspace/src/transport-v2/xhttp.js#L11-L13)
- **严重级别**: Medium
- **影响分析**: 同 SEC-PROTO-002，`x-http-mode !== 'stream-one'` 会在 admission 之后才 400，浪费 D1/DO 算力。影响较小但同理。
- **修复建议**: 合并到 SEC-PROTO-002 的修复；在 classifyRequest 阶段为 xhttp route 加 mode 头检查。

### 🟢 SEC-PROTO-004 Low — Trojan parser `command !== 1 && command !== 3` 不匹配真实协议语义
- **定位**: [trojan.js#L26-L27](file:///workspace/src/protocol-v2/trojan.js#L26-L27)
- **严重级别**: Low
- **影响分析**: Trojan 协议标准 CMD：0x01=TCP CONNECT、0x03=UDP ASSOCIATE。代码判断 `command !== 1 && command !== 3` 与协议一致。**实际无 bug**，但 VLESS 中是 `1 && 2`（UDP=0x02），两个 parser 用不同枚举易混淆，读代码易错。
- **修复建议**: 为 CMD 值加命名常量 `const CMD_TCP_CONNECT = 0x01; const CMD_UDP_ASSOCIATE_VLESS = 0x02; const CMD_UDP_ASSOCIATE_TROJAN = 0x03;`

---

## 三、VLESS 首包分段边界检查详情（Checkpoint 10 验证）

| 段名 | 偏移公式 | 长度检查代码位置 | 是否有检查 | 结论 |
|------|---------|-----------------|-----------|------|
| 版本字节 | buffer[0] | 与 UUID 一起 | `buffer.byteLength < 18` | ✅ 有 |
| UUID 16B | buffer[1..16] | 同上 | 同上 | ✅ 有 |
| 附加信息长度 | buffer[17] | 同上 | 隐含在 <18 检查中 | ✅ 有（但长度值无上界，见 SEC-PROTO-001） |
| 命令 | buffer[commandOffset] | `buffer.byteLength < commandOffset + 4` | ✅ 有 | ✅ |
| 端口 2B | buffer[commandOffset+1..+2] | 同上 | ✅ 有 | ✅ |
| 地址类型 1B | buffer[commandOffset+3] | parseAddress() | [address.js#L10](file:///workspace/src/protocol-v2/address.js#L10) `offset >= byteLength → needMore` | ✅ 有 |
| 地址（IPv4=5B/域名=2+len/IPv6=17B） | parseAddress 返回 offset | [address.js#L13-L30](file:///workspace/src/protocol-v2/address.js#L13-L30) 各分支全部 needMore | ✅ 有 | ✅ |
| Payload | parseAddress.offset → end | buffer.slice | 隐式 | ✅ 有 |

**总体**: 除附加信息长度无上界外，其他段边界检查 **完整无越界风险**。

---

## 四、Trojan 首包分段边界检查详情（Checkpoint 11 验证）

| 段名 | 偏移 | 检查代码 | 结论 |
|------|-----|---------|------|
| Password SHA224 hex (56B) | 0..55 | `buffer.byteLength < 59` + `equalBytes(slice(0,56), expected)` | ✅ 有 |
| CRLF (\r\n) | 56,57 | `buffer[56] !== 13 || buffer[57] !== 10` | ✅ 有 |
| 命令 CMD | 58 | `command !== 1 && command !== 3` | ✅ 有 |
| 地址类型+地址 | 59 → parseSocksAddress | parseSocksAddress 内检查 | ✅ 有 |
| 端口 2B | address.offset, +1 | `buffer.byteLength < address.offset + 4` | ✅ 有 |
| CRLF | address.offset+2..+3 | `buffer[offset+2] !==13 || buffer[offset+3]!==10` | ✅ 有 |
| Payload | offset+4 → end | `buffer.slice(address.offset+4)` | ✅ 有 |

**总体**: **64KB maxBytes 上限 + 每段精确边界检查**，Trojan parser 边界安全。

---

## 五、Uint8Array/DataView 分配与访问安全性详情（Checkpoint 12）

| 来源文件 | 代码模式 | 参数是否外部输入 | 是否有长度上界 | 结论 |
|---------|---------|----------------|--------------|------|
| [vless.js#L9](file:///workspace/src/protocol-v2/vless.js#L9) | `buffer = new Uint8Array()` 每次 + appendBytes | push chunk 大小来自 WS/gRPC frame | maxFirstPacketBytes 64KB ✅ | 安全 |
| [trojan.js#L15](file:///workspace/src/protocol-v2/trojan.js#L15) | 同上 | 同上 | 64KB ✅ | 安全 |
| [helpers.js#L3-L6](file:///workspace/src/protocol-v2/helpers.js#L3-L6) appendBytes | `new Uint8Array(a+b)` | 双方来自流 chunk | 见 parser 64KB 上限 | 安全 |
| [address.js#L21](file:///workspace/src/protocol-v2/address.js#L21) `bytes.slice(offset+2, offset+2+length)` | domain 解码 | length = buffer[offset+1] 0-253，限制 ≤253 ✅ | `length>253` 报错 ✅ | 安全 |
| [vless.js#L32](file:///workspace/src/protocol-v2/vless.js#L32) `buffer.slice(address.offset)` payload 取尾部 | slice | offset 来自 parseAddress 安全值 | 隐式 | 安全 |
| [trojan.js#L39](file:///workspace/src/protocol-v2/trojan.js#L39) `buffer.slice(offset+4)` | 同上 | 同上 | 同上 | 安全 |
| [dns/service.js#L143-L152](file:///workspace/src/dns/service.js#L143-L152) readDnsFrame | concat(buffer, chunk) | DNS upstream 字节流 | `expected > 65535` 抛错 ✅ | 安全 |

**未发现越界 DataView 访问**：所有 getUint16/getUint8 均有 needMore 前导检查。

---

## 六、UUID 路径参数正则校验详情（Checkpoint 13）

- **校验实现**: [utils/crypto.js#L1-L25](file:///workspace/src/utils/crypto.js#L1-L25)
  ```javascript
  const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  ```
- **路由调用位置**:
  1. [admission/service.js#L21](file:///workspace/src/admission/service.js#L21) `parseDataFlowRoute` → `isValidUuidV4(userID)` ✅
  2. [admission/service.js#L28](file:///workspace/src/admission/service.js#L28) `admit()` → **二次** `isValidUuidV4(route.userID)` ✅ 纵深防御
  3. [users/repository.js L8/L11 update() path match](file:///workspace/src/api-v2/router.js#L44) `^\/api\/admin\/users\/([0-9a-f-]+)$` 仅做字符集校验，内部再 users.getByID → 返回 404 ✅
- **结论**: **UUID v4 版本位 + variant 位双重精确匹配 + 路由层/准入层双重校验**，严格无绕过。

---

## 七、三种传输层头校验详情（Checkpoint 14）

| 传输 | classifyRequest 头 | openTransport 头 | 严格性 | 问题 |
|------|-------------------|-----------------|--------|------|
| **WebSocket** | `method=GET && upgrade=websocket`（精确相等，不含子串）[router.js#L28](file:///workspace/src/routes/router.js#L28) | 同样双条件 + 再做 method+upgrade [websocket.js#L5-L6](file:///workspace/src/transport-v2/websocket.js#L5-L6) | ✅ 双校验一致，最严格 | 无 |
| **gRPC** | `method=POST && contentType startsWith 'application/grpc'` [router.js#L29](file:///workspace/src/routes/router.js#L29) | `VALID_GRPC_TYPES = ['application/grpc', 'application/grpc+proto']`，且用 `===` 或 `startsWith(t+';')` [grpc.js#L4-L9](file:///workspace/src/transport-v2/grpc.js#L4-L9) | ✅ 内层更严格 | 无 |
| **XHTTP** | `method=POST && (contentType startsWith 'application/x-http' **OR** startsWith 'application/octet-stream')` [router.js#L31-L32](file:///workspace/src/routes/router.js#L31-L32) | `VALID_XHTTP_TYPES=['application/x-http']`，不含 octet-stream [xhttp.js#L3-L8](file:///workspace/src/transport-v2/xhttp.js#L3-L8) | ⚠️ **双层不一致** | 见 SEC-PROTO-002/003 |

---

## 八、问题汇总统计

| 严重级别 | 数量 | 编号 |
|---------|------|------|
| 🔴 High | **1** | SEC-PROTO-001 |
| 🟡 Medium | **2** | SEC-PROTO-002, SEC-PROTO-003 |
| 🟢 Low | **1** | SEC-PROTO-004 |
| ℹ️ Info | **0** | — |
| **合计** | **4** | |
