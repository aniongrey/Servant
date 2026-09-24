# 对话与语音

## 对话链路

```text
文本或 SenseVoice 转写
-> 提醒规则 / 联网查询副 LLM
-> 提醒 / 联网搜索 / 普通 LLM 对话
-> 结构化 speech、emotion、shortAction、memories
-> UI 更新与角色动作
-> WebSocket 对话语音事件
-> pages/desktop.html TTS
```

主逻辑位于 `src/ui/chat/useCompanionConversation.ts`，LLM 与工具位于 `src/ai/llm`。

## 主 LLM 输出协议

主 LLM 只输出**两个连续 JSON 对象**。`<emotion>`、`<message>`、`<meta>` 之类的标签式写法是早期协议，现在只作为模型自创的噪音由 `sanitizeAssistantSpeech` 剥掉，不会进入气泡或 TTS：

```json
{"speech":"你……又在故意逗我吗？","emotion":"shy","intensity":0.7,"shortAction":"shy_small","ttsEmotion":"sad"}
{"replies":[{"speech":"别、别这样看我。","emotion":"shy","intensity":0.6,"shortAction":"shy_small","ttsEmotion":"embarrassed"}],"soulEvent":"chat","memories":[]}
```

| 字段                          | 取值来源                                                                                                        | 落到哪                                                                                   |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `speech` / `replies[].speech` | 自由文本                                                                                                        | 气泡与 TTS                                                                               |
| `ttsEmotion`                  | 简短英文标签                                                                                                    | 只给 TTS，不进气泡                                                                       |
| `emotion`                     | `PERSONALITY_MOODS`                                                                                             | **脸**：`moodPresentation.ts` 的 `MOOD_PRESENTATION` 选一个 VRM 表情 + 一组 B/C 档微动作 |
| `intensity`                   | 0–1                                                                                                             | 表情权重（最低 0.55，保证看得见）                                                        |
| `shortAction`                 | `shortActionVocabulary.ts` 的 `replyShortActionIds`（= `full-body-motion-config.json` 的 `emotion` 组合动作表） | **身体**：`ReplyShortActionRuntime` → `ActionRuntime.play` 播组合动作                    |
| `soulEvent`                   | praise / chat / belittle                                                                                        | 角色状态                                                                                 |
| `memories`                    | 最多 3 条回忆录候选                                                                                             | 记忆服务                                                                                 |

- 词表唯一来源是配置：`emotion` 由 `PERSONALITY_MOODS` 决定，`shortAction` 由 `full-body-motion-config.json` 的 `emotion` 键（即组合动作）决定。两者都会在 `AiSdkClient` 里校验，词表外的值回落到 `defaultReplyShortActionId`（配置里的 `speaking` 动作）。
- **`emotion` 与 `shortAction` 互不越界**：答复段落播放组合动作时传 `presentation: false`，组合动作只出身体，表情与 B/C 档微动作留给 `emotion`（A 档仍由 `microdynamicsSchedule` 自己调度）。直接调用 `ActionRuntime.play` 的场景（事件剧情、调试面板）保持“组合动作自带表情”的原行为。
- 早期协议里的 `action` 字段（配合角色卡的 `allowedActions`）已移除：它只写进日志、不驱动角色，且与 `shortAction` 语义重复。`reply-short-actions.json` 的语义动作组（`stunned`/`hesitate`/`mutter`…）连同该文件一起删除了——词表只剩组合动作这一份，日志面板也不再翻译动作名，直接显示 `shortAction` 原值。

## 触发器

- 包含“叫我”或“提醒我”且能解析未来 24 小时内时间的请求进入提醒调度。
- 缺少时间时追问，不创建立即任务。
- 否定、描述规则或讨论触发词本身时不创建提醒。
- 联网搜索开启时，副 LLM 结合最近对话判断问题是否依赖当前外部信息，并把“再查一下”等省略表达还原成完整问题和搜索关键词；无法从上下文确定查询对象时不猜测。
- 当前天气、温度、金价、汇率、股价、新闻、赛程和版本等动态信息会进入查询；普通聊天与明确要求不联网的问题继续走普通对话。

提醒触发器位于 src/ai/llm/ConversationTriggers.ts，联网查询判断位于 src/ai/llm/AiSdkClient.ts。

## STT

麦克风音频经 AudioWorklet 转为 16kHz 单声道数据，由 Worker 中的 Silero VAD 切句，再交给 SenseVoiceSmall ONNX int8 离线识别。实时麦克风检测到用户重新开口时会取消当前 LLM 请求，并通过 WebSocket 打断 Desktop TTS。

模型通过初始化面板下载到用户自选目录（默认 `<应用根>/models/sherpa-asr`，条目 id `sherpa-asr-model`，
来源 `pengzhendong/sherpa-onnx-sense-voice-zh-en-ja-ko-yue`，只取 `model.int8.onnx` + `tokens.txt`），
webview 经 `GET /api/provisioning/assets/sherpa-asr-model/<文件名>` 读回。

**引擎与模型是分开存放的**：运行时是一个引擎而不是模型——WASM 二进制、glue、worklet 加两个
Silero VAD 导出，合计约 17MB，放在 `public/engines/sensevoice/` 随应用提供；模型则只存在于
下载目录，安装包里一份都没有。官方发行包那个约 229MB 的 `.data` 预载包被 worker 用 emscripten 的
`getPreloadedPackage` 钩子整段跳过——它只是模型的重复副本（还夹带一个从不加载的 Silero 导出）。
详见 `docs/provisioning.md`。

## TTS 所有权

聊天窗口不调用 `engine.speech.sayText` 或创建本地 TTS turn。它只发布：

- `speech-start`
- `speech-delta`
- `speech-end`
- `speech-cancel`

`pages/desktop.html` 的 `DesktopConversationSpeechStream` 是对话 TTS 的唯一消费者。Desktop 回传 `speech-playback-started` 和 `speech-playback-completed`，聊天据此控制打断按钮。

主 LLM 的**第一段台词**一拿到就同步给 chat 与 desktop；`replies` 里的后续段落由 `getQueuedSegmentDelayMs` 决定显示时机：轮次未结束时按可见文本长度延迟（`getReplyDelayMs`：每 10 个非空白字符约 1 秒，取整到 0.1 秒）逐条显示，等待期间两端显示“输入中”；一旦收到 `turn-end`（服务端确认不会再有段落），队首那次等待立即作废，剩余段落按 `COMPLETED_TURN_DRAIN_GAP_MS`（150 毫秒）快速吐完 —— 否则会出现“服务端已经说完、界面还在装作打字”的窗口。

仅当当前供应商为 Fish Audio S2 Pro 或豆包 TTS 2.0 时，副 LLM 才会收到对应的语音标签提示。Fish S2 使用 `[happy]`、`[disappointed]`、`[sobbing]` 等方括号 cue；豆包 TTS 2.0 使用 `[开心地说]`、`[忍不住啜泣]` 等中文自然语言语音标签。标签只存在于交给 TTS 的 `spokenText`，不会进入主 LLM 的中文回复、chat 历史或 Desktop 气泡。

主 LLM 只负责中文流式回复、`<message>` 分段和业务元数据，不返回翻译字段，也不感知 TTS Provider。启用外语转换或需要 Fish/豆包语音标签时，全部消息段会在主回复完成后一次提交给副 LLM，副 LLM 返回同数量、同顺序的 `ttsSpeech` 数组；普通中文朗读不会发起该请求。Chat 与 Desktop 继续按首条立即、后续每 5 字延迟 1 秒发送，Desktop 只使用副 LLM 结果生成音频。TTS 开启时气泡从音频开始播放时显示；TTS 关闭时立即显示。

气泡与口型是两条独立的时间线，都写在 `RuntimeSnapshot.speech` 里：

| 字段            | 语义       | 什么时候变 false                                             |
| --------------- | ---------- | ------------------------------------------------------------ |
| `speaking`      | 说话动作   | 音频结束前 `TRAILING_SILENCE_MS`（1 秒），留给尾部静音收口型 |
| `bubbleVisible` | 气泡可见性 | 音频真正播放结束（`speak()` 落定）或语音被取消时             |

`src/character/vrm/speechBubble.ts` 的 `SpeechBubbleTimeline` 消费 `bubbleVisible`：播放期间全亮并跟随文本增长，音频真正结束后再保留 `SPEECH_BUBBLE_AFTER_SPEECH_MS`（5 秒）阅读时间，然后淡出并卸载节点。**气泡不能读 `speaking`**——那会让它在音频尾部静音期间提前消失。远端 `action.voice` 路径（提醒、工具结果）复用同一个时间线：`speech-end` 先亮起并挂一个 `getSpeechBubbleDurationMs` 兜底超时，桌面回传 `speech-playback-completed` 后再切成 5 秒保留。

### 口型：分析播放中的音频

口型**不再由 `speaking` 驱动**，而是分析正在播放的那一路音频：

```text
playAudioBytes()  创建 <audio>，先接一口分析图（attachVisemeAnalyzerTo）
                  -> createMediaElementSource -> WLipSyncEngine（wlipsync：WASM + AudioWorklet，MFCC 元音分类）
                  -> 同一个元素再接到 destination，声音照常出
VrmStage 渲染循环  readLiveVisemeWeights() -> updateLipSync() 写 aa/ih/ou/ee/oh
```

- 引擎来自 [three-vrm-lip-sync](https://github.com/vlapky/three-vrm-lip-sync)（`WLipSyncEngine` + 它导出的 `createMediaElementSource`），**只用它的低层 API，不用 `VRMLipSync` 门面**：门面同时接管播放与表情写入，而这两件事在本项目各有唯一归属（`audioPlayback.ts` 放音、`VrmStage` 一个渲染循环写表情）。门面额外提供的能力里，元音命名与平滑来自引擎自身的 `weights`，"静音时松嘴" 由 `updateLipSync` 回退到 0 完成。语言无关、不依赖语音识别，也不需要额外的模型文件（WASM 与 worklet 都以 data URL 内联在包里）。
- **回退是一条硬约束**：没有权重（浏览器语音合成没有字节、上下文被自动播放策略挂起、音频元素接入失败、head-touch 音效）时 `updateLipSync` 继续用原来的程序化正弦口型，并且**把 5 个 viseme 全部写 0**——否则上一条被打断的 `ou` 会一直留在脸上。`aa`/`ih`/`ou`/`ee`/`oh` 在这条路径上互为唯一归属，别处不要再写它们。
- 分析器**绝不参与可听播放**：`attachVisemeAnalyzerTo` 只有在引擎就绪、上下文确实 `running`、且上下文能路由到所选输出设备时才接入元素，任何一条不满足就返回 `null`，元素走原路径。元素一旦被 `createMediaElementSource` 接管，输出设备就由 AudioContext 承担（`AudioContext.setSinkId`），所以此时**不能**再对元素调 `setSinkId`——两条路由会打架，用户会把语音听到别的设备上。
- worklet 需要安全上下文（`localhost` / HTTPS）：打包版页面在 `tauri.localhost`，dev 在 `127.0.0.1`，都满足。`wlipsync` 的包在模块顶层 `class extends AudioWorkletNode`，所以**必须动态 import**（`loadAnalyzer`）：这个模块已被 TTS 播放链路引用，静态 import 会让"没有 AudioWorklet"从"没有口型"升级成"没有声音"。

连续摸头的 Token 警告通过 `SpeechController.sayLocalizedText` 朗读。固定台词没有主 LLM 的 `ttsSpeech` 字段，因此仍按当前 TTS 语言设置独立转换；气泡保留中文，取消对话、开始新语音或卸载角色会使未完成的警告转换失效。

### 预取：合成与播放分离

播放必须严格串行——一张嘴、一个气泡、一份 `RuntimeSnapshot.speech` 快照——但合成不必。`TtsProvider` 上可选的 `prepare` / `play` 把「渲染」与「播放」拆成两步（`SpeechSdkTtsProvider`、`GptSovitsTtsProvider` 都实现；浏览器语音合成无法拆分，只保留 `speak`，调用方自动回落）。

`SpeechPrefetcher` 是唯一的预取入口：按 `spokenText` 键控、最多两条在飞、`take(spokenText)` 是唯一消费方式（文本不匹配就拿不到，过期音频不可能被播成别的句子）；渲染失败或被抢占时静默给 `undefined`，调用方退回按需合成。两个消费者：

- `ManagedTtsTurn`：第 k 段开始播放时预取队首——同一回复段内被标点切开的下一句。
- `DesktopConversationSpeechStream`：第 k 个回复段开始播放时，对第 k+1 段调 `SpeechController.prefetchSpeech`——跨回复段，用户听到的「句子间隙」主要在这里。

因此**第一段的开口时间不变**（它没有可提前的对象，仍是先合成再播放），变化只发生在第 2 段之后：合成与前一段的播放重叠，间隙里不再含一次合成往返。预取的音频不进入 `ManagedTtsTurn.queue`，否则 `onLipSyncEnd` 里 `closed && 队列为空` 的判断会被拖后、嘴停会晚。代价是提前计费：被打断时已渲染未播的那段白花，上限是两条。

`TtsManager.startTurn` 只取消上一个**活动** turn，不再无条件 `provider.cancel()`——这是跨段预取能活下来的前提。`provider.cancel()` 是全局急停，只由显式的 `cancel()`（打断、换供应商）使用。

## GPT-SoVITS 本地语音

`GPT-SoVITS` 是语音设置里的一个 Provider，但它不是云供应商：权重、参考音频和采样参数都是本机的
角色预设，界面上只暴露一个「角色」下拉，其余全部在自己的页面里维护。

```text
设置 → 语音设置（Provider = GPT-SoVITS）        只选角色 id，存进 config.voice
pages/gpt-sovits.html（独立页面，自带样式）            角色 / 权重 / 参考音频 / 试听
src/app/network/gptSovitsContract.ts             前后端共用的类型与常量（无依赖）
src/app/network/server/gptsovits/*               9880 客户端、权重扫描、角色持久化、路由
```

- 后端挂在 `/api/gpt-sovits/*`，由 `createApiModules()` 注册，所以 dev、`vite preview` 和打包 sidecar
  走同一张路由表；**没有第二个进程**（原型 `gpt-sovtest` 自己监听 3799，那正是 sidecar 要避免的）。
- 角色与上传的参考音频落在 `paths.data/gpt-sovits/`（打包版是 `%APPDATA%\com.servant.desktop\`），
  不要在别处手写路径。9880 地址用 `GPT_SOVITS_URL` 覆盖，默认 `http://127.0.0.1:9880`。
- Provider 只是 `{ profileId, text }` 的搬运工：`GptSovitsTtsProvider` 走 `backendFetch` 请求后端再播放
  WAV，播放与口型时间线复用 `audioPlayback.ts`（与 Speech SDK 供应商共用一份实现）。
- 切权重是 9880 进程级副作用，且官方接口会把路径写回 `GPT_SoVITS/configs/tts_infer.yaml`；
  跨版本换模型建议改配置后重启 9880，不要靠热切换。
- **权重扫描规则**（`gptSovitsScanner.ts`）：安装目录最好是**仓库根**。根下凡名字以 `GPT` / `SoVITS`
  开头的**文件夹**都算权重目录，只读它**第一层**的文件、不递归；`.ckpt` 归 GPT、`.pth` 归 SoVITS
  （**扩展名决定归属**，不看文件夹名）。`GPT_SoVITS/pretrained_models` 里的官方底模另按别名单列。
- **根可以差一层**：指到内层 `GPT_SoVITS`、某个权重文件夹、或"仓库的上一级"都能自动纠正回来
  （只试 ±1 层，且只在纠正后确实扫到权重时才采用），纠正结果放在 `GptSovitsScanResult.scanRoot`，
  页面会明说"已自动改用 X 扫描"。**没有深度兜底**：除此之外的错误路径就是空列表 +
  `missing:['GPT*','SoVITS*']`，不会去磁盘里乱翻。

## 联网搜索

搜索命令通过 5174 WebSocket 的 `web.search / run` 提交。服务端抓取并规范化来源后发布 `desktop.sync / tool-result`，该成功事件不含固定朗读话术。发起查询的聊天运行时将资料与角色卡、PersonalityState 和 SoulState 一起交给 LLM，再把结构化的总结、情绪和动作通过标准对话语音链路推送给 desktop。外部资料视为不可信输入；明显偏离查询主题的资料会被拒绝，聊天 UI 只渲染最终回答实际引用的 HTTP(S) 来源。

聊天窗口还通过 desktop.sync / character-status 同步可并存的“倾听中”“思考中”“查询中”状态；desktop 复用 CharacterInteractionController 保存状态，并在角色右上方显示。

## 聊天窗口

`pages/chat.html` 的头部只有三个按钮：**聊天设置**、**清空聊天**、**最小化**。三者都是 `CompanionChatPanel` header actions 里的独立组件，行为状态归 `useCompanionConversation`。

**分页与「没有更多了」**。首屏固定加载最近 16 条（`MemoryClient.loadChatHistory` 的 `limit = 16`），滚到顶部再取一页。`hasMore === false` 时不再请求，改为显示「没有更多了」：它**默认不在 DOM 里**，只有用户真滚到顶部（`scrollTop <= 24`）且已确认到底时才出现，3 秒后淡出（`HISTORY_END_NOTICE_VISIBLE_MS = 3000` + `HISTORY_END_NOTICE_FADE_MS = 240`，CSS 动画总时长与之对齐）。显示期间再次触发**不重置计时**，所以慢慢贴在顶部滚动不会把提示钉在屏幕上。文案统一由 `useCompanionConversation` 暴露的 `historyNotice: ChatHistoryNotice | null` 决定（加载中 / 到底 / 隐藏三态），组件不自己拼字符串。

**上下文条数**。聊天设置菜单里的数字输入写的是发给 LLM 的最近历史条数，范围 2–50、默认 8，存 `localStorage['codex-list.chatContextMessageLimit.v1']`，随每轮 chat turn 请求以 `contextMessageLimit` 下发（详见 `docs/memory.md` 的「对话上下文条数」）。它**不改变窗口里的 16 条分页**。

**清空聊天**。按钮先弹确认框，明说“仅清空聊天上下文：lancedb 里保存的全部聊天记录会被删除”+“长期记忆（记忆库）保留”，确认后才调 `clearChatHistory()`。该请求是 `DELETE /api/chat/history`（**不带 `conversation_id`**），语义是硬删除 lancedb `messages` 全表，`memories` 表不动；确认后窗口自身的消息列表一并清空。
