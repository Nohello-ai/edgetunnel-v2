# 双 Worker 工作流

目标：把 `src/` 的多文件实现打成两个独立的 `_worker-*.js`，分别部署到不同的 Cloudflare Worker。

## 两个 Worker

| Worker | 入口 | 产物 | 职责 |
|--------|------|------|------|
| 传输层 | `src/index-transmission.js` | `_worker-transmission.js` | 代理隧道 + 流量计量 + DO |
| 用户管理层 | `src/index-admin.js` | `_worker-admin.js` | API + 认证 + 配置 + 订阅 + 面板 |

## 版本规则

- 初始版本固定为 `3.0.0`
- 每次有实质改动时，按语义版本继续往上加
- 版本号写在 `package.json`
- 两个产物顶部各保留各自版本标记

## 工作流

```text
1. 确认当前版本号。
2. 修改 `src/` 下的源码。
3. 如需发布新版本，更新 `package.json` 的 `version`。
4. 执行测试、语法检查和 `npm run bundle`。
5. 获取两个产物 `_worker-transmission.js` 和 `_worker-admin.js`。
6. 分别上传到各自的 Cloudflare Worker。
```

## 固定入口

- 传输层入口：`src/index-transmission.js`
- 用户管理层入口：`src/index-admin.js`
- 依赖来源：`src/` 下所有模块
- 输出文件：`_worker-transmission.js`、`_worker-admin.js`

## 执行命令

```bash
npm ci
npm test
npm run check
npm run bundle
```

## 产物约定

- 两个 `_worker-*.js` 是唯二需要上传的文件
- 不需要连同 `src/` 一起上传
- 每次改源码后重新打包，保证版本和产物一致
- GitHub 工作流位于 `.github/workflows/build-release.yml`
- 推送 `v*` 标签或手动输入语义版本时，工作流构建两个产物并发布 Release
- 工作流不自动部署 Cloudflare Worker
