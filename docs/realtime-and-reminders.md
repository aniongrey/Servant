# 工具、WebSocket 与定时提醒

## 统一流程

```text
对话正则触发器
-> 无角色卡的 LLM 结构化参数调用
-> scheduler / web-search 工具
-> desktop.sync / tool-result
-> 联网结果由 chat 结合角色卡与 SoulState 生成结构化回复
-> desktop 通过标准对话语音流朗读角色总结
```

普通对话和联网总结都由 chat 发布语音流，只有 `pages/desktop.html` 播放 TTS。打断按钮发布
`speech-cancel`，desktop 收到后取消当前播放。工具的资料正文、URL、任务 JSON 不会进入 TTS。

## 触发器

- 定时：明确出现“叫我/提醒我”，或“列出、取消、删除、修改提醒”等管理请求。
- 搜索：明确出现“查询/查一下”。
- 否定表达、关键词/触发器讨论、已经发生的陈述和空查询不触发工具。

触发器只负责选择工具。自然语言时间和查询词由 LLM 转成结构化参数；这次 LLM 调用不加载
角色卡、人格状态、聊天业务提示，也不生成展示话术。

## Scheduler

调度核心位于 `src/scheduler/`：

- `SchedulerTypes`：任务、schedule 和工具协议。
- `SchedulerRepository`：版本化 JSON 解析与保存。
- `SchedulerTime`：本地日历时间、Daily/Weekly Cron。
- `SchedulerService`：增删改查、运行时注册、启动/唤醒补偿。

JSON 是唯一持久化数据源。Tauri 保存到应用数据目录的 `reminders/jobs.json`，浏览器验收使用
localStorage。损坏 JSON 会先改名保留为 `.broken-*`，再建立空数据。

运行时固定使用 `toad-scheduler 4.1.0`：

- once：`LongIntervalJob`，首次执行前注销，执行后从 JSON 删除。
- daily / weekly：`CronJob`，每次按本地日历重新计算 `nextRunAt`。
- 启动、窗口唤醒和恢复可见时执行 reconcile；另有 60 秒兜底检查。
- 过期一次性任务立即补一次；周期任务最多补一次，不回放全部历史。

提醒到点后通过 `desktop.sync / reminder` 广播。desktop 的 FIFO 队列等待当前对话语音结束，
不会打断已有语音；chat 同时显示提醒消息。

## 固定工具话术

| 工具操作 | 成功话术                                     | 失败话术         |
| -------- | -------------------------------------------- | ---------------- |
| 新增提醒 | 提醒已经设置好了。                           | 定时操作失败了。 |
| 修改提醒 | 提醒已经修改好了。                           | 定时操作失败了。 |
| 删除提醒 | 提醒已经删除了。                             | 定时操作失败了。 |
| 列出提醒 | 提醒列表已经整理好了。                       | 定时操作失败了。 |
| 联网查询 | 由 LLM 根据查询结果、角色卡和 SoulState 生成 | 联网查询失败了。 |

## 验收页面

同时打开桌宠与 [http://localhost:5173/realtime-test](http://localhost:5173/realtime-test)。页面提供：

- 一次性任务新增、列表刷新和删除。
- 语音占用、到点排队、手动释放的防打断场景。
- 联网查询的原始资料推送、成功结果静音与失败话术检查。
- `tool-result`、提醒到点、开始/完成状态和原始 WebSocket 日志。

自动浏览器验收脚本：`node scripts/realtime-acceptance.mjs`。
