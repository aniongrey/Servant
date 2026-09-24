# 验证指南

## 自动化验证

按变更风险逐级执行：

```bash
# 最接近改动的测试
npx vitest run path/to/file.test.ts

# TypeScript
npm run typecheck

# 全量行为回归
npm test

# 页面、Vite、资源和生产集成
npm run build

# Tauri Rust
cargo check --manifest-path src-tauri/Cargo.toml
```

不要用快照或文案断言替代可观察的行为测试，也不要为了通过而削弱断言。

## 人工验收入口

| 场景         | 页面                              | 核心检查                                           |
| ------------ | --------------------------------- | -------------------------------------------------- |
| 对话与打断   | `pages/chat-test.html` + `pages/desktop.html` | 每条对话只在 Desktop 播放一次，打断立即停止        |
| 定时与工具   | `realtime-test` + `pages/desktop.html`  | 增删查、持久化、防打断、搜索原始资料不直接进入 TTS |
| 联网角色总结 | `pages/chat-test.html` + `pages/desktop.html` | 查询资料由当前角色和 SoulState 总结并且只朗读一次  |
| 重启恢复     | Tauri 桌宠                        | 创建任务后重启，任务仍存在并按时执行               |
| 睡眠恢复     | Tauri 桌宠                        | 到期期间睡眠，唤醒后补发一次                       |
| 动作组合     | `pages/debug.html`                      | 区域动作、表情和 idle 恢复                         |
| 直播队列     | `pages/live-test.html`                  | 过滤、聚合、优先级、TTL 和 cooldown                |
| LLM 延迟     | `pages/llm-latency-test.html`           | 区分模型、工具、搜索和网络耗时                     |

报告结果时区分自动化通过项和未执行的人工检查。服务成功启动不等于页面行为已经验证。

## 在无头浏览器里实测 Worker 的资源解析

React 页面在无头 Edge 里挂不起来（`#root` 为空），但**不经过 React 的纯 HTML 探针可以**。
所以「某个 Worker / 引擎拿到的文件集到底够不够」是可实测的，不必靠推理。
可复用样例：`.local/triage/stt-harness/`（`server.mjs` + `index.html` + `run.sh`）。

三段式：

1. **一个 node 静态服务扮演应用的 HTTP 面**：`/engines/...` 供应用自带文件，`/api/...` 供后端路由，
   并把每个请求「命中哪一侧」打进日志。**要证伪的那一路故意 404** ——
   例如让运行时路径对 `model.int8.onnx` 返回 404，这样初始化成功就只可能来自下载目录。
   同时发 COOP/COEP 头，避免 pthread 形状的 WASM 因缺跨源隔离而失败。
   还有一类值得单独拦：**不该被请求的东西**。`server.mjs` 把 `.data` 请求记成
   `DATA-PACKAGE-REQUESTED` 并 404，`run.sh` 见到这个标记直接判失败 —— 这条断言
   才真正证明「229MB 的重复副本没被打包也没被下载」（见
   [provisioning.md](provisioning.md) 的「`.data` 预载包」一节）。
2. **一个纯 HTML 页面** `new Worker(...)` 并 postMessage 与线上完全一致的 `init`，
   把结果写 `window.__result`、日志写 `window.__logs`（把 `console.log/error` 重定向进去）。
3. **无头 Edge + CDP**：`--headless=new --remote-debugging-port=NNNN --user-data-dir=<临时>` 打开该页，
   用 `.local/triage/cdp-probe.mjs` 轮询 `window.__result`（60s 级等待足够，实测 25s 内 ready）。
   收尾用 CDP 的 `Browser.close` —— **别按进程名杀 Edge**，会误伤用户正在用的浏览器。

日志里「命中哪一侧」本身就是证据：模型来自 `ASSET/DOWNLOAD` 还是 `ASSET/MIRROR`，
比只断言「初始化成功」信息量大得多。启动、使用、收尾要放在**同一条**命令里，
跨 Bash 调用的后台进程会被回收。
