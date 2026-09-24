# Shiro 文档

本目录只保留与当前代码一致的主文档。早期设计稿、阶段输出、迁移记录和验收快照均已移除 —— 这个仓库是全新起点，没有可供追溯的历史版本。

## 阅读顺序

1. [development-brief.md](development-brief.md)：开始开发前必须阅读的约束和命令。
2. [architecture.md](architecture.md)：运行时分层、目录职责和页面入口。
3. [conversation-and-voice.md](conversation-and-voice.md)：LLM、SenseVoice、TTS、搜索和对话触发器。
4. [memory.md](memory.md)：本地记忆写入、混合检索、每日提取和验收。
5. [realtime-and-reminders.md](realtime-and-reminders.md)：5174 WebSocket、跨窗口语音和持久化提醒。
6. [live-and-events.md](live-and-events.md)：直播事件管线、角色动作和事件队列。
7. [motion-assets.md](motion-assets.md)：动作资产的目录契约、改名规则与逐文件来源/授权。
8. [verification.md](verification.md)：测试层级与人工验收入口。
9. [provisioning.md](provisioning.md)：首跑向导、按需下载模型仓库、下载源切换与回退。

## 当前关键事实

- `src/app` 负责应用装配、设置和网络服务。
- `src/ai` 负责 LLM、人格、记忆、STT 和 TTS。
- `src/character` 负责 VRM、动作、表情、IK 和角色状态。
- `src/event` 负责剧情事件执行与调度。
- `src/integrations` 负责弹幕、游戏和外部事件适配。
- `src/ui` 负责设置页、桌宠、聊天及验收页面。
- 聊天窗口不直接播放对话 TTS；`pages/desktop.html` 是唯一播放器。
- 对话提醒由 `toad-scheduler` 调度，并使用 JSON 持久化。
