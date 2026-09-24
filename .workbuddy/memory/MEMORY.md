# 项目长期记忆 — Servant / Shiro

_2026-09-24 迁入新仓库时压缩。细节查 `docs/`（`provisioning.md`／`development-brief.md`／`conversation-and-voice.md`／`memory.md`／`verification.md`／`motion-assets.md`）；技能 `tauri-node-sidecar`／`tauri-plugin-integration`／`tauri-backend-decision-gate`／`web-audio-lipsync-integration`／`repo-asset-migration`。此处只留会踩的坑。_

_本仓库的提交历史从 `c697187`（首次导入）起，迁移前的历史不可追溯；按日期的开发日志见 `.workbuddy/memory/`。_

## 远端与推送凭据

- `origin` = `https://github.com/aniongrey/Servant.git`（public）。`main` 于 2026-09-24 首推（727 文件单次提交）。
- 推送凭据走本机 **Git Credential Manager** 里已有的 `github.com` 条目，**不落库**；仓库 `.git/config` 的写法是 `[credential] helper =`（空值，清掉 system 级交互式 `helper-selector`）+ `helper = manager`，否则非交互推送会被 `helper-selector` 阻塞。**别把 token 写进 remote URL。**
- 提交身份 `Codex <codex@local>`（沿用 codex-list；本机 global/system 都没有 identity，缺了会 commit 失败）。
- 本机出网走 `http.proxy=127.0.0.1:7890`（global config）。

## 构建

- `npm run dev`＝前端 5173 HMR + 后端 5174｜`build:fast`(~1.5–3min)→`dist-fast/Shiro/`｜`build:release`＝MSI/NSIS 各~710MB｜`verify:desktop`＝构建+启动+验收（**先杀掉跑着的 Shiro**）。
- **冷路径**（改完必须 `build:fast`+`verify:desktop`）：Rust、sidecar payload、`bundle.resources`、`memory_service/**`；`src/**` 走 HMR。
- `desktop:serve`/`tauri:fast`＝`vite build` + `vite preview` 挂 `createApiModules()`；**`tauri:fast` 是用户的日常启动方式**（`run.bat`／`rundesk.bat`），它同时是 `tauri dev`。要只跑当前源码+真路由：`npx vite preview --config vite.preview.config.ts --port 5188`。
- `vite.config.ts` 只管 UI+构建，**不能 import 后端模块**（watch→重启 dev、掉 WS）；后端模块挂 `vite.preview.config.ts`、payload 挂 `vite.server.config.ts`，共用 `vite.shared.ts`。

## 目录契约

- **页面**：根目录只 `index.html`+`pages.html`，其余 18 页在 `pages/`。加/移页面改四处：`SECONDARY_PAGES`、`desktop_windows.rs` 的 `open_app_window`、`tauri.conf.json` pet `url`、`navigation.ts` 兜底 URL。
- **动作**：`public/assets/motions/vrma/` 扁平 59 个，文件名＝拼音 id，唯一清单是 `vrmaAssetFiles.ts` 的 `import.meta.glob`；`vrma/` 被 gitignore → `git mv` 无效。改名流程见技能 `repo-asset-migration`。
- **角色**：仓库只跟踪 `public/assets/character/TestModel.vrm`，其余角色 vrm 由 `.gitignore` 按文件名忽略（`public/assets/character/*.vrm` + `!TestModel.vrm`，**不要写成整目录排除**，那会把 TestModel 一起吞掉）。默认角色配置 `src/character/vrm/assets/default-character.json` 仍指向未入库的 `可莉.vrm`。

## 后端与打包

- 唯一路由表 `apiModules.ts` → `createApiModules()`，**顺序有意义**（`localCorsApi` 最前、`apiNotFoundApi` 最后）；模块要同时挂 `configureServer`/`configurePreviewServer`。
- `projectPaths.ts`：开发 `root === data === 仓库根`；打包 `root`=`resource_dir()`、`data`=`%APPDATA%\com.servant.shiro`。前端调后端一律 `backendFetch()`。
- **安装目录里没有 `public/`**（前端 dist 编译进 `Shiro.exe`）→ 后端按路径读的 `public/**` 必须逐条列进 `bundle.resources`；**搬/删这类资产要同步三处**：manifest bundle mirror、`bundle.resources`、`.gitignore`。前端取内置资源走 `toServedAssetUrl()`（`?url` glob 在 dist 给 `/public/...`，dist 只有 `/assets/...`）。
- 打包版无后端时 `/api/*` 命中 `tauri.localhost` → 回 `index.html` → `Unexpected token '<'`；**未知路径也回 200+text/html**，即「页面不报错」≠「后端通了」。
- `shiro-server.cjs`→SEA→`shiro-server.exe`：**必须 CJS**；`publicDir:false` 不能删。Rust 网关只管 `desktop.sync`/`web.search`，不含 `chat.turn`。

## 首跑门禁与资源补齐

_细节在 `docs/provisioning.md`，套路在技能 `tauri-backend-decision-gate`。_ 代码 `src/app/provisioning/` + `network/server/{provisioning*,resourceManifest,resourcePresence,sharedModelRoots}.ts`。

- **门禁**＝`!setupComplete && 有资源既不在所选目录、也不在任何运行时会读的位置`。Rust 发一次 `GET /api/provisioning/gate`（2s、重试 3 次），**取不到才回退** `setupComplete`（前提：`BackendProcess::start()` 阻塞到端口在听，且早于 `desktop_windows::setup()`）。
- **问谁**：打包版问 sidecar 端口；**`tauri:fast`／dev 没有 sidecar**（`should_own_sidecar() = !cfg!(debug_assertions)`）→ 问 `build.devUrl`（Vite 挂的是同一张路由表）。**只认 sidecar → dev 每次弹向导**：回退读 `%APPDATA%\<id>\provisioning-state.json`，而 dev 的状态写在仓库根，文件根本不存在。→ **验收必须跑用户真实的启动脚本**；只验打包版 exe 会漏掉整条 dev 分支（真踩过）。
- **三态**：`ready`＝所选下载根里有 `.shiro-provisioning.json`（面板「已就绪」只看它）｜`usable`＝`requiredFiles` 全在（免弹门禁、面板写「已在 X 可用」且**默认不勾选**、**不参与就绪判定**）｜`absent`。
- **共享下载根** `%LOCALAPPDATA%\Shiro\model-roots.json`：`writeProvisioningState()` 单点发布；只是排在选择目录与 mirrors 之后的**候选根**（`resourceRoots(...,downloadRoot?,sharedRoots)` **第 4 参默认空 → 测试不受本机状态影响**）。开发版/打包版由此互认同一份模型。

## identifier 与记忆服务

- `identifier`=`com.servant.shiro`（单一来源 `tauri.conf.json`；改它＝换数据目录，`%APPDATA%` 与 WebView2 的 localStorage（LLM key/聊天/TTS/窗口位置）都要迁，且必须重建 exe）。Python 解析：`SHIRO_PYTHON`→`<root>/.venv-memory`→`<data>/.venv-memory`→`python`。
- **清空聊天＝硬删 `messages` 全表**：`DELETE /api/chat/history` 不带 `conversation_id` → `delete_messages(None)` → `table.delete("true")`；`memories` 不受影响。
- **503 映射**：`/api/memory/*`→「记忆服务进程退出」；`/api/chat/history`→`fetch failed`；`backend.log` 是 `ModuleNotFoundError: lancedb`。`/api/nothing` 回 404+JSON ＝ sidecar 正常；记忆冷启动 17–21s 正常。

## 交互细节

- **「正在输入」**＝`phase==='thinking'||'typing'`；只在「显示队列排空 **且** 收到 `turn-end`」时回 idle（`turn-end` 后余段按 150ms 突发吐完，副作用：文本领先语音）。节奏归 `ai/llm/replyDelivery.ts`。
- **口型＝分析正在播放的那路音频**（`visemeAnalyzer.ts`／低层 `WLipSyncEngine`）；四条硬约束与推导见技能 `web-audio-lipsync-integration` 与 `docs/conversation-and-voice.md`。
- **口型与气泡是两条时间线**：`speech.speaking` 驱动说话、`speech.bubbleVisible` 驱动气泡，别混用；给 `speech` 加字段要同时补 `createInitialSnapshot` + `AgentRuntime` hydrate/save（deep merge 会重置漏写的）。
- **主 LLM 两个连续 JSON**：`emotion`→脸（`MOOD_PRESENTATION`，下限 0.55）；`shortAction`→身体（词表只有 `reply/shortActionVocabulary.ts`）。`action`/`allowedActions` 已移除。

## 设置与「初始参数」

- **开机启动（默认关）**：Win 写 `HKCU\...\Run\Shiro`，macOS 写 `~/Library/LaunchAgents/<identifier>.plist`；设置窗口打开时无条件重写。没有 `get_autostart`；**开发版拒绝写入** → 只能在打包版开。
- **「初始参数」＝各模块自带默认值**：角色 Fit 在 `vrm/assets/default-character.json`（`defaultAvatarFitConfig` 是命中测试中性基准，**别动**）｜LLM=`defaultLlmConfig`(0.3)｜语音=`defaultSpeechSdkTtsProviderConfig`｜**交互提示**＝桌宠遥测开关（`interactionHints.ts`）。`default-settings.json` 只是导出包，`localSettings.ts` 是死代码。聊天两个「条数」：窗口分页 16｜喂 LLM 的上下文 8。

## 验证

- 单测 `npm test`／`npx vitest run <path>`（`include` 只收 `src/**/*.test.ts`）；Rust 用 `cargo test --bins`（**没有 lib target**）。网络逻辑用本地 `node:http` 假站点 + 注入 `fetchImpl`；Tauri 桥用 `vi.stubGlobal`+`vi.mock` 测分支。
- **首窗口验收两条路径都要验**：打包版 `.local/triage/provisioning-gate-probe.mjs`；**dev `.local/triage/dev-gate-probe.mjs`（跑 `npm run tauri:fast`）**。**必须等 `chat-test`/`setup` 目标出现再判断**——pet 先出现，且 `backend-port-*.json` 多实例并存，不按 mtime 过滤会连到上次的实例。收尾**按端口找 pid 杀，别 `taskkill /IM node.exe`**（会杀掉用户自己的 dev server 和探针本身）。
- **headless Edge 挂载不了 React 页面**（已知正常的页也 `#root.innerHTML.length===0`）→ 布局只能靠真窗口或用户确认；纯 HTML 探针能跑真 Worker+WASM。细节 `docs/verification.md`。
- 别动生产 `dist/`：改 `npx vite build --outDir .local/triage/<名字> --emptyOutDir`。

## 环境陷阱

- `dist/` 1324MB（**313MB 纯重复**：`public/` 的 `?url` glob 同时产 hashed 与 publicDir 两份）。**E: 盘紧张**（曾满盘报 `os error 112`）→ 盘满时别在用户开着的窗口上重建 dist。
- Bash 必须加 PATH 前缀：`export PATH="/c/Users/Administrator/.workbuddy/binaries/PortableGit/versions/1.2.0/usr/bin:$PATH"`（cargo 再加 `$HOME/.cargo/bin`）。PowerShell 不回传 stdout → 重定向到文件再 Read；`reg.exe`/`wmic.exe` 被拉黑。
- `/tmp` 在 Bash 与 Windows 程序间不一致 → 临时脚本放 `.local/triage/`；curl 探本地端口带 `--noproxy '*'` 用 `127.0.0.1`；GUI 验证把「启动+使用+收尾」放同一条后台命令。
- **删除格外小心**：沙箱 SafeDelete 注入（`rm`→`genie-trash.exe`，fail-closed）。流程：删前 `git status --porcelain` → 优先 `git rm` → 移走用 `Move-Item` 到 `E:\airi\_codex-list-stale-drafts\<日期>-<主题>\`（**给 shim 的路径用正斜杠**）→ 删后 `git status --ignored=matching`。**`rm -rf` 进回收站、`df` 不变**，回收站可能压着待救快照，**别盲清**。
- headless Edge 会一直锁住 `--user-data-dir`（里面有 API Key 副本）→ 按命令行**先过滤再杀**自己的 msedge。
- **关不掉 `Shiro.exe`**：pet 窗口 `prevent_close()`，必须 `taskkill /PID <pid> /T /F`，`/T` 不能省，否则留孤儿 sidecar 与 Python。
- 基线：vitest **523 通过 / 0 失败**（118 文件，09-24）；`cargo test --bins` **15 条**。
