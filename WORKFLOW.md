# 单文件部署工作流

这个工作流的目标很简单：把 `src/` 下的多文件实现打包成一个可直接部署的 `_worker.js`。

## 输入

- `src/index.js` 作为主入口
- `src/` 下的所有依赖模块

## 输出

- `_worker.js`：单个 ESM 文件，适合直接部署到 Cloudflare Workers 之类的运行环境

## 执行步骤

1. 安装依赖。

2. 执行打包。

   ```bash
   npm run bundle
   ```

   这一步会调用 `scripts/build-single.mjs`，内部使用 `esbuild` 将 `src/index.js` 及其依赖全部打进 `_worker.js`。

3. 部署 `_worker.js`。

   你可以把这个文件直接作为 Worker 主体上传，不需要再带整棵 `src/` 目录。

## 约束

- 入口始终是 `src/index.js`
- 输出始终是 `_worker.js`
- 如果你改了源码，就重新执行一次 `npm run bundle`
