# Servant

Servant 以**VRM 桌宠**为载体的本地 AI 角色原型。桌面上住着一个能听、能说、能记住你的 3D 角色：
接入了20+主流云服务商，做到2s内开口说话，创造性的AI动作系统，对接本地模型断网也能使用，全本地化的用户数据。

云端需要 2个apikey 即可有良好体验
本地LLM安装 
	ollama https://ollama.com/ 安装包装完装完装模型 
	CMD -> ollama pull qwen3:4b
本地语音安装 
	GPT-SoVITS https://github.com/RVC-Boss/GPT-SoVITS
	整合包 https://www.yuque.com/baicaigongchang1145haoyuangong/ib3g1e/dkxgpiy9zb96hob4#KTvnO
	下载整合包-训练模型-py启动服务 api_v2.py
	CMD -> runtime\python.exe -u api_v2.py -a 127.0.0.1 -p 9880 -c GPT_SoVITS/configs/tts_infer.yaml

一句话概括：**前端 React + Vite 负责 UI 与角色渲染（Three.js / VRM），Tauri 2 负责桌面窗口，Node sidecar 负责 API 与 WebSocket，Python 侧负责本地向量记忆**——四层之间通过 HTTP + WebSocket 解耦，UI 永远不直接依赖 Node API。

> 本 README 面向**二次开发者**。改功能、换模型、加供应商之前请先读 [二次开发说明](#二次开发说明)。

「源码公开，仅限非商业用途」

---

## 产品功能

| 模块 | 现在能做什么 | 主要落点 |
| --- | --- | --- |
| **桌宠本体** | 透明无边框桌面窗口 + VRM 3D 角色，可拖动、可缩放；点击 / 触摸 / 摸头 / 长时间无人理会各自触发不同反应 | `pages/desktop.html`、`src/character/vrm` |
| **骨骼与体态适配** | 不同体型的模型共用同一套动作：模型适配、手臂烘焙、脚部 IK、命中测试 | `src/character/ik` |
| **表情与视线** | 情绪数值 → VRM 表情 + 一组 B/C 档微动作，视线跟随，表情统一走 `ExpressionController` | `src/character/expression` |
| **对话** | 10 家 LLM Provider；一轮回复同时产出「情绪 + 短动作 + 分条正文」，可以像真人一样分多条气泡逐条吐出 | `src/ai/llm`、`src/app/network/server` |
| **语音合成（TTS）** | 19 家 Provider 注册表（含零成本、断网可用的本地 Windows SAPI），流式分段、跨窗口播放 | `src/ai/tts` |
| **口型同步** | 实时分析**正在播放的那路音频**并驱动口型，音画天然对齐 | `visemeAnalyzer.ts`、`three-vrm-lip-sync` |
| **语音识别（ASR）** | 全离线链路：麦克风 → AudioWorklet → Silero VAD 断句 → SenseVoiceSmall ONNX 识别，支持中 / 英 / 日 / 韩 / 粤；另有全局快捷键按住说话 | `src/ai/stt` |
| **本地记忆** | LanceDB 向量库 + Qwen3-Embedding，混合检索（向量 + BM25 + 重要度）；聊天自动沉淀长期记忆，每日总结只在本地 Ollama 模式下执行，历史聊天不上云 | `src/ai/memory`、`memory_service/` |
| **联网搜索** | 作为 LLM 工具暴露，经本机网络代理取源，给回复补实时信息 | `ChatToolRegistry`、Rust 侧 `web.search` |
| **剧情事件引擎** | `EventDirector` 事件队列 + `EventRunner` 语义 step（动作 / 表情 / 语音 / 位移 / 附件 / 特效 / 等待 / 分支），写剧本不用碰底层骨骼 | `src/event` |
| **直播与外部事件** | 弹幕、POE2 游戏日志、音乐等外部输入先规范化、过滤、聚合、算优先级，再经统一消费边界进入角色 | `src/integrations` |
| **提醒与定时** | 到点让角色开口提醒；FIFO 队列、跨窗口同步、重启后不丢 | `src/scheduler`、`src/desktop` |
| **人格与角色卡** | 角色卡 + 人格状态（SoulState），决定性格、语气和长期情绪基线 | `src/ai/personality` |
| **初始化面板** | 首次运行只列出「真的缺」的资源；模型由用户自选目录下载，不塞进安装包；开发版与打包版互认同一份共享下载根 | `src/app/provisioning` |
| **设置与桌面行为** | 开机启动（Win 注册表 / macOS LaunchAgent）、交互提示开关、窗口位置记忆、托盘、全局快捷键 | `src/ui/settings`、`src-tauri` |

---

## 目录结构

```
src/
  app/           应用装配、设置存储、HTTP API、全局网络代理、实时 WebSocket
    network/     server（Node 侧）与 client（浏览器侧）共用同一份路由表
  ai/
    llm/         Vercel AI SDK 客户端、Provider 注册表、对话触发器、工具注册表
    stt/         SenseVoice / Sherpa 离线识别、VAD、音频处理
    tts/         Speech SDK Provider 注册表、流式分段、语音控制器、跨窗口语音协议
    personality/ 角色卡与人格状态
    memory/      本地回忆录（调用 Python 侧服务）
  character/
    vrm/         模型加载、舞台渲染、命中测试、气泡
    motion/      VRMA 加载、语义动作、身体区域组合、空间与附件
    expression/  表情、视线和情绪数值
    ik/          模型适配、手臂烘焙、脚部 IK
    interaction/ 点击、触摸、倾听与说话状态
  event/         剧情事件队列（EventDirector）与执行（EventRunner）
  integrations/  弹幕、游戏、音乐等外部事件适配
  scheduler/     提醒调度（toad-scheduler）
  desktop/       Tauri 窗口行为、提醒 FIFO、桌面 TTS 回放
  ui/            设置页、桌宠、聊天与各验收页面
src-tauri/       Tauri 生命周期、Rust 网关、Python sidecar 拉起与收树
memory_service/  Python 记忆服务（LanceDB + sentence-transformers）
scripts/         dev / build / verify 编排脚本
public/          VRM 角色、VRMA 动作、离线 ASR 引擎、背景与音效
docs/            与当前代码一致的主文档
```

`CharacterController`（`src/character`）是 UI 与角色能力之间的公开边界；不要绕开它直接操作 Three.js 场景。

---

## 快速开始

### 一次性准备

克隆之后除了装依赖，还有两步**各做一次**。它们的产物都被 `.gitignore` 排除，跳过不会立刻报错，
而是以「看着像 bug」的方式失败——每一步后面写明了对症的现象。

```bash
git clone https://github.com/aniongrey/Servant.git
cd Servant
npm ci                        # 与 CI 一致；npm install 也行
```

```bash
# ① 记忆服务的独立 Python 环境。
#    解释器查找顺序：SHIRO_PYTHON → <仓库>/.venv-memory → <数据目录>/.venv-memory → 系统 python。
#    不建它就会落到系统 python，然后报 ModuleNotFoundError: No module named 'lancedb'。
uv venv --python 3.13 .venv-memory
uv pip install --python .venv-memory/Scripts/python.exe -r memory_service/requirements.txt
```

```bash
# ② 桌面版的后端 sidecar（单文件可执行）。
#    它是 src-tauri 的编译期资源，缺了 tauri 会直接编译失败：
#      error: failed to run custom build command for `shiro-desktop`
#      resource path `binaries\shiro-server.exe` doesn't exist
npm run server:package
```

> `uv` 未安装：`pip install uv`。国内直连 PyPI 可能报 `tls handshake eof`，加
> `--index-url https://pypi.tuna.tsinghua.edu.cn/simple` 走镜像即可。装完依赖**不需要重启**后端。

### 日常启动

两种形态二选一，**不要同时开**——它们都要占 5173，且 preview 带 `--strictPort`，会直接报错退出。

```bash
npm run dev        # Web 形态：5173 页面 ｜ 5174 API + WebSocket ｜ 5175 记忆
```

```bash
run.bat            # 桌面形态（= npm run tauri:fast）：Shiro 窗口
                   # 5173 页面 + 全套 API ｜ 5174 WebSocket 网关 ｜ 5175 记忆
```

`run.bat` 会先跑一遍 `vite build` 产出 `dist/`（约 295MB），再用 `--strictPort` 占住 5173。

> **端口分工不同，别探错**：`npm run dev` 的后端在 **5174**，`tauri:fast` 的后端在 **5173**
> （5174 只跑 realtime 网关，对未知路径回纯文本 `Shiro realtime gateway`）。记忆健康检查是
> `GET /api/memory/health` 而不是 `/health`——探错会拿到 `{"error":"not found"}`，看着像服务坏了。

### 仓库里已经有什么、还需要补什么

仓库自带完整的**运行时资产**：VRM 角色约 112MB、59 个 VRMA 动作约 26MB、离线 ASR 引擎与两个
Silero VAD 约 17MB。所以克隆下来就能渲染角色、跑通动作与离线识别链路，不需要额外找素材。

不入库的只有两个模型权重 —— 它们体积大，而且用户在初始化面板里可以指定任意目录存放：

| 需要额外准备的资源 | 从哪来 | 能跳过吗 |
| --- | --- | --- |
| SenseVoice 语音识别权重（下载约 228MB） | 首次启动的初始化面板（`pages/setup.html`） | 不用语音输入可以跳过 |
| Qwen3-Embedding-0.6B 记忆嵌入模型（约 1.2GB） | 同上 | 不用长期记忆可以跳过 |

构建产物（`dist/`、`dist-fast/`、`src-tauri/target/`、`src-tauri/binaries/`）同样不入库，由对应命令
现场生成。其中 `src-tauri/binaries/` 要注意：它虽是忽略项，却同时是**编译期**依赖，必须先用
`npm run server:package` 补上（也就是上面的一次性准备 ②）。资产与下载的分工细节见
[docs/provisioning.md](docs/provisioning.md)。

开发服务会自动启动本地 LanceDB/Qwen3-Embedding 记忆进程。若存在
`.local/models/Qwen3-Embedding-0.6B` 则优先使用该本地模型，否则使用
`Qwen/Qwen3-Embedding-0.6B`。数据写入 `.local/memory.lancedb`。可通过
`SHIRO_EMBEDDING_MODEL`、`SHIRO_EMBEDDING_DIM`、`SHIRO_EMBEDDING_DEVICE`
和 `SHIRO_MEMORY_PATH` 覆盖。每日总结只在本地 Ollama 模式自动执行，不会默认把历史聊天发送给云端模型。
写入、混合检索、去重和 API 说明见 [本地记忆模块](docs/memory.md)。

> **冷启动窗口**：记忆服务 Python 进程刚起来时，`/api/memory/*`、`/api/chat/history`、
> `/api/activity-logs` 会先返回 503，这是正常的——本机加载 1.2GB 的 Qwen3-Embedding 实测约 20 秒。
> 以 `GET /api/memory/health` 返回 `{"status":"ready"}` 为准。装完依赖**不需要重启**后端。

### 默认入口

- 主设置页：`http://localhost:5173/`
- 桌宠：`http://localhost:5173/pages/desktop.html`
- 聊天验收：`http://localhost:5173/pages/chat-test.html`
- 记忆验收：`http://localhost:5173/pages/memory-test.html`
- SoulState 验收：`http://localhost:5173/pages/soul-test.html`
- WebSocket / 定时验收：`http://localhost:5173/realtime-test`
- 双流监听台：`http://localhost:5173/pages/ws-monitor.html`
- Debug 渲染器：`http://localhost:5173/pages/debug.html`
- 页面导航总表：`http://localhost:5173/pages.html`

本地开发页面运行在 5173，实时 WebSocket 运行在 `ws://127.0.0.1:5174/api/realtime/ws`。
`npm run dev` 会把后端作为独立进程跑在 5174 并把 `/api` 与 WebSocket 代理过去，所以
改后端代码只会重启后端，前端保持热更新。

---

## 常用命令

```bash
npm run dev              # 日常开发（Web 形态）：前端热更新 + 后端独立进程
run.bat                  # 日常开发（桌面形态），= npm run tauri:fast
npm run server:package   # 只产出后端 sidecar：desktop 形态的编译期前置，冷启约 20 秒
npm run build:fast       # 快速生产构建：只出 dist-fast/Shiro/ 可执行目录，无安装包
npm run verify:desktop   # 改了 exe 相关代码后跑这条：构建 → 启动 → 接口 + 真实对话 → 关掉
npm run build:release    # 完整发布构建：MSI + NSIS 安装包（npm run tauri:build 是它的别名）
npm run verify:chat      # 端到端验证：真实聊天页发一条消息并断言拿到回复
npm run typecheck
npm test
```

只有前端有热更新、只有 `npm run dev` 编排的后端会热重启；Rust、sidecar payload 和打包资源
都在 exe 里，改完必须走一次 `build:fast` + `verify:desktop`。哪些改动会自动重启见
[docs/development-brief.md](docs/development-brief.md) 的「改一个文件，谁会重启」。

打包版的对话记录、记忆库和设置都写在 `%APPDATA%\com.servant.shiro`，与可执行文件分离；
重新构建或覆盖安装不会丢数据。详见
[docs/development-brief.md](docs/development-brief.md) 的「构建与调试入口」。

---

## 二次开发说明

### 分层边界（改之前先想清楚改哪一层）

| 层 | 位置 | 能做什么 | 不能做什么 |
| --- | --- | --- | --- |
| UI | `src/ui` | React 组件、设置页、聊天气泡 | 不能直接调 LLM / TTS / 文件系统 |
| 装配 | `src/app` | 注册 API、WebSocket、设置存储 | 不要在这里写业务逻辑 |
| 能力 | `src/ai`、`src/character` | LLM / STT / TTS / 记忆 / 渲染 | 不感知 React |
| 外部 | `src/integrations` | 弹幕、游戏日志等事件源 | 不直接驱动角色，输出规范化事件 |
| 桌面 | `src/desktop`、`src-tauri` | 窗口、快捷键、打包 | 不承载长链路业务 |

**唯一调用规则**：前端调后端一律 `backendFetch()`；只有需要离开本机的请求（LLM 厂商、模型下载）
才用 `createGlobalNetworkFetch`（走 `/api/network-proxy`）。不要在新增调用点里手拼 URL。

### 扩展点速查表

| 想加什么 | 改哪里 |
| --- | --- |
| **新的 LLM Provider** | `src/ai/llm/LlmConfig.ts`（`LlmProviderId` 联合类型 + `llmProviderOptions` 条目）+ `src/ai/llm/AiSdkClient.ts` 的 `createModel()` 分支 |
| **新的 TTS Provider** | `src/ai/tts/speechSdkTypes.ts`（id 联合类型）+ `speechSdkProviderOptions.ts`（注册表）+ `createActiveTtsProvider.ts` |
| **新的 STT Provider** | 实现 `src/ai/stt/speechRecognitionTypes.ts` 的契约，挂到 `src/ui/chat/useCompanionConversation.ts` 装配点 |
| **新的 LLM 工具（Tool）** | `src/ai/llm/types.ts` 的 `ChatToolName` + `src/ai/llm/ChatToolRegistry.ts` 的 `definitions` |
| **新的 HTTP API 模块** | `src/app/network/server/apiModules.ts`（`modules` 数组 + `API_PATH_PREFIXES`） |
| **新的中间件** | `src/app/network/server/httpMiddleware.ts`（同时注册到 `configureServer` 与 `configurePreviewServer`） |
| **新的动作 / VRMA** | `src/character/motion/assets/` 下的 `manifest.json`、`action-configs.json`、`full-body-motion-config.json`、`vrma-segments.json`；骨骼映射在 `VrmaBoneMapper.ts` |
| **新的外部事件源** | 参考 `src/integrations/barrage/adapters/BarrageGrabAdapter.ts`（弹幕）或 `src/integrations/poe2/POE2GameEventBridge.ts`（游戏日志） |
| **新的随包只读资源** | `src-tauri/tauri.conf.json` 的 `bundle.resources` **必须**登记，否则「dev 正常、安装版报错」 |
| **新的 Rust 命令** | `src-tauri/src/main.rs` 的 `invoke_handler` + 对应 `.rs` 模块 |

### 三条必须记住的坑

1. **`vite.config.ts` 不能 import 任何后端模块。** Vite 会把 config 的静态 import 当作 watch 依赖，
   一改后端就重启 dev server 并掉光所有 WebSocket。后端只挂 `vite.preview.config.ts`，
   共用常量放 `vite.shared.ts`。
2. **热路径只有两条**：`src/**` 走 HMR；后端源码走 `vite build --watch`（只重启后端）。
   Rust、sidecar payload、`bundle.resources`、`memory_service/**` 全是冷路径，改完必须 `build:fast` + `verify:desktop`。
3. **打包版没有后端时，`/api/*` 会被 `tauri.localhost` 资产协议兜底返回 `index.html`**，
   于是报错是 `Unexpected token '<'`。注意：**资源协议对任何未知路径都返回 200 + text/html**，
   所以「页面不报错」不等于「接口通了」——真正的后端 404 是 JSON。

### 看真实打包窗口的唯一办法

```bash
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9222' ./Shiro.exe
node .local/triage/cdp-probe.mjs '<js>' '<url片段>'
```

`verify:chat` 的浏览器模式只覆盖 dev，覆盖不到打包版。

### 数据目录与 identifier

`src-tauri/tauri.conf.json` 的 `identifier`（当前 `com.servant.shiro`）是**单一来源**：
Rust 侧一律用 `app.path().app_data_dir()`，脚本统一读 `scripts/lib/tauri-config.mjs`。
它被编译进 exe，**改它等于换数据目录**，且要同时迁移两处：

- `%APPDATA%\com.servant.shiro`（记忆库、 `.venv-memory`、聊天记录）
- `%LOCALAPPDATA%\com.servant.shiro\EBWebView`（WebView2 的 localStorage：LLM Key、设置、窗口位置）

### 记忆服务的两个隐形前置条件

Python 侧除了依赖本身，还要求本地存在嵌入模型文件，否则不报错，只**静默**回退 HF 下载约 1.2GB：

- `pythonCandidates()` 查找顺序：`SHIRO_PYTHON` → `<root>/.venv-memory` → `<data>/.venv-memory` → `python`（只认存在的候选）
- `shiro_memory.py` 的 `Config.from_env()` 用**相对路径** `.local/models/Qwen3-Embedding-0.6B` 判断，
  而 sidecar 拉起时 CWD 是数据目录 → 打包版需要把模型放到 `<data>/.local/models/`

---

## 使用了哪些开源项目

Shiro 自己写的是「装配与角色运行时」这一层，其余能力尽量站在现成的开源项目上。下面按层列出实际用到的项目。

### 前端 / 桌面 / 构建

| 依赖 | 用途 | 许可证 |
| --- | --- | --- |
| `react` / `react-dom` | UI 框架 | MIT |
| `three` | 3D 渲染 | MIT |
| `@pixiv/three-vrm` | VRM 模型加载与骨骼绑定 | MIT |
| `@pixiv/three-vrm-animation` | VRMA 动画回放 | MIT |
| `three-vrm-lip-sync` | VRM 口型同步底层实现 | MIT |
| `vite` / `@vitejs/plugin-react` | 构建与开发服务器 | MIT |
| `typescript` | 类型检查 | Apache-2.0 |
| `vitest` | 单元测试 | MIT |
| `playwright` | 端到端验收 | Apache-2.0 |
| `prettier` | 格式化 | MIT |
| `@tauri-apps/api` / `cli` | 桌面端运行时与命令行 | MIT / Apache-2.0 |

### 运行时能力

| 依赖 | 用途 | 许可证 |
| --- | --- | --- |
| `ai` + 8 个 `@ai-sdk/*` | Vercel AI SDK：LLM 统一调用、流式输出、结构化回复、工具调用 | MIT |
| `ollama-ai-provider-v2` | 本地 Ollama provider | MIT |
| `@speech-sdk/core` | TTS Provider 的统一 SDK 抽象（19 家供应商） | 见包内 LICENSE |
| `undici` | Node 侧 HTTP + 代理（`ProxyAgent`） | MIT |
| `toad-scheduler` | 提醒任务的 cron / 定时调度 | MIT |
| `zod` | LLM 结构化输出与工具参数的 schema | MIT |
| `lucide-react` | UI 图标 | ISC |
| `postject` | Node SEA 打包时注入 payload | Apache-2.0 |

`@tauri-apps/plugin-global-shortcut`（PTT 快捷键，发 `shiro-global-ptt`）与
`@tauri-apps/plugin-opener` **只在 Rust 侧使用**，前端无任何 import，前端只用 `@tauri-apps/api` 的 core / window / event，
外加在用到时才动态 import 的 `@tauri-apps/plugin-dialog`（初始化面板的「选择目录」）。

### Rust 侧（`src-tauri`）

| 依赖 | 用途 | 许可证 |
| --- | --- | --- |
| `tauri` v2 | 应用框架、窗口、IPC | MIT / Apache-2.0 |
| `tokio` / `tokio-tungstenite` / `futures-util` | 本地 5174 WebSocket 实时网关 | MIT / Apache-2.0 |
| `reqwest` / `regex` | DuckDuckGo 联网搜索与结果解析 | MIT / Apache-2.0 |
| `serde` / `serde_json` | 角色卡 `library.json`、日志序列化 | MIT / Apache-2.0 |
| `winreg` | Windows 开机启动项写入（`cfg(windows)`） | MIT / Apache-2.0 |
| `tauri-plugin-global-shortcut` | 全局快捷键（PTT） | MIT / Apache-2.0 |
| `tauri-plugin-opener` | 打开外部链接 / 文件 | MIT / Apache-2.0 |
| `tauri-plugin-dialog` | 初始化面板选择模型下载目录（原生目录选择器） | MIT / Apache-2.0 |

### Python 记忆服务（`memory_service/requirements.txt`）

| 依赖 | 用途 | 许可证 |
| --- | --- | --- |
| `lancedb` | 本地向量库（cosine） | Apache-2.0 |
| `sentence-transformers` | Embedding 推理运行时 | Apache-2.0 |
| `pyarrow` | LanceDB 底层列存 | Apache-2.0 |
| `tzdata` | Windows 下时区数据 | 公共领域 / Apache-2.0 |

### 离线模型与运行时

| 项目 | 在项目中的角色 | 许可证 |
| --- | --- | --- |
| [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) | 浏览器端离线 ASR 运行时 | Apache-2.0 |
| [FunAudioLLM/SenseVoice](https://github.com/FunAudioLLM/SenseVoice) | 中文 / 英日韩粤 ASR 模型本体 | Apache-2.0 |
| [Silero VAD](https://github.com/snakers4/silero-vad) | 麦克风实时断句 | MIT |
| [Qwen3-Embedding-0.6B](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B) | 记忆嵌入模型 | Apache-2.0 |
| [DuckDuckGo](https://duckduckgo.com/) | 联网搜索的取源服务（非库，走 Rust 侧抓取） | 受其服务条款约束 |

> 上表许可证依据各项目公开仓库的常规声明整理，可能随上游版本变化；**最终以各自仓库的 LICENSE 文件为准**。
> 对外发布或 fork 前，请自行核对所依赖项目的授权条款。

---

## 模型选择

四件东西各自可选：对话的 LLM、出声的 TTS、听写的 ASR、记忆的 Embedding。它们互不耦合，可以随意组合。

### LLM 对话

注册表在 `src/ai/llm/LlmConfig.ts`，共 10 家 Provider：

| Provider | 备注 |
| --- | --- |
| `ollama` | **默认**，完全本地，默认模型 `qwen3.5:9b` |
| `deepseek` | 推荐，中文性价比高 |
| `doubao` | 推荐，走火山方舟（`ark.cn-beijing.volces.com`），默认 `doubao-seed-2-1-turbo-260628` |
| `openai` | 通用，支持 GPT 系列 |
| `anthropic` | Claude 系列 |
| `google` | Gemini 系列 |
| `xai` | Grok |
| `mistral` | Mistral / Codestral |
| `groq` | 低延迟推理 |
| `cohere` | Command 系列 |

默认配置（`defaultLlmConfig`）：`provider: 'ollama'`、`model: 'qwen3.5:9b'`、`temperature: 0.7`。

选择建议：

- **重视隐私 / 离线**：选 `ollama`。这也是唯一会执行「每日总结」的模式——流水线不会默认把历史聊天发给云端模型。
- **中文日常对话**：`deepseek` 或 `doubao`，两者与 `ollama` 一起被标为 UI 推荐项。
- **需要函数调用 / 结构化输出稳定性**：优先 OpenAI 或 Anthropic，`zod` schema 在 `AiSdkClient.ts` 里做结构化校验。

流式输出的格式约定值得注意：中文回复首行是 `<emotion happy>` 形式的情绪标签，正文紧随其后；
模拟真人分条发送时由模型用独占一行的 `<message>` 划分；末尾 `<meta>...</meta>` 承载 soul、强度、动作和记忆元数据，
不进入气泡也不进 TTS。若你在 Prompt 里破坏了这套约定，UI 会静默丢东西。

### TTS 语音

注册表在 `src/ai/tts/speechSdkProviderOptions.ts`，共 19 家可用 Provider（外加 `none` 关闭）：

**UI 推荐的四家：**

| Provider | 默认模型 | 默认音色 | 说明 |
| --- | --- | --- | --- |
| `microsoft` | `system-speech-synthesis` | 跟随系统 | 本地 Windows SAPI，**零延迟、零成本、断网可用** |
| `doubao` | `seed-tts-2.0` | — | 豆包语音，中文自然度最好之一，经服务端代理 `doubaoTtsProxyApi.ts` |
| `elevenlabs` | `eleven_multilingual_v2` | `JBFqnCBsd6RMkjVDRZzb` | 音色自定义能力强 |
| `fish` | `s2-pro` | — | Fish Audio，支持 `[happy]` 类方括号情绪 cue |

其余可选：`openai`（`gpt-4o-mini-tts` / `alloy`）、`deepgram`、`google`、`cartesia`、`fal`（Kokoro）、
`gradium`、`hume`、`inworld`、`minimax`、`mistral`、`murf`、`resemble`、`smallestai`、`speechify`、`xai`。

默认输出：`sampleRate 48000`、`mp3`、`timeout 30s`（`speechSdkTtsConfig.ts`）。

**语音标签只对两家生效**：只有 Fish S2 Pro 和豆包 TTS 2.0 会让副 LLM 生成语音标签——
Fish 用 `[happy]`、`[sobbing]` 这类方括号 cue，豆包用 `[开心地说]`、`[忍不住啜泣]` 这类中文自然语言标签。
标签只存在于交给 TTS 的 `spokenText`，不会进入主回复、气泡或聊天历史。

> **TTS 所有权铁律**：聊天窗口**从不**播放对话 TTS，它只发 `speech-start / delta / end / cancel` 事件；
> `pages/desktop.html` 的 `DesktopConversationSpeechStream` 是唯一的播放器。改这块时别越过这条边界。

### ASR 语音识别

目前**只有一条离线链路**，没有云端 ASR：

```
麦克风 → AudioWorklet（16kHz 单声道）→ Worker 里 Silero VAD 断句 → SenseVoiceSmall ONNX int8 识别
```

- 配置在 `src/ai/stt/sherpaSpeechConfig.ts`：16kHz、`language: zh`、`ITN=1`，模型 URL 由 `createSenseVoiceAssetUrls()` 生成
- **引擎**在 `public/engines/sensevoice/`（资源映射在 `offline-worker.js`），约 17MB，随包发布
- 运行时来自官方 `sherpa-onnx-wasm-simd-1.13.2-vad-asr-zh_en_ja_ko_cantonese-sense_voice_small`
- **模型不随包发布**，由初始化面板下载到用户自选目录（默认 `<应用根>/models/sherpa-asr`，条目
  `sherpa-asr-model`，来源 `pengzhendong/sherpa-onnx-sense-voice-zh-en-ja-ko-yue`，只取
  `model.int8.onnx` + `tokens.txt` 共约 239MB）；webview 经
  `GET /api/provisioning/assets/sherpa-asr-model/<文件名>` 读回。官方发行包里那个约 229MB 的
  `.data` 预载包只是模型的重复副本，不再发布——worker 用 emscripten 的 `getPreloadedPackage`
  钩子跳过它。详见 [docs/provisioning.md](docs/provisioning.md)
- **初始化窗口只在真的缺东西时出现**：桌面壳启动时问后端一次（`GET /api/provisioning/gate`），
  「已完成过初始化」或「模型已在某个运行时会读的位置」都不会再弹。下载根目录会额外发布到
  `%LOCALAPPDATA%\Shiro\model-roots.json`，所以开发版与打包版互认同一份模型，不必各下一遍

识别语言支持中 / 英 / 日 / 韩 / 粤。若你的场景不需要粤语或英文，可以换更小的 SenseVoice 包以显著缩减体积。

### 记忆 Embedding

- 默认模型 `Qwen3-Embedding-0.6B`，**维度 1024**；路径来自初始化面板的下载目录（后端注入
  `SHIRO_EMBEDDING_MODEL` 指过去），未准备时回退 HF 下载
- 向量库 LanceDB，相似度 `cosine`
- **混合检索打分**：`0.68 × 向量相似度 + 0.29 × BM25 + 0.03 × 重要度`（`memory_service/shiro_memory.py`）
- **不含 reranker**，如需更强的重排要自己加一层

### 角色与动作资产

| 资产 | 位置 | 规模 |
| --- | --- | --- |
| VRM 角色 | `public/assets/character/` | 8 个模型，约 112MB（另有同内容副本 `TestModel.vrm`） |
| VRMA 动作 | `public/assets/motions/vrma/` | 59 个 `.vrma`，约 26MB，单层扁平目录 |
| 离线 ASR 引擎（非模型） | `public/engines/sensevoice/` | 约 17MB，随包发布 |
| 离线 ASR 模型 | 初始化面板下载到用户自选目录（只有 `model.int8.onnx` + `tokens.txt`） | 下载约 228MB，**不随包发布** |
| 背景壁纸 | `public/assets/backgrounds/` | 1080p PNG（ImageGen 生成） |
| 摸头音效 | `public/assets/fx/` | 7 个短音频 + 1 张铁盆图（内置生成 / 合成） |

动作包构成：Mixamao 22、Rokoko 16、Sample 9、VRoid 7、Kimodo 5（含顶层 `oldIdle.vrma`）。
文件名是小写连写拼音的动作 id（`daiji` = 待机、`sikao` = 思考），**文件名即引用 key**，
逐文件出处见 [docs/motion-assets.md](docs/motion-assets.md)。

换模型只需把 `.vrm` 放进 `public/assets/character/` 并在设置页选择；
`src/character/motion/VrmaBoneMapper.ts` 负责把 VRMA 骨骼映射到不同体型的模型，
遇到非 VRoid 素体时大概率要调这里。

---

## 文档索引

开发前请先读 [docs/development-brief.md](docs/development-brief.md)，那里规定了约束、命令与「改一个文件，谁会重启」。

| 文档 | 内容 |
| --- | --- |
| [docs/development-brief.md](docs/development-brief.md) | **开发前必读**：构建调试入口、热更新边界、常见陷阱 |
| [docs/architecture.md](docs/architecture.md) | 运行时分层、目录职责、页面入口 |
| [docs/conversation-and-voice.md](docs/conversation-and-voice.md) | LLM、SenseVoice、TTS、联网搜索与对话触发器 |
| [docs/memory.md](docs/memory.md) | 本地记忆写入、混合检索、每日提取与验收 |
| [docs/realtime-and-reminders.md](docs/realtime-and-reminders.md) | 5174 WebSocket、跨窗口语音与持久化提醒 |
| [docs/live-and-events.md](docs/live-and-events.md) | 直播事件管线、角色动作与事件队列 |
| [docs/provisioning.md](docs/provisioning.md) | 初始化门禁、模型下载条目与共享下载根 |
| [docs/motion-assets.md](docs/motion-assets.md) | 59 个 VRMA 动作的逐文件来源记录 |
| [docs/verification.md](docs/verification.md) | 测试层级与人工验收入口 |

## 📜 License / 使用许可

Servant 采用 **PolyForm Noncommercial License 1.0.0** 许可协议。

本项目开放源代码旨在促进 AI 角色、自主行为与本地记忆技术的学习、研究和交流。

### ✅ 允许的用途

在协议允许的非商业范围内：

- 个人学习、研究与技术交流。
- 下载、运行和测试项目。
- 修改源代码并进行非商业实验。
- 分享非商业性质的修改版本，并遵守原协议中的许可通知要求。

### ❌ 商业使用限制

未经相关权利人另行授权，不得将本项目用于超出上述许可证许可范围的商业目的，包括但不限于：

- 将本项目或其修改版本作为商业产品销售。
- 将本项目集成至收费软件或商业服务。
- 基于本项目开发、运营商业化 AI 桌宠或虚拟角色产品。
- 其他不属于许可证允许范围的商业用途。

商业授权请联系项目作者。

### 第三方资源声明

本项目所涉及的第三方 VRM 模型、动作资源、音频、字体、AI 模型权重及其他素材，其版权与使用权限归各自权利人所有。

**Servant 的软件许可证不代表对第三方资源的再授权。**

第三方资源应遵守其各自的许可协议。未明确取得再分发授权的素材，不应随本项目公开分发。

完整软件许可证请参阅仓库根目录的 `LICENSE` 文件。

Copyright © 2026 Servant Contributors.

SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0