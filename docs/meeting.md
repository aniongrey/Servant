# 多人聊天

多个角色围绕同一个议题轮流发言的独立页面。入口是 `pages/meeting.html`（桌面菜单「多人聊天」→
`openMeetingWindow()`），实现集中在 `src/ui/meeting/`。

```text
pages/meeting.html                   页面外壳
src/ui/meeting/MeetingPage.tsx       界面 + 发言调度（唯一调用 LLM 的地方）
src/ui/meeting/meetingState.ts       会话存储、会议上下文、发言锚点
src/character/characterProfiles.ts   角色档案（名字 / 头像 / 角色卡 / VRM / 音色）
src/app/settings/meetingUserName.ts  用户称呼（默认 Master）
```

## 存储

| 键                                | 内容                                   |
| --------------------------------- | -------------------------------------- |
| `servant.meetings.v1`             | 会话：消息、发言队列、结论、待办、总结 |
| `servant.meetings.deleted.v1`     | 已删除会话，可在侧栏「历史恢复」找回   |
| `servant.characterProfiles.v1`    | 角色档案，其中 `isMain` 的那个是主角色 |
| `codex-list.meeting-user-name.v1` | 对话里对用户的称呼，写进会议上下文     |

全部是浏览器本地存储，没有后端往返。跨窗口靠 `storage` 事件同步。

## 一次发言的请求

`MeetingPage.runQueue()` 是唯一的请求驱动点：队列逐个出队，**同一时刻只有一个角色在请求**，
用单个 `AbortController` 串起来（`打断发言` / `暂停` / `结束讨论` 都是 abort）。
每个角色的这一轮请求是这样拼出来的：

| 位置                              | 内容                                                      |
| --------------------------------- | --------------------------------------------------------- |
| `personality`                     | 该角色 `characterCardId` 对应的角色卡，缺失时退 `builtin` |
| `state`                           | `createDefaultPersonalityState()` 现场生成，不跨轮累积    |
| `messages`                        | **只有一条**：本轮的发言锚点（见下）                      |
| `contextInstruction`（进 system） | `meetingContext()`：身份规则 + 会议目标 + 转录 + 待办     |
| LLM 配置                          | `loadLlmConfig()`，**所有角色共用一份**                   |

落到 `AiSdkClient.streamChat()` 时是 `system = buildSystemPrompt(角色卡, 状态) + contextInstruction`，
`messages` 再按 `CHAT_HISTORY_TURNS`（`src/ai/llm/types.ts`，当前 8）截一次——这里只有 1 条，不受影响。

## 两条通道的职责划分

这是这套实现里最容易看错的地方：**同一场会议的消息会以两种完全不同的形式进请求，各自只负责一件事。**

### system 通道 = 身份与背景

`meetingContext()` 把最近 20 条转录写成带标注的文本，并在最前面声明身份规则：

```text
发言身份规则：用户称呼为“Master”；本轮唯一应答角色是“米娅”（角色 ID：main）。
会议记录中的 [用户] 才是真人用户，[角色] 是其他 Agent 的历史发言。不得把用户说过的话、
经历或身份写成当前角色自己的，也不得冒充其他角色；始终以当前应答角色的身份回复。

最近会议记录：
[用户 · Master]：帮我定个主题色
[角色 · 可莉 / keli]：我觉得亮一点好
```

关键是**每条都带 `[用户]` / `[角色 · 名字 / id]` 标注**。多聊里所有发言在协议层本来没有归属，
不标注的话模型会把自己的队友当成自己，典型症状是复读上一位的发言。

### messages 通道 = 一条发言锚点

`meetingTurnPrompt()` 只产出**一条 `user` 轮次**：

```text
请你以「米娅」的身份回应 Master 的最新发言，不要代替其他角色说话：
Master：帮我定个主题色
```

两个设计选择：

- **不与 system 重复。** 转录已经在 system 里了，再作为 dialogue 发一遍只是重复投喂；而且把队友的
  发言映射成 `assistant` 会让模型读成自己的话。messages 只需要承担"锚点"——说清现在轮到谁、要回应什么。
- **尾条永远是 `user`。** 队列会连续跑好几个角色，第 2 个及之后的角色如果拿到一个以 `assistant` 结尾
  的对话，就没有明确的续写目标，只能从转录里猜。锚点把这件事钉死。
- 还没有人发言时（新建会话直接点「全体讨论」）用会议目标开场，队列不会静默停住。

## 调度模式

| 模式     | 进入方式     | 队列来源                                            |
| -------- | ------------ | --------------------------------------------------- |
| `manual` | 发送消息     | 正文里的 `@角色`，与参与角色取交集；没有则主角色    |
| `all`    | 「全体讨论」 | 当前参与角色全体，按顺序                            |
| `auto`   | 「自动选择」 | 从上次非用户发言者的下一位起，由模型接龙，最多 8 轮 |

`auto` 模式在每个角色说完后，从 provider 的原始输出里读最后一个 JSON 对象的 `next_speaker_id`
（`suggestedSpeakerId()`），候选中没有就退回队列首位。这个字段只是**建议**，调度器会校验它是否
在当前参与角色里。一轮跑完的 `finally` 会把模式重置回 `manual` 并清空队列（暂停时保留）。

## 与单人聊天的差异

|        | 单人聊天                                  | 多人聊天                           |
| ------ | ----------------------------------------- | ---------------------------------- |
| 走哪   | 后端 `ChatTurnOrchestrator` → `/api/chat` | 渲染进程直接调 `AiSdkClient`       |
| 接口   | `chatWithTools()`                         | `chat()`，**不带工具**             |
| 能力   | 联网搜索、定时提醒、记忆服务、TTS 标签    | 无工具；有逐角色 TTS、表情与短动作 |
| 流式   | 有，逐段吐字 + 口型                       | LLM 完整返回后按回复段在桌面播放   |
| 历史   | 后端存储的完整对话                        | 只发一条锚点，转录在 system        |
| 持久化 | 后端 SQLite + 记忆服务                    | 浏览器本地存储                     |

`AiSdkClient` 是两条链路共用的底层，所以改它的截断（`CHAT_HISTORY_TURNS`）会同时影响两边。

## 桌面多角色表现

会议开始请求时会把当前会话写入 `servant.meetingDesktopCast.v1`。桌面窗口据此读取会议参与者，
为每个角色复用同一个 `VrmStage` / `CharacterController` 表现单元；普通聊天就是只有主角色的阵容。
`action.voice` 事件用可选 `characterId` 路由到对应角色，不带该字段的旧事件仍交给主角色。

会议回复完成后，`meetingVoice.ts` 把 `AssistantIntent.replies` 原样转换为桌面回复段，保留
`emotion`、`intensity` 与 `shortAction`。会议队列等待桌面回传 `speech-playback-completed` 后才进入
下一位角色；桌面没有及时接管时会取消本次播放，避免迟到的角色语音与下一位重叠。

每个角色按档案里的 `voiceId` 解析独立音色，空值或失效值回退到当前全局语音设置。会议窗口隐藏后
WebView 和调度队列继续运行；结束讨论时清除桌面会议阵容并恢复单角色。
