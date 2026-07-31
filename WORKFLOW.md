# 单文件版本工作流

目标：把 `src/` 的多文件实现打成一个 `_worker.js`，并把这个产物当作版本发布。

## 版本规则

- 初始版本固定为 `3.0.0`
- 每次有实质改动时，按语义版本继续往上加
- 版本号写在 `package.json`
- 打包产物 `_worker.js` 顶部保留版本标记

## 工作流模板

```text
1. 确认当前版本号。
2. 修改 `src/` 下的源码。
3. 如需发布新版本，更新 `package.json` 的 `version`。
4. 执行测试、语法检查和 `npm run bundle`。
5. 获取单文件产物 `_worker.js`。
6. 上传 `_worker.js` 到目标云端环境。
```

## 固定入口

- 输入入口：`src/index.js`
- 依赖来源：`src/` 下所有模块
- 输出文件：`_worker.js`

## 执行命令

```bash
npm ci
npm test
npm run check
npm run bundle
```

## 产物约定

- `_worker.js` 是唯一需要上传的文件
- 不需要连同 `src/` 一起上传
- 每次改源码后重新打包，保证版本和产物一致
- GitHub 工作流位于 `.github/workflows/build-release.yml`
- 推送 `v*` 标签或手动输入语义版本时，工作流才创建 Release
- 工作流不自动部署 Cloudflare Worker
