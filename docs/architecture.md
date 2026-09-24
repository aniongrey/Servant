# 当前架构

## 入口与页面

`src/app/main.tsx` 根据 pathname 选择页面：

| 页面                    | 用途                                |
| ----------------------- | ----------------------------------- |
| `/`、`pages/settings.html`    | 设置与管理界面                      |
| `pages/desktop.html`          | Tauri 桌宠和桌面唯一对话 TTS 播放器 |
| `pages/chat-test.html`        | 独立聊天验收                        |
| `pages/character-test.html`   | 角色与聊天组合验收                  |
| `pages/debug.html`            | VRM、动作、表情和事件调试           |
| `realtime-test`         | WebSocket、提醒队列和通知验收       |
| `pages/live-test.html`        | 直播事件管线验收                    |
| `pages/llm-latency-test.html` | LLM 与搜索延迟诊断                  |
| `pages/interaction-test.html` | 角色互动和语音动作验收              |

## 模块职责

### `src/app`

应用入口、共享类型、设置存储、HTTP API、全局网络代理和实时 WebSocket。服务端代码集中在 `src/app/network`，浏览器客户端不直接依赖 Node API。

### `src/ai`

- `llm`：Vercel AI SDK、Ollama、结构化回复、联网搜索工具和对话触发器。
- `stt`：SenseVoice/Sherpa 离线识别、音频处理和实时麦克风。
- `tts`：Provider、流式分段、语言转换、语音控制器和跨窗口语音协议。
- `personality`、`memory`：角色卡、人格状态和本地回忆录。

### `src/character`

- `motion`：VRMA 加载、语义动作、身体区域组合、空间和附件控制。
- `expression`：表情、视线和情绪数值。
- `ik`：模型适配、手臂烘焙和脚部 IK。
- `vrm`：模型加载、舞台、命中测试和气泡。
- `interaction`：点击、触摸、倾听和说话状态。

`CharacterController` 是 UI 与角色能力之间的公开边界。

### `src/event`

`EventDirector` 管理事件队列、中断和执行；`EventRunner` 执行 `action`、`expression`、`speech`、`spatial`、`accessory`、`fx`、`wait` 和 `branch` step。

### `src/integrations`

弹幕、POE2 和音乐等外部输入先完成连接、规范化、过滤、聚合与优先级计算，再通过消费接口进入角色运行时。

### `src/desktop/tauri`

负责窗口行为、桌宠设置同步、Desktop TTS 回放、提醒调度和提醒 FIFO。Rust 代码只提供 Tauri 生命周期、文件桥接和打包版 5174 网关。

## 数据与资源

- 模块内置 JSON 放在对应模块的 `assets` 目录。
- 浏览器直接读取的大型素材（音频、VRM/VRMA）放在 `public/assets`。
- **模型不随包发布**：一律由初始化面板下载到用户自选目录，见 [provisioning.md](provisioning.md)。
- 语音识别放在 `public/engines/sensevoice/` 的是**引擎**而非模型（WASM 运行时 + 两个 Silero VAD 导出）。
- Tauri 提醒写入应用数据目录 `reminders/jobs.json`。
- 浏览器开发模式的提醒使用相同 JSON schema，存放于 localStorage。
