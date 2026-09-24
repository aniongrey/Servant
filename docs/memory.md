# 本地记忆模块

记忆模块把聊天原文和可复用的长期记忆保存在本机 LanceDB，并在后续对话中用“完整原句向量召回 + BM25 召回”找到相关内容。LLM 不负责生成检索关键词，只负责阅读召回结果并决定如何回答。

## 模块边界

| 文件                                    | 职责                                                     |
| --------------------------------------- | -------------------------------------------------------- |
| `src/ai/memory/MemoryClient.ts`         | 浏览器侧记忆 API、低价值寒暄跳过和 LLM 上下文格式化      |
| `src/ai/memory/DailyMemoryJob.ts`       | 按本地日期读取前一天消息并批量提取长期记忆               |
| `src/ai/memory/MemoryLlmConfig.ts`      | 每日记忆提取模型配置，默认本地 Ollama                    |
| `src/app/network/memoryServiceApi.ts`   | Vite 到 Python 服务的代理、启动和故障后自恢复            |
| `memory_service/shiro_memory.py`        | 校验、Embedding、LanceDB 存储、BM25、融合排序和 HTTP API |
| `src/ui/memory-test/MemoryTestPage.tsx` | 手动写入、检索和删除的验收页                             |

UI 只调用 `MemoryClient`，不直接连接 LanceDB 或 Python 端口。Python 服务只监听 `127.0.0.1:5175`，浏览器统一通过 Vite 的 `/api/memory` 代理访问。

## 写入流程

```text
聊天消息
  -> POST /api/memory/messages
  -> 保存原文

记忆候选
  -> 字段校验和规范化
  -> 生成 embedding_text
  -> Qwen3-Embedding
  -> 同类型、同摘要精确去重
  -> 写入 LanceDB
```

每条记忆必须包含至少一个真实的 `source_message_ids`，用于在召回时回溯原始对话。`embedding_text` 由类型、摘要、人物和记忆标签组成；`keywords` 是被存储内容的一部分，不是查询前置条件。

去重仅比较规范化后的 `memory_type + summary`。大小写和多余空白会被忽略，但语义相似、事实不同的记忆允许同时写入，避免短文本被向量相似度误判为重复。

## 检索流程

```text
用户完整原句
  ├─> Qwen3-Embedding cosine Top N
  └─> BM25 Top N
          ↓
       按记忆 ID 合并
          ↓
  0.68 × vector + 0.29 × text + 0.03 × importance
          ↓
       阈值过滤与 Top 8
          ↓
  带原文来源交给对话 LLM
```

`retrieveMemories(query)` 直接发送用户完整原句。只有“你好”“哈哈”“谢谢”等明确无历史价值的短消息会由本地规则跳过；不存在“LLM 判断是否检索并生成关键词”的必经步骤。

BM25 使用 Python 标准库实现：

- 中文连续文本按双字切分，保留词序关系；
- 英文、数字和 `VRM`、`Unity` 等标识符按完整词匹配；
- 当前扫描最多 100,000 条本地有效记忆，不需要维护额外索引。

服务端仍支持 `memory_types`、`time_start`、`time_end` 和 `sort` 作为可选过滤条件。默认相关度阈值是 `0.2`，客户端默认返回 8 条。

如果本地有效记忆增长到扫描耗时可测，再把 `text_search` 换成 LanceDB FTS 索引；在此之前不增加索引同步和迁移成本。

## 对话上下文条数

发给主 LLM 的「最近聊天记录」条数不是常量，而是**每轮请求带过来的**：

```text
聊天页齿轮菜单 → contextMessageLimit（localStorage）
  -> ChatTurnRequest.contextMessageLimit
  -> validateChatTurnRequest / normalizeContextMessageLimit（钳制到 2–50，缺失回落 8）
  -> ChatContextBuilder.build
  -> loadRecentChatHistory(signal, contextMessageLimit)
  -> GET /api/chat/history?conversation_id=companion&limit=N（转发到 /api/memory/messages）
```

- 默认值与范围是**契约层常量**（`ChatTurnContracts.ts` 的 `DEFAULT_CONTEXT_MESSAGE_LIMIT = 8`、`MIN_CONTEXT_MESSAGE_LIMIT = 2`、`MAX_CONTEXT_MESSAGE_LIMIT = 50`）：前端设置控件、`loadChatContextMessageLimit` 和后端校验读同一份，服务端不信任页面传来的值，越界一律钳制。
- 它**只影响模型看到的对话上下文**，与两件事无关：聊天窗口分页加载固定 16 条一页（`MemoryClient.loadChatHistory`），长期记忆召回固定取融合后 Top 8。

## 每日长期记忆

`DailyMemoryJob` 按用户 IANA 时区读取前一天消息，每批最多 100 条，交给独立的记忆 LLM 提取长期事实，再走同一写入链路。完成日期保存在 `.local/daily-memory-state.json`，避免同一天重复处理。

默认模型是本地 Ollama `qwen3.5:9b`。如果用户把记忆 LLM 改成云端 Provider，前一天的聊天内容会发送给该 Provider；默认配置不会把历史聊天发送到云端。

## 数据

LanceDB 默认位于 `.local/memory.lancedb`，包含：

- `messages`：消息 ID、会话 ID、角色、原文、时间和元数据；
- `memories`：摘要、类型、人物、标签、事件时间、重要度、来源消息、向量和软删除状态。

记忆类型为 `profile`、`preference`、`relationship`、`event`、`plan`、`health`、`other`。删除记忆是软删除；“清空全部记忆”不会删除原始聊天消息。

反方向同样成立：聊天页的“清空全部聊天记录”会**硬删除 `messages` 全表**（不只是当前会话），`memories` 表不受影响。两张表各自独立，没有级联。

## 配置

| 环境变量                 | 默认值                                                       |
| ------------------------ | ------------------------------------------------------------ |
| `SHIRO_PYTHON`           | 优先 `.venv-memory/Scripts/python.exe`，否则 `python`        |
| `SHIRO_MEMORY_PATH`      | `.local/memory.lancedb`                                      |
| `SHIRO_EMBEDDING_MODEL`  | 本地模型存在时使用本地路径，否则 `Qwen/Qwen3-Embedding-0.6B` |
| `SHIRO_EMBEDDING_DIM`    | `1024`                                                       |
| `SHIRO_EMBEDDING_DEVICE` | `auto`                                                       |
| `SHIRO_MEMORY_PORT`      | `5175`                                                       |

已有 LanceDB 表的向量维度必须与 `SHIRO_EMBEDDING_DIM` 一致。

## HTTP API

| 方法     | 路径                             | 用途                                                                     |
| -------- | -------------------------------- | ------------------------------------------------------------------------ |
| `POST`   | `/api/memory/messages`           | 保存聊天原文                                                             |
| `GET`    | `/api/memory/messages`           | 分页读取聊天原文（`conversation_id` / `before` / `before_id` / `limit`） |
| `DELETE` | `/api/memory/messages`           | 删除聊天原文；**不带 `conversation_id` 即清空全表**（带则只删该会话）    |
| `POST`   | `/api/memory/memories`           | 批量新增记忆                                                             |
| `POST`   | `/api/memory/search`             | 完整原句混合检索                                                         |
| `GET`    | `/api/memory/memories`           | 列出有效记忆                                                             |
| `PUT`    | `/api/memory/memories`           | 更新并重新生成向量                                                       |
| `DELETE` | `/api/memory/memories/:id`       | 软删除单条记忆                                                           |
| `DELETE` | `/api/memory/memories`           | 软删除全部记忆                                                           |
| `GET`    | `/api/memory/daily?timezone=...` | 获取前一天待处理消息                                                     |
| `POST`   | `/api/memory/daily/complete`     | 标记日期处理完成                                                         |

Python 服务要求 `X-Shiro-Memory: 1`。该请求头由 Vite 代理注入，前端不应自行直连 5175。

浏览器侧不直接写上面这些路径：聊天窗口读历史、清空历史走 `/api/chat/history`（`GET` / `DELETE`），它把查询串原样转发到 `/api/memory/messages`。**`DELETE` 不带 `conversation_id` 是刻意的**——聊天页的清空按钮语义是“忘记这段对话”，而所有会话都写在同张表里，按 id 删会留下尾巴。

## 开发与验收

首次安装：

```powershell
uv venv --python 3.13 .venv-memory
uv pip install --python .venv-memory\Scripts\python.exe -r memory_service\requirements.txt
```

启动 `npm run dev` 后访问 `http://localhost:5173/pages/memory-test.html`。验收时至少覆盖：

1. 两条措辞相似但事实不同的记忆都能新增；
2. 完整自然语言问题能召回目标记忆；
3. `VRM`、`Unity` 等专有名词能通过文本召回提升排序；
4. 召回结果包含 `source_messages`；
5. 临时测试记忆在验收后删除。

自动检查：

```powershell
.venv-memory\Scripts\python.exe -m unittest memory_service.test_shiro_memory
npm run typecheck
npm test
npm run build
```
