from __future__ import annotations

import json
import math
import os
import re
import sys
import threading
import time
import traceback
import uuid
from collections import Counter
from dataclasses import dataclass
# `datetime.time` is aliased because importing it plain shadows the stdlib `time`
# module imported above: `time.monotonic()` then resolves to the class's attribute
# and takes the whole warm-up down with it.
from datetime import datetime, time as day_time, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import parse_qs, urlparse
from zoneinfo import ZoneInfo

MEMORY_TYPES = {"profile", "preference", "relationship", "event", "plan", "health", "other"}

HEALTH_PATH = "/api/memory/health"
"""The only route answered before the service can serve anything else."""

WARMUP_TEXT = "记忆服务预热"


def log(message: str) -> None:
    """Progress goes to stderr, which lands in the launcher's log next to the
    Node backend's own output — the place someone looks when memory misbehaves."""
    print(f"[memory] {message}", file=sys.stderr, flush=True)


def search_tokens(text: str) -> list[str]:
    tokens: list[str] = []
    for part in re.findall(r"[a-z0-9][a-z0-9_.+#-]*|[\u3400-\u9fff]+", text.casefold()):
        if "\u3400" <= part[0] <= "\u9fff":
            tokens.extend(part[index:index + 2] for index in range(max(1, len(part) - 1)))
        else:
            tokens.append(part)
    return tokens


def bm25_search(query: str, rows: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    query_terms = search_tokens(query)
    documents = [search_tokens(row["embedding_text"]) for row in rows]
    if not query_terms or not documents:
        return []
    average_length = sum(map(len, documents)) / len(documents) or 1
    document_frequency = Counter(term for term in set(query_terms) for doc in documents if term in doc)
    scored = []
    for row, document in zip(rows, documents):
        frequencies = Counter(document)
        score = 0.0
        for term in set(query_terms):
            frequency = frequencies[term]
            if not frequency:
                continue
            inverse_frequency = math.log(1 + (len(documents) - document_frequency[term] + 0.5) / (document_frequency[term] + 0.5))
            score += inverse_frequency * frequency * 2.2 / (frequency + 1.2 * (0.25 + 0.75 * len(document) / average_length))
        if score:
            scored.append(dict(row, _text_score=score))
    return sorted(scored, key=lambda row: row["_text_score"], reverse=True)[:limit]


def utc_now() -> datetime:
    now = datetime.now(timezone.utc)
    return now.replace(microsecond=now.microsecond // 1000 * 1000)


def parse_time(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            raise ValueError("time must include a timezone")
        utc = value.astimezone(timezone.utc)
        return utc.replace(microsecond=utc.microsecond // 1000 * 1000)
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value / 1000, timezone.utc)
    if not isinstance(value, str):
        raise ValueError("time must be ISO-8601, milliseconds, or null")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("time must include a timezone")
    utc = parsed.astimezone(timezone.utc)
    return utc.replace(microsecond=utc.microsecond // 1000 * 1000)


def unique_strings(value: Any, limit: int = 20) -> list[str]:
    if not isinstance(value, list):
        return []
    result: list[str] = []
    for item in value:
        if not isinstance(item, str):
            continue
        item = item.strip()[:80]
        if item and item not in result:
            result.append(item)
    return result[:limit]


def normalize_candidate(value: dict[str, Any]) -> dict[str, Any]:
    memory_type = str(value.get("memory_type", value.get("category", "other"))).strip()
    memory_type = "event" if memory_type == "experience" else memory_type
    if memory_type not in MEMORY_TYPES:
        raise ValueError("invalid memory_type")
    summary = str(value.get("summary", value.get("content", ""))).strip()[:500]
    if not summary:
        raise ValueError("summary is required")
    source_ids = unique_strings(value.get("source_message_ids"), 50)
    if not source_ids:
        raise ValueError("source_message_ids is required")
    importance = float(value.get("importance", 0.5))
    if importance > 1:
        importance /= 5
    return {
        "summary": summary,
        "memory_type": memory_type,
        "people": unique_strings(value.get("people")),
        "keywords": unique_strings(value.get("keywords")),
        "event_time_start": parse_time(value.get("event_time_start")),
        "event_time_end": parse_time(value.get("event_time_end")),
        "importance": max(0.0, min(1.0, importance)),
        "source_message_ids": source_ids,
        "source_conversation_id": str(value.get("source_conversation_id", "companion"))[:120],
    }


@dataclass(frozen=True)
class Config:
    data_path: Path
    model_name: str
    vector_dim: int
    device: str
    port: int

    @classmethod
    def from_env(cls) -> "Config":
        local_model = Path(".local/models/Qwen3-Embedding-0.6B")
        return cls(
            Path(os.getenv("SERVANT_MEMORY_PATH", ".local/memory.lancedb")),
            os.getenv(
                "SERVANT_EMBEDDING_MODEL",
                str(local_model) if local_model.exists() else "Qwen/Qwen3-Embedding-0.6B",
            ),
            int(os.getenv("SERVANT_EMBEDDING_DIM", "1024")),
            os.getenv("SERVANT_EMBEDDING_DEVICE", "auto"),
            int(os.getenv("SERVANT_MEMORY_PORT", "5175")),
        )


class EmbeddingProvider(Protocol):
    def encode(self, texts: list[str], query: bool = False) -> list[list[float]]: ...


class MemoryStore(Protocol):
    def add_messages(self, rows: list[dict[str, Any]]) -> int: ...
    def list_messages(self, conversation_id: str, before: datetime | None, before_id: str, limit: int) -> list[dict[str, Any]]: ...
    def delete_messages(self, conversation_id: str | None) -> None: ...
    def add_memory(self, row: dict[str, Any]) -> None: ...
    def search(self, vector: list[float], memory_types: list[str], limit: int) -> list[dict[str, Any]]: ...
    def text_search(self, query: str, memory_types: list[str], limit: int) -> list[dict[str, Any]]: ...
    def messages_by_ids(self, ids: list[str]) -> list[dict[str, Any]]: ...
    def messages_between(self, start: datetime, end: datetime) -> list[dict[str, Any]]: ...
    def list_memories(self, limit: int = 500) -> list[dict[str, Any]]: ...
    def memory_by_id(self, memory_id: str) -> dict[str, Any] | None: ...
    def update_memory(self, row: dict[str, Any]) -> None: ...
    def soft_delete(self, memory_id: str | None = None) -> None: ...
    def add_activity_log(self, row: dict[str, Any]) -> None: ...
    def list_activity_logs(self, day: str | None, limit: int) -> list[dict[str, Any]]: ...


class EmbeddingService:
    def __init__(self, config: Config):
        self.config = config
        self._model: Any = None
        self._lock = threading.Lock()

    def _load(self) -> Any:
        if self._model is not None:
            return self._model
        with self._lock:
            if self._model is None:
                from sentence_transformers import SentenceTransformer
                device = None if self.config.device == "auto" else self.config.device
                self._model = SentenceTransformer(self.config.model_name, device=device)
        return self._model

    def warmup(self) -> None:
        """Pay the model load before a request has to.

        `SentenceTransformer` costs ~13s cold here, and ~10s of that is importing
        torch, which is only reachable from inside this lazy import. Charged to the
        request path it lands on whichever request happens to arrive first — the
        first chat turn after a launch, whose caller gives up after 2.5s. Warming
        in the background instead moves the cost to startup, where it overlaps
        with the window still loading.
        """
        self.encode([WARMUP_TEXT])

    def encode(self, texts: list[str], query: bool = False) -> list[list[float]]:
        clean = [text.strip() for text in texts]
        if not clean or any(not text for text in clean):
            raise ValueError("embedding text cannot be empty")
        kwargs: dict[str, Any] = {"normalize_embeddings": True, "convert_to_numpy": True}
        if query:
            kwargs["prompt_name"] = "query"
        try:
            vectors = self._load().encode(clean, **kwargs)
        except KeyError:
            kwargs.pop("prompt_name", None)
            vectors = self._load().encode(clean, **kwargs)
        result = [[float(item) for item in vector] for vector in vectors]
        if any(len(vector) != self.config.vector_dim for vector in result):
            raise RuntimeError(
                f"embedding dimension mismatch: expected {self.config.vector_dim}, got {len(result[0])}"
            )
        return result


class LanceStore:
    def __init__(self, config: Config):
        import lancedb
        import pyarrow as pa
        config.data_path.parent.mkdir(parents=True, exist_ok=True)
        self.db = lancedb.connect(config.data_path)
        self.messages = self._table("messages", pa.schema([
            pa.field("id", pa.string(), nullable=False),
            pa.field("conversation_id", pa.string(), nullable=False),
            pa.field("role", pa.string(), nullable=False),
            pa.field("content", pa.string(), nullable=False),
            pa.field("created_at", pa.timestamp("ms", tz="UTC"), nullable=False),
            pa.field("metadata_json", pa.string(), nullable=False),
        ]))
        self.memories = self._table("memories", pa.schema([
            pa.field("id", pa.string(), nullable=False),
            pa.field("user_id", pa.string(), nullable=False),
            pa.field("summary", pa.string(), nullable=False),
            pa.field("memory_type", pa.string(), nullable=False),
            pa.field("people", pa.list_(pa.string()), nullable=False),
            pa.field("keywords", pa.list_(pa.string()), nullable=False),
            pa.field("event_time_start", pa.timestamp("ms", tz="UTC")),
            pa.field("event_time_end", pa.timestamp("ms", tz="UTC")),
            pa.field("importance", pa.float32(), nullable=False),
            pa.field("source_message_ids", pa.list_(pa.string()), nullable=False),
            pa.field("source_conversation_id", pa.string(), nullable=False),
            pa.field("embedding_text", pa.string(), nullable=False),
            pa.field("vector", pa.list_(pa.float32(), config.vector_dim), nullable=False),
            pa.field("created_at", pa.timestamp("ms", tz="UTC"), nullable=False),
            pa.field("updated_at", pa.timestamp("ms", tz="UTC"), nullable=False),
            pa.field("deleted", pa.bool_(), nullable=False),
            pa.field("extractor_version", pa.string(), nullable=False),
        ]))
        self.activity_logs = self._table("activity_logs", pa.schema([
            pa.field("id", pa.string(), nullable=False),
            pa.field("at", pa.timestamp("ms", tz="UTC"), nullable=False),
            pa.field("day", pa.string(), nullable=False),
            pa.field("channel", pa.string(), nullable=False),
            pa.field("status", pa.string(), nullable=False),
            pa.field("message", pa.string(), nullable=False),
            pa.field("turn_id", pa.string(), nullable=False),
            pa.field("details_json", pa.string(), nullable=False),
        ]))
        if self.memories.schema.field("vector").type.list_size != config.vector_dim:
            raise RuntimeError("existing memories table has a different vector dimension")

    def _table(self, name: str, schema: Any) -> Any:
        return self.db.open_table(name) if name in self.db.list_tables().tables else self.db.create_table(name, schema=schema)

    def add_messages(self, rows: list[dict[str, Any]]) -> int:
        valid = []
        for row in rows:
            role, content = row.get("role"), str(row.get("content", "")).strip()
            if role not in {"user", "assistant", "system"} or not content:
                raise ValueError("invalid message")
            message_id = str(row.get("id", ""))
            uuid.UUID(message_id)
            valid.append({
                "id": message_id,
                "conversation_id": str(row.get("conversation_id", "companion"))[:120],
                "role": role,
                "content": content,
                "created_at": parse_time(row.get("created_at")) or utc_now(),
                "metadata_json": json.dumps(row.get("metadata", {}), ensure_ascii=False),
            })
        if valid:
            self.messages.merge_insert("id").when_not_matched_insert_all().execute(valid)
        return len(valid)

    def list_messages(
        self, conversation_id: str, before: datetime | None, before_id: str, limit: int
    ) -> list[dict[str, Any]]:
        # ponytail: local chat volumes are small; add a scalar index when this scan becomes measurable.
        rows = self.messages.search().limit(100_000).to_list()
        rows = [
            row for row in rows
            if row["conversation_id"] == conversation_id
            and (
                before is None
                or row["created_at"] < before
                or (row["created_at"] == before and row["id"] < before_id)
            )
        ]
        rows.sort(key=lambda row: (row["created_at"], row["id"]), reverse=True)
        return rows[:limit]

    def delete_messages(self, conversation_id: str | None) -> None:
        """Deletes one conversation's messages, or the whole table when given None.

        The chat page's "clear chat" button means "forget the conversation", and
        every thread that has ever been written lives in this one table. A
        conversation-scoped delete would leave rows for any other id behind, so
        the unscoped form is what the UI asks for; `delete()` needs a predicate,
        hence the literal `true`.
        """
        if conversation_id is None:
            self.messages.delete("true")
            return
        safe_id = conversation_id.replace("'", "''")
        self.messages.delete(f"conversation_id = '{safe_id}'")

    def add_memory(self, row: dict[str, Any]) -> None:
        self.memories.add([row])

    def search(self, vector: list[float], memory_types: list[str], limit: int) -> list[dict[str, Any]]:
        filters = ["user_id = 'local'", "deleted = false"]
        allowed = [item for item in memory_types if item in MEMORY_TYPES]
        if allowed:
            filters.append("memory_type IN (" + ",".join(f"'{item}'" for item in allowed) + ")")
        return self.memories.search(vector).distance_type("cosine").where(
            " AND ".join(filters), prefilter=True
        ).limit(limit).to_list()

    def text_search(self, query: str, memory_types: list[str], limit: int) -> list[dict[str, Any]]:
        allowed = {item for item in memory_types if item in MEMORY_TYPES}
        rows = self.list_memories(100_000)
        if allowed:
            rows = [row for row in rows if row["memory_type"] in allowed]
        # ponytail: local memory volumes are small; move this to a LanceDB FTS index if scans become measurable.
        return bm25_search(query, rows, limit)

    def messages_by_ids(self, ids: list[str]) -> list[dict[str, Any]]:
        for value in ids:
            uuid.UUID(value)
        if not ids:
            return []
        expression = "id IN (" + ",".join(f"'{value}'" for value in ids) + ")"
        return self.messages.search().where(expression).limit(len(ids)).to_list()

    def messages_between(self, start: datetime, end: datetime) -> list[dict[str, Any]]:
        # ponytail: local desktop volumes are small; add a created_at scalar index and filtered scan if this grows.
        rows = self.messages.search().limit(100_000).to_list()
        return [row for row in rows if start <= row["created_at"] < end]

    def list_memories(self, limit: int = 500) -> list[dict[str, Any]]:
        return self.memories.search().where("user_id = 'local' AND deleted = false").limit(limit).to_list()

    def memory_by_id(self, memory_id: str) -> dict[str, Any] | None:
        uuid.UUID(memory_id)
        rows = self.memories.search().where(
            f"id = '{memory_id}' AND user_id = 'local' AND deleted = false"
        ).limit(1).to_list()
        return rows[0] if rows else None

    def update_memory(self, row: dict[str, Any]) -> None:
        uuid.UUID(row["id"])
        self.memories.merge_insert("id").when_matched_update_all().execute([row])

    def soft_delete(self, memory_id: str | None = None) -> None:
        if memory_id:
            uuid.UUID(memory_id)
            where = f"id = '{memory_id}' AND user_id = 'local'"
        else:
            where = "user_id = 'local' AND deleted = false"
        self.memories.update(where=where, values={"deleted": True, "updated_at": utc_now()})

    def add_activity_log(self, row: dict[str, Any]) -> None:
        self.activity_logs.merge_insert("id").when_not_matched_insert_all().execute([row])

    def list_activity_logs(self, day: str | None, limit: int) -> list[dict[str, Any]]:
        # ponytail: daily local logs are small; add a day index when scans become measurable.
        rows = self.activity_logs.search().limit(100_000).to_list()
        if day:
            rows = [row for row in rows if row["day"] == day]
        rows.sort(key=lambda row: (row["at"], row["id"]), reverse=True)
        return rows[:limit]


class MemoryEngine:
    def __init__(self, store: MemoryStore, embeddings: EmbeddingProvider, state_path: Path):
        self.store, self.embeddings = store, embeddings
        self.state_path = state_path
        self.write_lock = threading.RLock()

    def record_messages(self, payload: dict[str, Any]) -> dict[str, Any]:
        messages = payload.get("messages")
        if not isinstance(messages, list):
            raise ValueError("messages must be an array")
        return {"recorded": self.store.add_messages(messages)}

    def record_activity_log(self, payload: dict[str, Any]) -> dict[str, Any]:
        event = payload.get("event")
        if not isinstance(event, dict):
            raise ValueError("event must be an object")
        event_id = str(event.get("id", ""))
        uuid.UUID(event_id)
        at = parse_time(event.get("at")) or utc_now()
        channel = str(event.get("channel", ""))
        status = str(event.get("status", ""))
        message = str(event.get("message", "")).strip()[:1000]
        if channel not in {"chat", "scheduler", "web-search", "memory", "runtime"}:
            raise ValueError("invalid log channel")
        if status not in {"start", "success", "error", "info"} or not message:
            raise ValueError("invalid log event")
        self.store.add_activity_log({
            "id": event_id,
            "at": at,
            "day": str(event.get("day") or at.date().isoformat())[:10],
            "channel": channel,
            "status": status,
            "message": message,
            "turn_id": str(event.get("turnId", ""))[:120],
            "details_json": json.dumps(event.get("details", {}), ensure_ascii=False, default=str),
        })
        return {"recorded": 1}

    def list_activity_logs(self, query: dict[str, list[str]]) -> dict[str, Any]:
        day = query.get("day", [None])[0]
        if day is not None:
            datetime.strptime(day, "%Y-%m-%d")
        limit = max(1, min(2000, int(query.get("limit", ["500"])[0])))
        events = []
        for row in self.store.list_activity_logs(day, limit):
            events.append({
                "id": row["id"],
                "at": int(row["at"].timestamp() * 1000),
                "day": row["day"],
                "channel": row["channel"],
                "status": row["status"],
                "message": row["message"],
                **({"turnId": row["turn_id"]} if row["turn_id"] else {}),
                "details": json.loads(row["details_json"]),
            })
        return {"events": events}

    def list_messages(self, query: dict[str, list[str]]) -> dict[str, Any]:
        conversation_id = query.get("conversation_id", ["companion"])[0][:120]
        limit = max(1, min(100, int(query.get("limit", ["16"])[0])))
        before_value = query.get("before", [None])[0]
        before = parse_time(before_value) if before_value else None
        before_id = query.get("before_id", [""])[0]
        rows = self.store.list_messages(conversation_id, before, before_id, limit + 1)
        return {
            "messages": self._jsonable(list(reversed(rows[:limit]))),
            "has_more": len(rows) > limit,
        }

    def record_memories(self, payload: dict[str, Any]) -> dict[str, Any]:
        values = payload.get("memories")
        if not isinstance(values, list):
            raise ValueError("memories must be an array")
        candidates = [normalize_candidate(item) for item in values if isinstance(item, dict)]
        texts = [self._embedding_text(item) for item in candidates]
        vectors = self.embeddings.encode(texts) if texts else []
        created = []
        with self.write_lock:
            for item, text, vector in zip(candidates, texts, vectors):
                normalized_summary = " ".join(item["summary"].casefold().split())
                if any(
                    hit["memory_type"] == item["memory_type"]
                    and " ".join(hit["summary"].casefold().split()) == normalized_summary
                    for hit in self.store.list_memories(100_000)
                ):
                    continue
                now = utc_now()
                row = {
                    "id": str(uuid.uuid4()), "user_id": "local", **item,
                    "embedding_text": text, "vector": vector,
                    "created_at": now, "updated_at": now, "deleted": False,
                    "extractor_version": "v1",
                }
                self.store.add_memory(row)
                created.append(self._jsonable(row))
        return {"memories": created}

    def retrieve(self, payload: dict[str, Any]) -> dict[str, Any]:
        query = str(payload.get("query", "")).strip()
        if not query:
            return {"memories": []}
        limit = max(1, min(20, int(payload.get("limit", 5))))
        types = unique_strings(payload.get("memory_types"))
        start, end = parse_time(payload.get("time_start")), parse_time(payload.get("time_end"))
        vector_hits = self.store.search(self.embeddings.encode([query], query=True)[0], types, limit * 4)
        text_hits = self.store.text_search(query, types, limit * 4)
        hits = {hit["id"]: hit for hit in vector_hits}
        hits.update({hit["id"]: {**hits.get(hit["id"], {}), **hit} for hit in text_hits})
        max_text_score = max((float(hit["_text_score"]) for hit in text_hits), default=1.0)
        ranked = []
        for hit in hits.values():
            event_time = hit.get("event_time_start")
            if start and (not event_time or event_time < start):
                continue
            if end and (not event_time or event_time > end):
                continue
            vector = max(0.0, min(1.0, 1 - float(hit.get("_distance", 1))))
            text = float(hit.get("_text_score", 0)) / max_text_score
            score = 0.68 * vector + 0.29 * text + 0.03 * float(hit["importance"])
            if score >= float(payload.get("min_score", 0.2)):
                ranked.append((score, hit))
        sort = payload.get("sort", "relevance")
        if sort in {"latest", "earliest"}:
            ranked.sort(key=lambda item: item[1].get("event_time_start") or item[1]["created_at"], reverse=sort == "latest")
        else:
            ranked.sort(key=lambda item: item[0], reverse=True)
        result = []
        for score, hit in ranked[:limit]:
            sources = self.store.messages_by_ids(hit["source_message_ids"])
            sources.sort(key=lambda item: item["created_at"])
            result.append({**self._jsonable(hit), "score": score, "source_messages": self._jsonable(sources)})
        return {"memories": result}

    def update_memory(self, payload: dict[str, Any]) -> dict[str, Any]:
        memory_id = str(payload.get("id", ""))
        current = self.store.memory_by_id(memory_id)
        if not current:
            raise ValueError("memory not found")
        merged = {
            "memory_type": payload.get("memory_type", current["memory_type"]),
            "summary": payload.get("summary", current["summary"]),
            "people": payload.get("people", current["people"]),
            "keywords": payload.get("keywords", current["keywords"]),
            "event_time_start": payload.get("event_time_start", current["event_time_start"]),
            "event_time_end": payload.get("event_time_end", current["event_time_end"]),
            "importance": payload.get("importance", current["importance"]),
            "source_message_ids": current["source_message_ids"],
            "source_conversation_id": current["source_conversation_id"],
        }
        normalized = normalize_candidate(merged)
        text = self._embedding_text(normalized)
        values = {**normalized, "embedding_text": text, "vector": self.embeddings.encode([text])[0], "updated_at": utc_now()}
        row = {key: value for key, value in current.items() if not key.startswith("_")}
        row.update(values)
        with self.write_lock:
            self.store.update_memory(row)
        return {"memory": self._jsonable({**current, **values})}

    def daily_pending(self, timezone_name: str) -> dict[str, Any]:
        zone = ZoneInfo(timezone_name)
        target = datetime.now(zone).date() - timedelta(days=1)
        completed = self._daily_state().get("last_daily_memory_date") == target.isoformat()
        if completed:
            return {"date": target.isoformat(), "messages": [], "completed": True}
        local_start = datetime.combine(target, day_time.min, zone)
        local_end = local_start + timedelta(days=1)
        rows = self.store.messages_between(local_start.astimezone(timezone.utc), local_end.astimezone(timezone.utc))
        rows.sort(key=lambda row: row["created_at"])
        return {"date": target.isoformat(), "messages": self._jsonable(rows), "completed": False}

    def complete_daily(self, value: Any) -> dict[str, Any]:
        target = datetime.strptime(str(value), "%Y-%m-%d").date().isoformat()
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.state_path.with_suffix(".tmp")
        temporary.write_text(json.dumps({"last_daily_memory_date": target}), encoding="utf-8")
        os.replace(temporary, self.state_path)
        return {"completed": target}

    def _daily_state(self) -> dict[str, Any]:
        try:
            value = json.loads(self.state_path.read_text(encoding="utf-8"))
            return value if isinstance(value, dict) else {}
        except (FileNotFoundError, json.JSONDecodeError):
            return {}

    @staticmethod
    def _embedding_text(item: dict[str, Any]) -> str:
        return "\n".join([
            f"类型: {item['memory_type']}", f"记忆: {item['summary']}",
            f"人物: {', '.join(item['people'])}", f"关键词: {', '.join(item['keywords'])}",
        ])

    @classmethod
    def _jsonable(cls, value: Any) -> Any:
        if isinstance(value, datetime):
            return value.isoformat().replace("+00:00", "Z")
        if isinstance(value, dict):
            return {key: cls._jsonable(item) for key, item in value.items() if not key.startswith("_") and key != "vector"}
        if isinstance(value, list):
            return [cls._jsonable(item) for item in value]
        return value


class Handler(BaseHTTPRequestHandler):
    # Left as None until the background warm-up finishes. Serving before then is
    # deliberate: the port has to answer immediately, otherwise the launcher can
    # only see "connection refused" and has no way to tell a slow start from a
    # broken install.
    engine: MemoryEngine | None = None
    warm: dict[str, Any] = {"status": "warming", "seconds": 0.0, "error": None}
    config: Config

    def do_GET(self) -> None:
        if not self._authorized():
            return
        parsed = urlparse(self.path)
        if parsed.path == HEALTH_PATH:
            self._send(200, self._health())
            return
        engine = self._ready_engine()
        if engine is None:
            return
        if parsed.path == "/api/memory/messages":
            try:
                self._send(200, engine.list_messages(parse_qs(parsed.query)))
            except Exception as error:
                self._send(400, {"error": str(error)})
            return
        if parsed.path == "/api/memory/activity-logs":
            try:
                self._send(200, engine.list_activity_logs(parse_qs(parsed.query)))
            except Exception as error:
                self._send(400, {"error": str(error)})
            return
        if parsed.path == "/api/memory/daily":
            timezone_name = parse_qs(parsed.query).get("timezone", ["UTC"])[0]
            try:
                self._send(200, engine.daily_pending(timezone_name))
            except Exception as error:
                self._send(400, {"error": str(error)})
            return
        if parsed.path != "/api/memory/memories":
            self._send(404, {"error": "not found"})
            return
        rows = [engine._jsonable(row) for row in engine.store.list_memories()]
        rows.sort(key=lambda row: row["created_at"], reverse=True)
        self._send(200, {"memories": rows})

    def do_POST(self) -> None:
        if not self._authorized():
            return
        engine = self._ready_engine()
        if engine is None:
            return
        route = urlparse(self.path).path
        try:
            payload = self._body()
            actions = {
                "/api/memory/messages": engine.record_messages,
                "/api/memory/memories": engine.record_memories,
                "/api/memory/search": engine.retrieve,
                "/api/memory/daily/complete": lambda value: engine.complete_daily(value.get("date")),
                "/api/memory/activity-logs": engine.record_activity_log,
            }
            if route not in actions:
                self._send(404, {"error": "not found"})
                return
            self._send(200, actions[route](payload))
        except Exception as error:
            self._send(400, {"error": str(error)})

    def do_PUT(self) -> None:
        if not self._authorized():
            return
        engine = self._ready_engine()
        if engine is None:
            return
        if urlparse(self.path).path != "/api/memory/memories":
            self._send(404, {"error": "not found"})
            return
        try:
            self._send(200, engine.update_memory(self._body()))
        except Exception as error:
            self._send(400, {"error": str(error)})

    def do_DELETE(self) -> None:
        if not self._authorized():
            return
        engine = self._ready_engine()
        if engine is None:
            return
        parsed = urlparse(self.path)
        route, prefix = parsed.path, "/api/memory/memories/"
        try:
            if route == "/api/memory/messages":
                # No `conversation_id` means every conversation: the chat page's
                # clear button asks for exactly that (see `delete_messages`).
                requested = parse_qs(parsed.query).get("conversation_id", [None])[0]
                engine.store.delete_messages(requested[:120] if requested else None)
                self._send(200, {"ok": True})
                return
            engine.store.soft_delete(route[len(prefix):] if route.startswith(prefix) else None)
            self._send(200, {"ok": True})
        except Exception as error:
            self._send(400, {"error": str(error)})

    def _body(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        if length > 1_000_000:
            raise ValueError("request is too large")
        value = json.loads(self.rfile.read(length) or b"{}")
        if not isinstance(value, dict):
            raise ValueError("JSON object required")
        return value

    def _health(self) -> dict[str, Any]:
        """Readiness for the launcher's poll.

        Always 200: the status field is the answer. A 503 here would be
        indistinguishable from a process that is not listening at all, which is
        the distinction the caller needs in order to wait rather than give up.
        """
        return {
            "status": self.warm["status"],
            "seconds": self.warm["seconds"],
            "error": self.warm["error"],
            "model": self.config.model_name,
            "port": self.config.port,
        }

    def _ready_engine(self) -> MemoryEngine | None:
        """The engine, or a 503 that says whether waiting would help."""
        engine = Handler.engine
        if engine is not None:
            return engine
        state, seconds = self.warm["status"], float(self.warm["seconds"] or 0)
        self._send(503, {
            "error": (
                f"记忆服务预热失败：{self.warm['error']}"
                if state == "failed"
                else f"记忆服务正在预热（{seconds:.1f}s）：正在加载本地嵌入模型，稍后重试即可。"
            ),
            # `warming` is worth waiting for; `failed` never becomes ready.
            "status": state,
            "seconds": seconds,
        })
        return None

    def _authorized(self) -> bool:
        if self.headers.get("X-Servant-Memory") == "1":
            return True
        self._send(403, {"error": "forbidden"})
        return False

    def _send(self, status: int, value: dict[str, Any]) -> None:
        body = json.dumps(value, ensure_ascii=False).encode()
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            # A caller may leave while the local embedding model is warming up.
            # There is no response channel left to recover, so keep the server alive.
            return

    def log_message(self, format: str, *args: Any) -> None:
        return


def warm_up(config: Config) -> None:
    """Build the store and load the embedding model, off the request path."""
    started = time.monotonic()
    try:
        engine = MemoryEngine(
            LanceStore(config),
            EmbeddingService(config),
            config.data_path.parent / "daily-memory-state.json",
        )
        engine.embeddings.warmup()
        Handler.engine = engine
        Handler.warm = {
            "status": "ready",
            "seconds": round(time.monotonic() - started, 2),
            "error": None,
        }
        log(f"ready in {Handler.warm['seconds']}s — {config.model_name}")
    except Exception as error:
        traceback.print_exc()
        Handler.warm = {
            "status": "failed",
            "seconds": round(time.monotonic() - started, 2),
            "error": str(error),
        }
        # A process that can never serve has to exit non-zero: the launcher turns
        # that into "this interpreter is missing which requirements", whereas a
        # live port answering 503 forever would look like an endless warm-up.
        # It has to be `os._exit` because the failure is on a worker thread, and
        # stdio is flushed by hand — it is block-buffered into the log pipe.
        sys.stdout.flush()
        sys.stderr.flush()
        os._exit(1)


def main() -> None:
    config = Config.from_env()
    Handler.config = config
    # Bind before doing any heavy work. Importing lancedb and
    # sentence_transformers costs ~13s here, and while the socket does not exist
    # yet the launcher can only report a refused connection — which reads as
    # "not installed" instead of "still starting".
    server = ThreadingHTTPServer(("127.0.0.1", config.port), Handler)
    log(f"listening on 127.0.0.1:{config.port} (warming in background)")
    threading.Thread(target=warm_up, args=(config,), name="servant-memory-warmup", daemon=True).start()
    server.serve_forever()


if __name__ == "__main__":
    main()
