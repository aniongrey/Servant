import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from memory_service.shiro_memory import Config, LanceStore, MemoryEngine, bm25_search, normalize_candidate


class FakeEmbeddings:
    def encode(self, texts, query=False):
        return [[1.0, 0.0] for _ in texts]


class FakeStore:
    def __init__(self):
        self.memories = []
        self.activity_logs = []
        self.messages = [
            {
                "id": "65e3d270-4f4a-49a0-8399-d985cbf02b83",
                "role": "user",
                "content": "我和小王吃了烧烤",
                "created_at": datetime(2026, 9, 14, tzinfo=timezone.utc),
            }
        ]

    def add_messages(self, rows):
        self.messages.extend(rows)
        return len(rows)

    def list_messages(self, conversation_id, before, before_id, limit):
        rows = [row for row in self.messages if before is None or row["created_at"] < before]
        return sorted(rows, key=lambda row: row["created_at"], reverse=True)[:limit]

    def add_memory(self, row):
        self.memories.append(row)

    def search(self, vector, memory_types, limit):
        return [dict(row, _distance=0.05) for row in self.memories if not row["deleted"]][:limit]

    def text_search(self, query, memory_types, limit):
        return bm25_search(query, [row for row in self.memories if not row["deleted"]], limit)

    def list_memories(self, limit=500):
        return [row for row in self.memories if not row["deleted"]][:limit]

    def messages_by_ids(self, ids):
        return [row for row in self.messages if row["id"] in ids]

    def memory_by_id(self, memory_id):
        return next((row for row in self.memories if row["id"] == memory_id and not row["deleted"]), None)

    def update_memory(self, row):
        self.memory_by_id(row["id"]).update(row)

    def add_activity_log(self, row):
        self.activity_logs.append(row)

    def list_activity_logs(self, day, limit):
        rows = [row for row in self.activity_logs if day is None or row["day"] == day]
        return sorted(rows, key=lambda row: row["at"], reverse=True)[:limit]


class MemoryEngineTest(unittest.TestCase):
    def test_records_and_lists_daily_activity_logs(self):
        store = FakeStore()
        engine = MemoryEngine(store, FakeEmbeddings(), Path("daily.json"))
        engine.record_activity_log({"event": {
            "id": "65e3d270-4f4a-49a0-8399-d985cbf02b84",
            "at": "2026-09-18T12:00:00Z",
            "day": "2026-09-18",
            "channel": "runtime",
            "status": "error",
            "message": "未处理异常",
            "details": {"error": "boom", "replyContext": {"prompt": "你" * 100_001}},
        }})
        events = engine.list_activity_logs({"day": ["2026-09-18"]})["events"]
        self.assertEqual(events[0]["details"]["error"], "boom")
        self.assertEqual(len(events[0]["details"]["replyContext"]["prompt"]), 100_001)

    def test_lists_chat_messages_in_pages_from_oldest_to_newest(self):
        store = FakeStore()
        store.messages = [
            {"id": str(index), "role": "user", "content": str(index), "created_at": datetime(2026, 9, index, tzinfo=timezone.utc)}
            for index in range(1, 21)
        ]
        engine = MemoryEngine(store, FakeEmbeddings(), Path("daily.json"))
        page = engine.list_messages({"limit": ["16"]})
        self.assertEqual([row["content"] for row in page["messages"]], [str(index) for index in range(5, 21)])
        self.assertTrue(page["has_more"])

    def test_records_retrieves_and_traces_a_memory(self):
        with tempfile.TemporaryDirectory() as directory:
            store = FakeStore()
            engine = MemoryEngine(store, FakeEmbeddings(), Path(directory) / "daily.json")
            source_id = store.messages[0]["id"]
            created = engine.record_memories({
                "memories": [{
                    "memory_type": "event",
                    "summary": "用户和小王吃了烧烤。",
                    "people": ["小王"],
                    "keywords": ["烧烤", "吃饭"],
                    "importance": 0.8,
                    "source_message_ids": [source_id],
                    "source_conversation_id": "companion",
                }]
            })
            self.assertEqual(len(created["memories"]), 1)
            similar = engine.record_memories({"memories": [{
                "memory_type": "event",
                "summary": "用户和小王吃了火锅。",
                "source_message_ids": [source_id],
            }]})
            self.assertEqual(len(similar["memories"]), 1)
            self.assertEqual(len(engine.record_memories({"memories": [{
                "memory_type": "event",
                "summary": "用户和小王吃了火锅。",
                "source_message_ids": [source_id],
            }]})["memories"]), 0)
            found = engine.retrieve({
                "query": "和小王吃了什么",
                "memory_types": ["event"],
                "people": ["小王"],
                "keywords": ["吃饭"],
                "sort": "latest",
                "limit": 5,
            })
            self.assertEqual(found["memories"][0]["summary"], "用户和小王吃了烧烤。")
            self.assertEqual(found["memories"][0]["source_messages"][0]["content"], "我和小王吃了烧烤")
            updated = engine.update_memory({"id": created["memories"][0]["id"], "summary": "用户和小王吃了火锅。"})
            self.assertEqual(updated["memory"]["summary"], "用户和小王吃了火锅。")

    def test_bm25_matches_chinese_phrases_and_product_names(self):
        rows = [
            {"embedding_text": "记忆: VRM 模型导入后腿骨映射错误，最终通过 Unity Humanoid 修正", "id": "right"},
            {"embedding_text": "记忆: 用户昨天和小王吃了烧烤", "id": "wrong"},
        ]
        self.assertEqual(bm25_search("模型导入之后腿歪怎么解决", rows, 1)[0]["id"], "right")

    def test_rejects_memory_without_a_real_source(self):
        with self.assertRaisesRegex(ValueError, "source_message_ids"):
            normalize_candidate({"memory_type": "event", "summary": "无来源"})

    def test_real_lancedb_create_update_search_and_delete(self):
        with tempfile.TemporaryDirectory() as directory:
            store = LanceStore(Config(Path(directory) / "db", "fake", 2, "cpu", 5175))
            engine = MemoryEngine(store, FakeEmbeddings(), Path(directory) / "daily.json")
            source_id = "65e3d270-4f4a-49a0-8399-d985cbf02b83"
            store.add_messages([{
                "id": source_id,
                "conversation_id": "companion",
                "role": "user",
                "content": "和小王吃烧烤",
                "created_at": datetime.now(timezone.utc),
            }])
            created = engine.record_memories({"memories": [{
                "memory_type": "event",
                "summary": "和小王吃了烧烤",
                "source_message_ids": [source_id],
            }]})["memories"][0]
            engine.update_memory({"id": created["id"], "summary": "和小王吃了火锅"})
            self.assertEqual(engine.retrieve({"query": "吃了什么"})["memories"][0]["summary"], "和小王吃了火锅")
            store.soft_delete(created["id"])
            self.assertEqual(store.list_memories(), [])

    def test_clearing_chat_history_drops_every_conversation(self):
        with tempfile.TemporaryDirectory() as directory:
            store = LanceStore(Config(Path(directory) / "db", "fake", 2, "cpu", 5175))
            rows = [
                ("11111111-1111-4111-8111-111111111111", "companion"),
                ("22222222-2222-4222-8222-222222222222", "other"),
            ]
            store.add_messages([
                {
                    "id": message_id,
                    "conversation_id": conversation_id,
                    "role": "user",
                    "content": f"hello {conversation_id}",
                    "created_at": datetime.now(timezone.utc),
                }
                for message_id, conversation_id in rows
            ])
            # A scoped delete must stay scoped: the clear button's "all" form is
            # the only thing allowed to touch other conversations.
            store.delete_messages("companion")
            self.assertEqual(
                [row["id"] for row in store.list_messages("other", None, "", 10)], [rows[1][0]]
            )
            store.delete_messages(None)
            self.assertEqual(store.list_messages("other", None, "", 10), [])
            self.assertEqual(store.list_messages("companion", None, "", 10), [])


if __name__ == "__main__":
    unittest.main()
