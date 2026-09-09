"""Optional per-session embeddings for Plan 06 hybrid recall.

Uses a small local model (default all-MiniLM-L6-v2) when
ENABLE_CHAT_EMBEDDINGS=true and sentence-transformers is installed.
Fail-closed: any error returns empty vector hits so FTS still works.
"""

from __future__ import annotations

import logging
import math
import struct
from typing import Any, Callable

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import get_settings

logger = logging.getLogger(__name__)

EMB_TABLE = "broker_chat_event_embeddings"
DEFAULT_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
DEFAULT_DIM = 384
RRF_K = 60

_SCHEMA_READY_BINDS: set[int] = set()
_MODEL = None
_MODEL_ERROR: str | None = None
_EMBED_FN: Callable[[list[str]], list[list[float]]] | None = None


def reset_embeddings_cache_for_tests() -> None:
    global _MODEL, _MODEL_ERROR, _EMBED_FN
    _SCHEMA_READY_BINDS.clear()
    _MODEL = None
    _MODEL_ERROR = None
    _EMBED_FN = None


def set_embed_fn_for_tests(fn: Callable[[list[str]], list[list[float]]] | None) -> None:
    """Inject a deterministic embedder in unit tests."""
    global _EMBED_FN, _MODEL_ERROR
    _EMBED_FN = fn
    _MODEL_ERROR = None if fn is not None else _MODEL_ERROR


def embeddings_enabled() -> bool:
    settings = get_settings()
    return bool(getattr(settings, "enable_chat_embeddings", False))


def embedding_model_id() -> str:
    settings = get_settings()
    return (getattr(settings, "chat_embedding_model", None) or DEFAULT_MODEL).strip() or DEFAULT_MODEL


def ensure_embeddings_schema(db: Session) -> bool:
    if not embeddings_enabled():
        return False
    bind = db.get_bind()
    dialect = getattr(bind.dialect, "name", "")
    if dialect != "sqlite":
        return False
    bind_id = id(bind)
    if bind_id in _SCHEMA_READY_BINDS:
        return True
    try:
        db.execute(
            text(
                f"""
                CREATE TABLE IF NOT EXISTS {EMB_TABLE} (
                    session_id TEXT NOT NULL,
                    run_id TEXT NOT NULL,
                    sequence INTEGER NOT NULL,
                    event_type TEXT NOT NULL,
                    model_id TEXT NOT NULL,
                    dim INTEGER NOT NULL,
                    vector BLOB NOT NULL,
                    PRIMARY KEY (run_id, sequence, model_id)
                )
                """
            )
        )
        db.execute(
            text(
                f"CREATE INDEX IF NOT EXISTS ix_{EMB_TABLE}_session "
                f"ON {EMB_TABLE}(session_id, model_id)"
            )
        )
        db.commit()
        _SCHEMA_READY_BINDS.add(bind_id)
        return True
    except Exception as exc:
        logger.warning("embeddings schema failed: %s", exc)
        try:
            db.rollback()
        except Exception:
            pass
        return False


def _pack(vector: list[float]) -> bytes:
    return struct.pack(f"{len(vector)}f", *[float(x) for x in vector])


def _unpack(blob: bytes, dim: int) -> list[float]:
    if not blob or dim <= 0:
        return []
    count = len(blob) // 4
    values = list(struct.unpack(f"{count}f", blob[: count * 4]))
    if len(values) != dim:
        return values[:dim] if len(values) > dim else values
    return values


def _l2_normalize(vector: list[float]) -> list[float]:
    norm = math.sqrt(sum(v * v for v in vector)) or 1.0
    return [v / norm for v in vector]


def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return -1.0
    return sum(x * y for x, y in zip(a, b))


def _load_model() -> Callable[[list[str]], list[list[float]]] | None:
    global _MODEL, _MODEL_ERROR, _EMBED_FN
    if _EMBED_FN is not None:
        return _EMBED_FN
    if _MODEL_ERROR is not None:
        return None
    if _MODEL is not None:
        return _MODEL
    try:
        from sentence_transformers import SentenceTransformer  # type: ignore

        model_id = embedding_model_id()
        logger.info("loading chat embedding model %s", model_id)
        st_model = SentenceTransformer(model_id)

        def _encode(texts: list[str]) -> list[list[float]]:
            vectors = st_model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
            return [list(map(float, row)) for row in vectors]

        _MODEL = _encode
        return _MODEL
    except Exception as exc:
        _MODEL_ERROR = f"{type(exc).__name__}: {exc}"[:400]
        logger.warning("chat embeddings unavailable: %s", _MODEL_ERROR)
        return None


def embed_texts(texts: list[str]) -> list[list[float]] | None:
    if not embeddings_enabled() or not texts:
        return None
    encode = _load_model()
    if encode is None:
        return None
    try:
        vectors = encode(texts)
        return [_l2_normalize(v) for v in vectors]
    except Exception as exc:
        logger.warning("embed_texts failed: %s", exc)
        return None


def index_embedding(
    db: Session,
    *,
    session_id: str,
    run_id: str,
    sequence: int,
    event_type: str,
    body: str,
) -> bool:
    if not body.strip() or not ensure_embeddings_schema(db):
        return False
    vectors = embed_texts([body[:4_000]])
    if not vectors:
        return False
    vector = vectors[0]
    model_id = embedding_model_id()
    try:
        db.execute(
            text(
                f"DELETE FROM {EMB_TABLE} WHERE run_id = :run_id AND sequence = :sequence AND model_id = :model_id"
            ),
            {"run_id": run_id, "sequence": int(sequence), "model_id": model_id},
        )
        db.execute(
            text(
                f"""
                INSERT INTO {EMB_TABLE}(session_id, run_id, sequence, event_type, model_id, dim, vector)
                VALUES (:session_id, :run_id, :sequence, :event_type, :model_id, :dim, :vector)
                """
            ),
            {
                "session_id": session_id,
                "run_id": run_id,
                "sequence": int(sequence),
                "event_type": event_type,
                "model_id": model_id,
                "dim": len(vector),
                "vector": _pack(vector),
            },
        )
        db.commit()
        return True
    except Exception as exc:
        logger.warning("index_embedding failed: %s", exc)
        try:
            db.rollback()
        except Exception:
            pass
        return False


def search_embeddings(
    db: Session,
    *,
    session_id: str,
    query: str,
    limit: int = 20,
    exclude_run_id: str | None = None,
) -> list[dict[str, Any]]:
    if not embeddings_enabled() or not ensure_embeddings_schema(db):
        return []
    vectors = embed_texts([query])
    if not vectors:
        return []
    query_vec = vectors[0]
    model_id = embedding_model_id()
    try:
        rows = db.execute(
            text(
                f"""
                SELECT run_id, sequence, event_type, dim, vector
                FROM {EMB_TABLE}
                WHERE session_id = :session_id AND model_id = :model_id
                """
            ),
            {"session_id": session_id, "model_id": model_id},
        ).fetchall()
    except Exception as exc:
        logger.warning("embedding search failed: %s", exc)
        return []

    scored: list[dict[str, Any]] = []
    for run_id, sequence, event_type, dim, blob in rows:
        if exclude_run_id and run_id == exclude_run_id:
            continue
        vec = _unpack(bytes(blob), int(dim or DEFAULT_DIM))
        score = _cosine(query_vec, vec)
        scored.append(
            {
                "run_id": run_id,
                "sequence": int(sequence),
                "event_type": event_type,
                "score": float(score),
            }
        )
    scored.sort(key=lambda item: item["score"], reverse=True)
    return scored[: max(1, min(int(limit), 40))]


def rrf_fuse(
    fts_hits: list[dict[str, Any]],
    emb_hits: list[dict[str, Any]],
    *,
    limit: int,
    k: int = RRF_K,
) -> list[dict[str, Any]]:
    """Reciprocal Rank Fusion over (run_id, sequence) keys."""
    scores: dict[tuple[str, int], float] = {}
    meta: dict[tuple[str, int], dict[str, Any]] = {}

    for rank, hit in enumerate(fts_hits, start=1):
        key = (str(hit["run_id"]), int(hit["sequence"]))
        scores[key] = scores.get(key, 0.0) + 1.0 / (k + rank)
        meta[key] = {**meta.get(key, {}), **hit, "fts_rank": rank}

    for rank, hit in enumerate(emb_hits, start=1):
        key = (str(hit["run_id"]), int(hit["sequence"]))
        scores[key] = scores.get(key, 0.0) + 1.0 / (k + rank)
        prev = meta.get(key, {})
        meta[key] = {
            **prev,
            "run_id": hit["run_id"],
            "sequence": hit["sequence"],
            "event_type": hit.get("event_type") or prev.get("event_type"),
            "emb_rank": rank,
            "emb_score": hit.get("score"),
            "snippet": prev.get("snippet"),
            "rank": prev.get("rank"),
        }

    ordered = sorted(scores.items(), key=lambda item: item[1], reverse=True)
    fused: list[dict[str, Any]] = []
    for key, rrf_score in ordered[: max(1, limit)]:
        item = dict(meta[key])
        item["rrf_score"] = rrf_score
        item["sources"] = [
            src
            for src, flag in (
                ("fts", "fts_rank" in item),
                ("embedding", "emb_rank" in item),
            )
            if flag
        ]
        fused.append(item)
    return fused


def embeddings_status() -> dict[str, Any]:
    return {
        "enabled_flag": embeddings_enabled(),
        "model_id": embedding_model_id(),
        "model_loaded": _MODEL is not None or _EMBED_FN is not None,
        "model_error": _MODEL_ERROR,
    }
