# 开发必读

## 开始前

- 保持模块边界，优先降低下一次同类功能的开发成本。
- 不把 UI、网络协议、角色动作和具体 TTS Provider 互相直连。
- 保留用户工作区中的无关改动，不使用破坏性 Git 命令。
- 修改 TypeScript 运行时后至少运行 `npm run typecheck` 和 `npm test`。
- 修改页面、资源、Vite 或生产集成后再运行 `npm run build`。
- 修改 Tauri Rust 后运行 `cargo check --manifest-path src-tauri/Cargo.toml`。

## 运行时边界

```text
UI -> CharacterController / AgentRuntime
AgentRuntime -> LLM / STT / TTS / personality / memory
CharacterController -> motion / expression / interaction / character state
EventDirector -> EventRunner -> semantic action steps
ChatTurnOrchestrator -> chat.text 流 + action.voice 流（服务端编排）
Integrations -> normalized events -> consumer boundary
```

- 业务剧情使用语义 `action`，不要用底层 `motion` 拼业务动作。
- 主 LLM 的 `emotion` 只驱动脸（`moodPresentation.ts`：一个 VRM 表情 + 一组 B/C 档微动作），`shortAction` 只驱动身体（`full-body-motion-config.json` 的组合动作）。两个词表的唯一来源都是配置，协议细节见 [conversation-and-voice.md](conversation-and-voice.md)。
- 表情统一走 `ExpressionController`。
- 桌面移动统一走 `SpatialController`。
- 直播输入只通过 `LiveEventConsumer` 进入角色运行时。
- 聊天一轮由服务端 `ChatTurnOrchestrator` 编排；`/api/chat` 只返回成功/失败（202 accepted），不返回业务数据。
- 普通聊天不经过 Router LLM：`InputPreprocessor` 只做确定性输入事实和工具候选，`ChatContextBuilder` 默认并行读取历史与相关记忆，Main LLM 首次响应直接回复或输出一次 `tool_call`。
- 所有聊天工具先由 `ChatToolRegistry` 暴露和校验，再由 `ChatToolExecutor` 执行；工具结果需要角色化表达时才进入 Main LLM continuation。
- 双流式 WebSocket（同一网关、两条命名流）：
  - `chat.text` 流（聊天文本同步）：`turn-start / turn-phase / turn-segment / turn-end / turn-error / turn-cancelled`，chat 端与 desktop 端同步收到用户消息和多段回复文本。协议见 `ChatStreamProtocol.ts`。
  - `action.voice` 流（动作语音同步）：`reply-stream-start / segment / end`、`speech-*` 播放控制与 `speech-playback-*` 回执，desktop 端播放 TTS 与动作。协议见 `VoiceStreamProtocol.ts`。
  - `desktop.sync` 流只承载系统级同步（character-status、reminder、scheduler-command、tool-result），不再接受语音事件。
- 发起聊天走 HTTP `/api/chat` 或 WS `chat.turn` feature；取消走 WS `chat.turn cancel`。回复的多段语音 id 与 turnId 一致。
- 真实对话 TTS 只在 `pages/desktop.html` 播放；聊天页面通过 `action.voice` 的播放回执感知桌面播放状态。
- WebSocket 命令由本地实时网关校验和转发；Tauri 使用系统分配端口，浏览器开发默认使用 5174。
- `pages/ws-monitor.html`（双流监听台）实时查看发给 chat 端与 desktop 端的 WebSocket 数据。

## 关键路径

```text
src/app/main.tsx
src/ai/AgentRuntime.ts
src/character/CharacterController.ts
src/event/EventDirector.ts
src/ui/DesktopPet.tsx
src/ui/chat/useCompanionConversation.ts
src/app/network/realtime/RealtimeGatewayServer.ts
src/app/network/realtime/ChatStreamProtocol.ts
src/app/network/realtime/VoiceStreamProtocol.ts
src/app/network/server/ChatTurnOrchestrator.ts
src/app/network/server/ChatContextBuilder.ts
src/app/network/server/ChatToolExecutor.ts
src/ai/llm/InputPreprocessor.ts
src/ai/llm/ChatToolRegistry.ts
src/app/network/server/conversationApi.ts
src/desktop/tauri/DesktopReminderScheduler.ts
```

## 桌面端后端（sidecar）

打包版**必须**有独立后端进程：页面由 Tauri 资产协议提供，页面里的 `/api/*` 会命中
`tauri.localhost` 并返回 `index.html`，于是 `response.json()` 抛
`Unexpected token '<', "<!doctype "...`，聊天、Ollama、联网全部同时失效。

```bash
npm run server:build     # src/server/index.ts → src-tauri/binaries/servant-server.cjs
npm run server:package   # 再打成自包含的 src-tauri/binaries/servant-server.exe
npm run build:fast       # 快速构建：EXE + 资源，无安装包
npm run build:release    # 完整构建：beforeBuildCommand 已自动串联上面两步并出安装包
```

- 产物必须是 **CommonJS**：Node 的单文件可执行只接受 CJS 入口，ESM 入口会报
  `Cannot use import statement outside a module`。因此 `vite.server.config.ts` 里的
  `format: 'cjs'` 与 `publicDir: false` 都不能去掉（后者漏掉会把 1GB 的 `public/`
  复制进输出目录）。
- Rust 侧 `src-tauri/src/backend_server.rs` 负责启动、等端口、退出收树；命令
  `servant_server_info` 把 `{mode, port, baseUrl}` 交给 `apiBase.ts`。
- 开发时不用打包版 sidecar，而是由 `scripts/dev.mjs` 用系统 Node 直接跑同一份
  **payload**（`servant-server.cjs`），所以改后端无需 SEA 打包。要验证真正的 sidecar
  进程，用 `SERVANT_FORCE_SIDECAR=1`。
- 后端新增任何从 `paths.root` 读取的文件，都要同步加进 `tauri.conf.json` 的
  `bundle.resources`，否则会出现「dev 正常、安装版报错」。
- 排查入口：sidecar 日志 `%APPDATA%\com.servant.desktop\backend.log`，端口
  `backend-port-<pid>.json`（按 PID 命名以支持多实例）。
- 实时流同理：`RealtimeGatewayClient` 的候选地址里，打包后端排在最前。Tauri 自带的
  `realtime_gateway_port` 网关只处理 `desktop.sync` 与 `web.search`，**不含 chat.turn**。
- **前端调后端一律用 `backendFetch()`**（`src/app/network/backendFetch.ts`）。它会先
  `await ensureApiBase()` 再把 `/api/*` 拼到 sidecar 地址上。不要直接写 `fetch('/api/...')`：
  打包页面的 origin 是 `tauri.localhost`（Tauri 资源协议），相对路径的 `/api/*` 不会被 Vite
  代理，而是被资源协议用 `index.html` 应答，且**状态码是 200**、`content-type: text/html`，
  于是 `response.json()` 抛 `Unexpected token '<'`。这个失败在 UI 上表现为「一直加载中」而不是
  报错，很难从现象反推（`CompanionChatPanel` 曾经就在 `characterSkill` 为空时无条件返回加载
  占位，把真实错误吞掉）。需要离开本机的请求（LLM、模型下载）走 `createGlobalNetworkFetch`，
  它会额外经 `/api/network-proxy` 转发。`src/app/network/backendFetch.test.ts` 会扫描 `src/`
  强制这条规则，新模块漏接会被测试拦下。

## 构建与调试入口

四者的后端路由都来自 `createApiModules()` 这一张表，前端地址都来自 `apiBase.ts`，所以不会
出现「dev 能用、安装版报错」。

| 命令 | 用途 | 产物 |
| --- | --- | --- |
| `npm run dev` | 日常开发 | 无产物：前端 5173 热更新，后端 5174 独立进程 |
| `npm run build:fast` | 快速生产构建 | `dist-fast/Servant/`（可直接双击运行，无安装包） |
| `npm run verify:desktop` | 构建 + 启动 + 端到端验收 | 无新产物，结论是 PASS/FAIL 与 `backend.log` 尾部 |
| `npm run build:release` | 完整发布构建 | `src-tauri/target/release/bundle/` 下的 MSI + NSIS 安装包 |
| `npm run migrate:data` | 一次性：搬迁旧 identifier 的数据目录 | 无新产物；不加 `-- --yes` 只空跑

**`tauri:build` 与 `build:release` 是同一条命令。** `package.json` 里
`"tauri:build": "npm run build:release"`，而 `build:release` 就是 `tauri build`，所以两者
逐字节等价，不存在「哪个更完整」的区别。同一组里还有：`tauri` → Tauri CLI 本身，
`tauri:dev` → `tauri dev`（**唯一会监听并重编 Rust 的入口**），`tauri:fast` →
`tauri dev --no-watch --config tauri.fast.conf.json`（复用 `desktop:serve` 已经建好的
`dist/`，Rust 改动不会自动重编）。

`tauri build` 之所以慢，是因为它跑完 `beforeBuildCommand`（`npm run build` 即 typecheck +
前端 + 后端 payload + SEA）之后还要把 ~700MB 压成 MSI 与 NSIS 两个包；只要可执行文件时用
`build:fast`，它跳过打包，并把 `bundle.resources` 声明的文件暂存出来。

### 改一个文件，谁会重启

| 改这里 | `npm run dev` 下的反应 |
| --- | --- |
| `src/**` 前端（组件、样式、`chatStorage` 等） | Vite HMR，**不重启** |
| `src/server/**`、`src/app/network/server/**` 等后端源码 | `vite build --watch` 重建 payload → **只重启 `[backend]`**（约 1 秒），前端与已开的 WebSocket 不受影响 |
| `vite.server.config.ts` | 同上：payload 重建 → 只重启后端 |
| `vite.config.ts` / `vite.shared.ts` | **整台 dev server 重启**，页面会重载，WebSocket 断开重连（后端进程仍在，所以不会卡死） |
| `public/**` 静态资源 | 由 dev server 直接读盘，刷新页面即可生效 |
| `src-tauri/src/**`（Rust） | **什么都不会发生** —— `npm run dev` 根本不跑 Rust。要它自动重编重启用 `npm run tauri:dev` |
| `src-tauri/tauri.conf.json`、`bundle.resources` | 什么都不发生；装进 exe 的内容必须重新构建 |
| `memory_service/**`（Python） | 什么都不发生。记忆服务是后端拉起的常驻子进程，改完需重启应用（或杀掉那个 `python.exe`，下次请求会自动重新 spawn） |

规律很清楚：**只有前端有 HMR，只有 `npm run dev` 编排的后端会热重启；凡是编译进 exe 的
东西（Rust、sidecar payload、打包资源）都没有热路径**，必须走一次构建才能看到效果。上表
最后四行就是 `verify:desktop` 存在的理由。

### dev：前后端分离

```bash
npm run dev
# [backend] node src-tauri/binaries/servant-server.cjs -> 127.0.0.1:5174
# [bundle]  vite build --watch（后端源码改动 → 重建 payload）
# [ui]      vite dev server 5173，/api 与 WebSocket 代理到 5174
```

改后端源码只重启 `[backend]`，前端 dev server 不动；改前端走正常 HMR。由
`scripts/dev.mjs` 编排，退出时按进程树回收，不留孤儿进程。

这条「改后端不重启前端」成立的前提是：**`vite.config.ts` 不能 import 任何后端模块**。
Vite 会把配置文件静态 import 的模块当作 config 依赖来 watch，一旦引入 `apiModules.ts`，
每次改后端都会整台 dev server 重启，连带丢掉 HMR 状态和所有 WebSocket 连接。所以：

- `vite.config.ts` —— 只管 UI 与构建，`server.proxy` 恒定指向 5174；
- `vite.preview.config.ts` —— 唯一挂载 API 模块的地方，供 `vite preview`
  （`desktop:serve` / `tauri:fast`）使用，它不 watch，改后端需要重启；
- `vite.server.config.ts` —— 打后端 payload；
- `vite.shared.ts` —— 两边共用的 COOP/COEP 头。

### build:fast：只要可执行文件

`scripts/build-fast.mjs` 做四件事：typecheck → `vite build` → 后端 payload + SEA →
`tauri build --config src-tauri/tauri.nobundle.conf.json`（`bundle.active: false`，
不压缩安装包），最后把产物**暂存**成 `dist-fast/Servant/`。

暂存而不是直接用 `target/release/`，是因为那里还混着几百 MB 的 `.rlib`/`.pdb`，
无法一眼确认负载是否完整。暂存清单直接读 `tauri.conf.json` 的 `bundle.resources`，
不另抄一份，所以快速构建和安装包的资源集合不可能漂移。

### 安装包体积组成

`npm run size:report` 会打印这份组成并标出重复项。下面是清理动作资产**之前**的实测值，
动作包从 310 个裁到 59 个之后没有重测，但 `dist/assets` 那两项会明显下降：

```text
dist/                 1324.0 MB   ← 整个 dist 会被嵌进 exe，再被压缩进安装包
  assets               836.2 MB
  models               485.4 MB
  其中纯重复            313.3 MB
servant-desktop.exe      692.5 MB
servant-server.exe        86.1 MB
MSI                    716.1 MB
NSIS                   710.6 MB
```

**重复打包（占 dist 约 24%）**：Vite 对「指向 `public/` 的 `?url` glob」
会同时产出两份——`dist/assets/<name>-<hash>.<ext>`（被打包进 bundle 的那份）和
`publicDir` 原样复制的 `dist/assets/<name>.<ext>`。涉及的导入点只有两个：

- `src/character/vrm/assets/vrmModels.ts` → `.vrm`
- `src/character/motion/assets/vrmaAssetFiles.ts` → `.vrma`（唯一的 VRMA glob；
  调试面板与 VRMA 编辑台都从这里取，不要再各写一份 `import.meta.glob`）

而 `ActionLoader.normalizeVrmaUrl()` 又硬编码了 `/assets/motions/...` 这个 public 路径，
所以两份目前都在被用。要清掉重复，二选一：

1. 让上述 glob 只取 key，再由 key 推导 public 路径（`/assets/motions/...`），
   不再让 Vite 产出 hashed 副本。注意非 ASCII 文件名（`可莉.vrm`、`coco小熊.vrm`）
   需要 `encodeURI`。
2. 把源资源移出 `public/` 改为正常导入，只保留 hashed 那份。范围更大，会同时牵动
   `vrmaFilesApi`（它按磁盘路径扫 `public/assets/motions`）。

**已经清掉的一批**：`public/assets/motions` 原有 355 个文件 / 410.8 MB，其中 295 个
（246 个未被任何配置引用的 `.vrma`，以及全部 `.fbx` / `.glb` / `.zip` / `.png` 源文件与截图）
在全仓库无引用，已删除；剩下的 59 个拍平进 `public/assets/motions/vrma/` 并按拼音改名。
逐文件出处见 [motion-assets.md](motion-assets.md)。
`public/models/sherpa-asr/sherpa-onnx-wasm-main-asr.*`（约 12 MB）也没被
`offline-worker.js` 引用，它只加载 `-vad-asr` 变体，已随 `public/models` 整目录移除。

**引擎与模型已拆开（2026-09-23）**：原先打包内置的 `public/models/sherpa-asr` 共 485.4 MB
——`model.int8.onnx` 228 MB、一个 229 MB 的 `.data` 预载包，外加约 28 MB 运行时。
其中模型部分是**纯重复**：`.data` 里那份与 `model.int8.onnx` 逐字节相同（首 239,233,841
字节 sha256 一致，尾段等于 `tokens.txt`）。现在运行时搬到 `public/engines/sensevoice/`
（约 17 MB：WASM 二进制、glue、worklet 与两个 Silero VAD 导出），模型一律由初始化面板
按需下载到用户自选目录，安装包里一份模型都没有。

`.data` 不再随包发布。worker 用 emscripten 的 `getPreloadedPackage` 钩子跳过它——
**这个钩子必须保留**：glue 把数据包当作硬运行依赖（`addRunDependency("datafile_...")`），
文件缺失而没有钩子会让运行时**永久卡在未就绪**，而不是抛错。详见
[provisioning.md](provisioning.md)。

**不是用户数据**：`%LOCALAPPDATA%\com.servant.desktop\EBWebView`（约 941 MB）是 WebView2 的
缓存目录，可随时删除；用户数据在 `%APPDATA%\com.servant.desktop`。

### 持久化数据与可执行文件分离

打包版的可写目录是 `%APPDATA%\com.servant.desktop`（Rust 通过 `SERVANT_DATA_DIR` 传入），
只读资源目录是安装目录（`SERVANT_PROJECT_ROOT`）。因此：

- 重新构建、覆盖安装、甚至换用 `dist-fast` 的便携版，都不会碰对话记录、记忆库
  （`.local/memory.lancedb`）和设置；
- `%LOCALAPPDATA%\com.servant.desktop\EBWebView` 是 WebView2 的缓存，不是用户数据，可随手删；
- 便携版与安装版共用同一个数据目录，所以能来回切换；但也意味着端口公告文件必须按
  PID 命名（`backend-port-<pid>.json`），否则两个实例会读到对方的后端端口。
- 记忆服务的 Python 解释器解析顺序见 `memoryServiceApi.ts` 的 `pythonCandidates()`：
  `SERVANT_PYTHON` → `<root>/.venv-memory` → `<data>/.venv-memory` → `python`。
  打包版没有仓库级的 `.venv-memory`，所以要在数据目录里放一份（只做一次，重装不丢）。
  最省事的是直接复用开发用的那一份——`pyvenv.cfg` 的 `home` 指向基础 Python，两边都在时复制即用：

  ```powershell
  robocopy .venv-memory "$env:APPDATA\com.servant.desktop\.venv-memory" /E /MT:16
  # 或者从零建：
  uv venv --python 3.13 "$env:APPDATA\com.servant.desktop\.venv-memory"
  uv pip install --python "$env:APPDATA\com.servant.desktop\.venv-memory\Scripts\python.exe" `
    -r memory_service\requirements.txt
  ```

- **嵌入模型也得跟着进数据目录**：`servant_memory.py` 的 `Config.from_env()` 用相对路径
  `Path('.local/models/Qwen3-Embedding-0.6B')` 判断有没有本地模型，而 sidecar 拉起记忆服务时的
  CWD 就是数据目录。开发时 CWD 是仓库根，所以一直命中本地模型；打包版不把模型放进
  `<data>/.local/models/` 的话，它会**静默**回退到 `Qwen/Qwen3-Embedding-0.6B` 走 HuggingFace
  下载（约 1.2 GB，离线直接卡住）。也可以设 `SERVANT_EMBEDDING_MODEL` 指到别处。

  ```powershell
  robocopy .local\models\Qwen3-Embedding-0.6B `
    "$env:APPDATA\com.servant.desktop\.local\models\Qwen3-Embedding-0.6B" /E /MT:16
  ```

  没装依赖时 `/api/memory/*` 返回 503，body 会直接说明是哪个解释器缺依赖。同一个根因还会让
  `/api/chat/history` 返回 `503 {"error":"fetch failed"}`（聊天历史也转发给记忆服务），
  `backend.log` 里则是 `servant_memory.py` 的 `ModuleNotFoundError`。别被这两个一起出现的 503
  带偏去查端口或网络：同一端口上 `/api/nothing` 仍然是 404 + JSON，就说明 sidecar 本身是好的。
  `start()` 只在 `handle.exitCode === null` 时早退，所以补装依赖后下一次请求就会重新拉起
  记忆服务，**不用重启应用**。

**记忆服务冷启动（预热协议）**：本机实测冷启动约 13 秒（import torch ≈ 10s、lancedb ≈ 1.4s、
权重加载 ≈ 1.7s）。`servant_memory.py` 现在先绑端口再在后台线程预热，期间：

- `/api/memory/health` 回 `{"status":"warming","seconds":N}`（预热完成变 `ready`，进程里
  预热线程挂了变 `failed`）；
- 其余路由回 `503 {"status":"warming"}`，**不会**阻塞到预热完成。

Node 侧唯一客户端是 `server/memoryServiceClient.ts` 的 `fetchMemory`：三条调用路径
（`/api/memory` 代理、`/api/chat/history`、`memoryGet`/`memoryPost`）都走它。它收到
`warming` 会等 `/health` 变 `ready` 再重试一次（并发调用共享同一轮询，默认预算 30 秒，
`SERVANT_MEMORY_READY_TIMEOUT_MS` 可调）；进程退出则立刻报错不空等；调用方 abort 则按
`AbortError` 语义放行。所以前端不再需要自己重试，`ChatContextBuilder` 的 2.5 秒预算内
第一轮对话也能等到记忆上下文（等不到才降级为「这轮不带记忆」）。

**启动即预热**：后端 `configure()` 在 `start()` 之后立刻调 `prewarmMemoryService()`
（`memoryServiceClient.ts`），在**没有任何请求**的情况下就把 `/health` 轮询跑起来，完成后
打一行 `[memory] pre-warmed at startup — ready in Ns`，失败则打
`[memory] startup pre-warm did not finish ...`。它**故意不 await**——为了这 13 秒去阻塞
启动会让整个应用变慢开，与目的正好相反。因为 `waitForMemoryService` 共享同一个轮询，
预热期间到达的请求会搭上这班车，而不会另起一轮。

要分清「进程被拉起」和「有人在等它」：Python 一 spawn 就开始在后台加载模型，所以预热
本来就与启动重叠；原先缺的一直是**观测**——轮询要等第一个请求进来才开始，日志里也看不出
它什么时候可用，冷启动因此只表现为「某个不走运的请求莫名卡了一下」，和慢路由无法区分。

**新增落盘逻辑时的硬规则**：可写文件一律经 `server/projectPaths.ts` 的
`resolveProjectPaths()` 取 `paths.data`，只读资源取 `paths.root`；不要写
`path.resolve('.local/...')`。打包版的工作目录就是安装目录（只读），这样写既污染安装目录，
又会在下次覆盖安装时被清掉——正是要避免的「构建丢数据」。已经踩过的坑：
`MainLlmDebugFiles.ts` 用 `path.resolve('.local')` 存 LLM 调试转储，结果打到了
`dist-fast/Servant/.local/`；现在改为 `createMainLlmDebugFiles(paths.data)`，
`characterSkillApi` / `desktopCharacterApi` 的默认参数也从 CWD 改成按两个 root 解析。

## 设置项：开机启动与交互提示

这两个开关都是**真的接上了行为**的，不是只写 localStorage 的占位。

**开机启动（默认关闭）** 对应操作系统里唯一一条启动项，由 `src-tauri/src/autostart.rs` 管理：

| 平台 | 存储位置 |
| --- | --- |
| Windows | `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` 下的 `Servant` 值（`winreg`，见 `Cargo.toml` 的 `cfg(windows)` 依赖） |
| macOS | `~/Library/LaunchAgents/<identifier>.plist`（`RunAtLoad`） |

值名随改名从 `Shiro` 换成了 `Servant`，窗口标题也一并换成 `Servant`。启动项名换掉后旧键不会自己消失：
升级前开过开机启动的机器要在注册表里手动删掉残留的 `Shiro` 值，否则两条启动项会同时生效。

- `set_autostart` 返回 `{ supported, reason, enabled }`：`enabled` 是**操作系统的真实状态**而非回显请求，
  写入被拒绝时开关不会说谎；失败原因会显示在设置面板里（`.aurelia-setting-notice`）。目前只有这一个命令——
  前端不需要「读」，因为写入本身是幂等的。
- `useDesktopAutoStart` 在设置窗口打开时也会**无条件重写一次**（而不是先读后写）：写是幂等的，
  而重写正好能修掉「指向旧安装路径」的启动项，否则覆盖安装后那条记录会永远失效。写入走队列串行，
  避免快速连点时旧请求落到新请求之后。
- **开发版（`tauri dev` / `tauri:fast`）不注册启动项**，并且会顺手删掉早前留下的那条：它的窗口按 `devUrl`
  从本地开发服务器取页面，登录时那个服务不在运行，注册了只会得到一个白窗口——这正是「开机启动后加载不到
  页面」的成因。判断用 `cfg!(dev)`（Tauri 自己在 `get_app_url` 里挑 `devUrl` 还是内嵌资源用的同一标志，
  `tauri build` 会打开 `custom-protocol` 把它关掉），结果放进 `supported`/`reason` 回给前端：开关会被置灰
  并显示原因，而不是留一个亮着却什么都不做的开关。**这条守卫只拦写入，删除永远放行**，否则旧的坏记录
  再也清不掉。
- 开机启动不考虑「被系统启动」这一情形：现在没有 `--autostart` 之类参数，启动行为与手动双击完全一致。
  所以「注册的那条命令能不能自己出页面」是唯一前提，这也正是上面那条守卫的依据。
- 「最小化到托盘」设置项**已删除**：窗口关闭本来就是 `prevent_close() + hide()`（`desktop_windows.rs`），
  这个字段没有任何消费方，`default-settings.json` 里也一并去掉了。

**交互提示（默认开启）** 是决定「角色界面暴露多少运行时遥测」的唯一开关，含义集中在
`src/app/settings/interactionHints.ts` 的 `resolveInteractionHints()`：关闭后同时隐藏桌宠的活动状态
气泡（倾听中 / 思考中 …）、工具结果卡片和角色头顶的语音气泡（`VrmStage` 的 `speechBubbleEnabled`）。
新增一种提示时先往这个契约里加字段，不要在 `DesktopPet` 里各处直接判断偏好。

跨窗口生效靠 `storage` 事件（`useUiPreferences` → `useStorageRevision`）：设置/聊天窗口负责写，
桌宠窗口负责渲染，所以改开关不需要重启桌宠。这个 hook 同时替代了 `useDesktopTtsProvider` 里
原先各自复制的订阅代码。

## 已知的打包版缺口（非本次改动引入）

- `/api/vrma-files` 在打包版返回 500：它按磁盘扫描 `public/assets/motions`，而
  `bundle.resources` 里没有 `public/`。受影响的是 VRMA 片段编辑器，不影响聊天链路。
  修法是让它在目录缺失时返回空列表，或把该目录纳入资源（后者约 +410 MB）。
- `/api/memory/*` 在打包版需要上面那一步 Python 环境，属于运行环境前置条件。

## 打包版页面症状速查

打包版的页面跑在 `tauri.localhost`，与 sidecar 不同源，「dev 正常、安装版不正常」的症状
几乎都出自地址解析。不用猜——带调试端口启动就能看真实窗口：

```bash
cd dist-fast/Servant
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9222' ./Servant.exe
# 另开一个终端：在真实窗口里取 DOM / 发请求
node .local/triage/cdp-probe.mjs "document.body.innerText" "chat.html"
```

| 症状 | 原因 |
| --- | --- |
| 聊天页永远停在「正在从服务端加载角色卡…」 | `CharacterSkill.ts` 用相对 `/api/*` 拿到 HTML；错误又被加载占位吞掉 |
| 页面报 `Unexpected token '<'` | 同一根因，只是调用点自己显示了错误 |
| 桌宠窗口的 `/api` 全部失败 | `desktop-main.tsx` 没有 `await ensureApiBase()` |
| 角色/桌宠接口连到 `localhost:5173` | 调用点自己拼了 origin（旧 `characterApiUrl` 就是这样） |
| `/api/memory/*` 与 `/api/chat/history` 同时 503 | 记忆服务的 Python 缺依赖，与地址解析无关，看 `backend.log` |

**数据目录只有一处来源**：`%APPDATA%\<identifier>` 由 `tauri.conf.json` 的 `identifier` 决定，
Rust 侧一律走 `app.path().app_data_dir()`，脚本侧读同一个配置文件。历史上
`append_debug_log` 硬编码过目录名，于是日志写进了 app 自己都不读的目录——新增任何落盘路径时
不要手写这个字符串。改 `identifier` 等于换数据目录（连同 `%LOCALAPPDATA%\<identifier>\EBWebView`
里的 localStorage，也就是 LLM API key、聊天记录、TTS 配置），必须同步迁移。

判断技巧：在页面里 `fetch('/api/xxx')` 若得到 **200 + `text/html`**，就是地址没解析对；
真正的后端 404 是 JSON。这条区别很关键——资源协议对未知路径也回 200，所以「没报错」不代表通了。

## 常用验证

```bash
npm run typecheck
npm test
npm run build
npm run verify:chat                                              # 浏览器驱动真实聊天页，断言拿到非空回复
SERVANT_VERIFY_BACKEND=http://127.0.0.1:5199 npm run verify:chat   # 只验后端一轮对话（打包版用）
npm run verify:desktop                                           # 构建 exe → 启动 → 接口 + 真实对话 → 关掉
npm run size:report                                              # 构建体积组成与重复打包
cargo check --manifest-path src-tauri/Cargo.toml
```

### verify:desktop：改了 exe 之后跑这一条

Rust 源码、sidecar payload、`bundle.resources` 这些都不在热路径上，改完必须构建一次，而且
构建通过**不代表应用能用** —— 项目历史上两次真实的翻车（`/api/*` 被资源协议接走返回 HTML、
`/api/memory/*` 返回 503）编译器和 `npm run dev` 都发现不了。`scripts/verify-desktop.mjs`
就是补这一段：

```bash
npm run verify:desktop                  # 构建 + 启动 dist-fast\Servant\Servant.exe + 验收 + 关掉
npm run verify:desktop -- --no-build    # 复用已构建的产物，只做启动与验收（约 10 秒）
npm run verify:desktop -- --keep-open   # 验完不关，留着窗口自己点
npm run verify:desktop -- --skip-chat   # 只验 HTTP 面，不跑 LLM 那一轮
npm run verify:desktop -- --port=49492  # 检查一个已经在跑的实例，不构建也不启动
```

它做的事：先确认没有别的 `Servant.exe` 在跑（构建要覆盖那个被占用的 exe），然后构建、启动，
读 `%APPDATA%\<identifier>\backend-port-<pid>.json` 拿到真实后端端口，**等 Python 记忆服务
预热完成**（它现在先绑端口、再在后台加载模型，这期间一律答 `503 warming`，所以检查会等，
默认 60 秒，`SERVANT_VERIFY_MEMORY_WAIT_MS` 可调；后端日志里
`[memory] pre-warmed at startup — ready in Ns` 就是就绪信号），再逐项断言
`/api/character-skill`、`/api/memory/messages`、`/api/chat/history`、`/api/activity-logs` 为
200，以及 `/api/nothing` 必须是 **JSON 404**（返回 HTML 就说明请求根本没到后端）。最后跑
一轮真实对话。任何一项失败都会附带 `backend.log` 尾部，那里直接写着缺哪个模块、哪条路由报错。

失败退出码非 0，其余情况输出 `PASS packaged desktop app`。收尾用 `taskkill /PID <pid> /T /F`：
`desktop_windows.rs` 对 pet 窗口调了 `api.prevent_close()`（只隐藏不退出），所以不带 `/F` 的
WM_CLOSE 永远关不掉它；而 `/T` 必须在，否则会留下孤儿 `servant-server.exe` 和它的 Python 子进程。

更完整的职责和验收入口见 [README.md](README.md)。
