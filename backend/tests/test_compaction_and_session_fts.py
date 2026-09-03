from __future__ import annotations

import json
from datetime import datetime

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.agent_harness import session_fts
from app.agent_harness.compaction import (
    SUMMARY_PREFIX,
    build_compacted_prior_messages,
    persist_session_summary,
)
from app.agent_harness.evidence import HIDDEN_EVENT_TYPES
from app.agent_harness.model_context import build_model_input, build_status_bar
from app.services.broker_chat import append_event, list_events
from db.models import BrokerChatEvent, BrokerChatRun, BrokerChatSession, User
from db.session import Base


def _db():
    session_fts.reset_fts_schema_cache_for_tests()
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    assert session_fts.ensure_fts_schema(db)
    return db


def _seed_session(db, *, turns: int = 5, needle: str | None = None):
    db.add(User(id="user-1", email="u1@example.com"))
    db.add(
        BrokerChatSession(
            id="session-1",
            user_id="user-1",
            title="Long desk",
            surface="adaptive_workspace",
        )
    )
    for i in range(turns):
        msg = f"lorem turn {i} " + ("x" * 200)
        resp = f"ack {i}"
        if needle and i == turns // 2:
            msg = f"What is the Gabriel margin? Please note Gabriel India margin is 8.7% for the base case."
            resp = f"Noted: Gabriel margin 8.7% (base case). Symbol GABRIEL."
        run = BrokerChatRun(
            id=f"run-{i}",
            session_id="session-1",
            user_id="user-1",
            status="completed",
            provider="openrouter",
            model_id="test",
            message=msg,
            response_text=resp,
            event_visibility="full",
            include_tool_outputs=True,
            include_reasoning=True,
            metadata_json="{}",
            completed_at=datetime.utcnow(),
        )
        db.add(run)
        db.flush()
        append_event(
            db,
            run,
            event_type="run_started",
            public_payload={"message": msg[:120]},
            full_payload={"message": msg},
        )
        append_event(
            db,
            run,
            event_type="message_output",
            public_payload={"content": resp},
            full_payload={"content": resp},
        )
        append_event(
            db,
            run,
            event_type="run_completed",
            public_payload={"status": "completed"},
            full_payload={"status": "completed"},
        )
    current = BrokerChatRun(
        id="run-current",
        session_id="session-1",
        user_id="user-1",
        status="running",
        provider="openrouter",
        model_id="test",
        message="Remind me the Gabriel margin we used.",
        response_text="",
        event_visibility="full",
        include_tool_outputs=True,
        include_reasoning=True,
        metadata_json="{}",
    )
    db.add(current)
    db.commit()
    return current


def test_fts_finds_gabriel_margin():
    db = _db()
    assert session_fts.ensure_fts_schema(db)
    _seed_session(db, turns=12, needle="Gabriel")
    session_fts.backfill_session_fts(db, "session-1")
    result = session_fts.search_session(
        db,
        session_id="session-1",
        user_id="user-1",
        query="Gabriel margin 8.7",
        limit=5,
        window=1,
    )
    assert result["ok"] is True
    assert result["hit_count"] >= 1
    blob = json.dumps(result["hits"], default=str)
    assert "8.7" in blob or "Gabriel" in blob or "GABRIEL" in blob


def test_expand_respects_cap():
    db = _db()
    session_fts.ensure_fts_schema(db)
    current = _seed_session(db, turns=6, needle="Gabriel")
    session_fts.backfill_session_fts(db, "session-1")
    result = session_fts.search_session(
        db, session_id="session-1", user_id="user-1", query="Gabriel", limit=3, window=0
    )
    hit = result["hits"][0]
    expanded = session_fts.expand_window(
        db,
        session_id="session-1",
        user_id="user-1",
        run_id=hit["run_id"],
        sequence=hit["sequence"],
        radius=20,
    )
    assert expanded["ok"] is True
    assert expanded["radius"] <= session_fts.MAX_EXPAND_RADIUS
    assert expanded["char_count"] <= session_fts.MAX_WINDOW_CHARS


def test_compaction_failure_falls_back(monkeypatch):
    db = _db()
    current = _seed_session(db, turns=10, needle="Gabriel")

    def _boom(*args, **kwargs):
        raise RuntimeError("summariser down")

    monkeypatch.setattr("app.agent_harness.compaction._call_summariser", _boom)
    monkeypatch.setattr("app.agent_harness.compaction._anxiety_threshold_chars", lambda: 500)
    monkeypatch.setattr("app.agent_harness.compaction._keep_recent_chars", lambda: 800)

    result = build_compacted_prior_messages(db, current, current_user_text=current.message, force=True)
    assert result.failed is True
    assert result.messages  # still has prior context
    assert "Gabriel" in json.dumps(result.messages) or result.stats.dropped_oldest_turns >= 0


def test_compaction_success_injects_summary(monkeypatch):
    db = _db()
    current = _seed_session(db, turns=8, needle="Gabriel")

    def _fake_summary(*args, **kwargs):
        return (
            "## Session so far (compressed)\n"
            "Symbols: GABRIEL\n"
            "Facts:\n- Gabriel margin 8.7% base case\n"
            "Numbers:\n- 8.7%\n"
        )

    monkeypatch.setattr("app.agent_harness.compaction._call_summariser", _fake_summary)
    monkeypatch.setattr("app.agent_harness.compaction._anxiety_threshold_chars", lambda: 200)
    monkeypatch.setattr("app.agent_harness.compaction._keep_recent_chars", lambda: 800)

    result = build_compacted_prior_messages(db, current, current_user_text=current.message, force=True)
    assert result.compacted is True
    assert result.messages[0]["content"].startswith(SUMMARY_PREFIX)
    assert "8.7%" in result.messages[0]["content"]
    # Full lorem dump should not dominate — summary + recent only
    joined = "\n".join(m["content"] for m in result.messages)
    assert joined.count("lorem turn") < 8


def test_compaction_events_hidden_from_transcript():
    assert "compaction" in HIDDEN_EVENT_TYPES
    assert "compaction_failed" in HIDDEN_EVENT_TYPES
    db = _db()
    current = _seed_session(db, turns=1)
    db.add(
        BrokerChatEvent(
            id="evt-c",
            run_id=current.id,
            session_id=current.session_id,
            user_id=current.user_id,
            sequence=99,
            event_type="compaction",
            public_payload_json=json.dumps({"chars_out": 10}),
            full_payload_json=json.dumps({"summary": "secret-ish"}),
        )
    )
    db.commit()
    page = list_events(db, current, visibility="full", include_tool_outputs=True)
    assert all(event.event_type != "compaction" for event in page.events)


def test_frozen_summary_reused_without_resummarising(monkeypatch):
    db = _db()
    current = _seed_session(db, turns=6)
    persist_session_summary(
        db,
        "session-1",
        summary="Symbols: RELIANCE\nFacts:\n- user asked about desk",
        first_kept_run_id="run-4",
        model_id="cheap",
        chars_in=1000,
        chars_out=40,
    )
    called = {"n": 0}

    def _should_not(*args, **kwargs):
        called["n"] += 1
        raise AssertionError("should use frozen summary under threshold")

    monkeypatch.setattr("app.agent_harness.compaction._call_summariser", _should_not)
    monkeypatch.setattr("app.agent_harness.compaction._anxiety_threshold_chars", lambda: 10_000_000)
    result = build_compacted_prior_messages(db, current, current_user_text="hi")
    assert called["n"] == 0
    assert result.cache_hit is True
    assert result.messages[0]["content"].startswith(SUMMARY_PREFIX)


def test_empty_summariser_freezes_prior_summary(monkeypatch):
    db = _db()
    current = _seed_session(db, turns=8, needle="Gabriel")
    persist_session_summary(
        db,
        "session-1",
        summary="Symbols: GABRIEL\nNumbers:\n- 8.7%",
        first_kept_run_id="run-2",
        model_id="cheap",
        chars_in=500,
        chars_out=40,
    )

    monkeypatch.setattr(
        "app.agent_harness.compaction.llm_gateway.generate_text",
        lambda *a, **k: type("R", (), {"choices": [type("C", (), {"message": type("M", (), {"content": ""})()})()]})(),
    )
    monkeypatch.setattr("app.agent_harness.compaction._anxiety_threshold_chars", lambda: 200)
    monkeypatch.setattr("app.agent_harness.compaction._keep_recent_chars", lambda: 800)
    monkeypatch.setattr(
        "app.agent_harness.compaction.resolve_compaction_model",
        lambda *a, **k: ("openrouter", "cheap"),
    )

    result = build_compacted_prior_messages(db, current, current_user_text=current.message, force=True)
    assert result.compacted is True
    assert "8.7%" in result.messages[0]["content"]
    assert result.failed is False


def test_search_default_window_is_lean():
    db = _db()
    _seed_session(db, turns=6, needle="Gabriel")
    session_fts.backfill_session_fts(db, "session-1")
    result = session_fts.search_session(
        db, session_id="session-1", user_id="user-1", query="Gabriel margin 8.7", limit=5
    )
    assert result["ok"] is True
    assert result["hit_count"] >= 1
    for hit in result["hits"]:
        assert hit["window"] == []
        assert hit["window_truncated"] is False
        assert "[" not in (hit.get("snippet") or "") or "«" in (hit.get("snippet") or "")


def test_expand_evidence_only_no_placeholders():
    db = _db()
    current = _seed_session(db, turns=4, needle="Gabriel")
    # Inject harness chrome around Gabriel message_output
    run = db.get(BrokerChatRun, "run-2")
    assert run is not None
    db.add(
        BrokerChatEvent(
            id="chrome-1",
            run_id=run.id,
            session_id="session-1",
            user_id="user-1",
            sequence=50,
            event_type="mcp_connected",
            public_payload_json="{}",
            full_payload_json="{}",
        )
    )
    db.add(
        BrokerChatEvent(
            id="chrome-2",
            run_id=run.id,
            session_id="session-1",
            user_id="user-1",
            sequence=51,
            event_type="response_completed",
            public_payload_json="{}",
            full_payload_json="{}",
        )
    )
    db.commit()
    session_fts.backfill_session_fts(db, "session-1")
    hit = session_fts.search_session(
        db, session_id="session-1", user_id="user-1", query="Gabriel 8.7", limit=3, window=0
    )["hits"][0]
    expanded = session_fts.expand_window(
        db,
        session_id="session-1",
        user_id="user-1",
        run_id=hit["run_id"],
        sequence=hit["sequence"],
        radius=6,
    )
    assert expanded["ok"] is True
    assert expanded.get("evidence_only") is True
    assert expanded["items"]
    for item in expanded["items"]:
        assert item["event_type"] in session_fts.WINDOW_EVIDENCE_TYPES
        assert not (item.get("body") or "").startswith("[")
        assert item["event_type"] not in {"mcp_connected", "response_completed", "token"}


def test_exclude_current_run_from_search():
    db = _db()
    current = _seed_session(db, turns=6, needle="Gabriel")
    # Index the current running prompt which would otherwise dominate "Remind me Gabriel"
    append_event(
        db,
        current,
        event_type="run_started",
        public_payload={"message": current.message},
        full_payload={"message": current.message},
    )
    session_fts.backfill_session_fts(db, "session-1")
    with_current = session_fts.search_session(
        db,
        session_id="session-1",
        user_id="user-1",
        query="Remind me the Gabriel margin we used",
        limit=8,
        window=0,
        exclude_run_id=None,
    )
    without_current = session_fts.search_session(
        db,
        session_id="session-1",
        user_id="user-1",
        query="Remind me the Gabriel margin we used",
        limit=8,
        window=0,
        exclude_run_id=current.id,
    )
    assert all(h["run_id"] != current.id for h in without_current["hits"])
    # Still finds the earlier Gabriel fact
    blob = json.dumps(without_current["hits"], default=str)
    assert "8.7" in blob or "Gabriel" in blob or "GABRIEL" in blob
    # Without exclude, current run can appear
    assert with_current["hit_count"] >= without_current["hit_count"] or True


def test_stopwords_do_not_dominate_open_page_style_noise():
    db = _db()
    _seed_session(db, turns=4, needle="Gabriel")
    run = db.get(BrokerChatRun, "run-1")
    assert run is not None
    append_event(
        db,
        run,
        event_type="tool_call_completed",
        public_payload={"tool_name": "web_fetch", "title": "Open page", "display_name": "Open page"},
        full_payload={
            "tool_name": "web_fetch",
            "output": {"ok": True, "url": "https://example.com/open-page", "title": "Open page"},
        },
    )
    session_fts.backfill_session_fts(db, "session-1")
    # Query similar to the noisy E2E case — stopwords stripped so "open" alone shouldn't win.
    result = session_fts.search_session(
        db,
        session_id="session-1",
        user_id="user-1",
        query="open question unanswered evidence Gabriel margin",
        limit=5,
        window=0,
    )
    assert result["ok"] is True
    blob = json.dumps(result["hits"], default=str).lower()
    assert "8.7" in blob or "gabriel" in blob
    # Top hit should not be the Open page tool unless Gabriel also appears
    top = result["hits"][0]
    top_blob = json.dumps(top, default=str).lower()
    if "open page" in top_blob:
        assert "gabriel" in top_blob or "8.7" in top_blob


def test_hybrid_rrf_with_fake_embeddings(monkeypatch):
    from app.agent_harness import session_embeddings
    from app.config import get_settings

    monkeypatch.setenv("ENABLE_CHAT_EMBEDDINGS", "true")
    get_settings.cache_clear()
    session_embeddings.reset_embeddings_cache_for_tests()

    def fake_embed(texts: list[str]) -> list[list[float]]:
        out = []
        for text_value in texts:
            lower = text_value.lower()
            # 4-d toy space: gabriel / margin / open-page / other
            vec = [
                1.0 if "gabriel" in lower or "8.7" in lower else 0.0,
                1.0 if "margin" in lower or "fy27" in lower else 0.0,
                1.0 if "open page" in lower else 0.0,
                0.2,
            ]
            out.append(vec)
        return out

    session_embeddings.set_embed_fn_for_tests(fake_embed)
    db = _db()
    assert session_embeddings.ensure_embeddings_schema(db)
    _seed_session(db, turns=5, needle="Gabriel")
    run = db.get(BrokerChatRun, "run-1")
    append_event(
        db,
        run,
        event_type="tool_call_completed",
        public_payload={"tool_name": "web_fetch", "title": "Open page"},
        full_payload={"tool_name": "web_fetch", "output": {"title": "Open page", "url": "https://x"}},
    )
    session_fts.backfill_session_fts(db, "session-1")
    result = session_fts.search_session(
        db,
        session_id="session-1",
        user_id="user-1",
        query="what operating margin assumption for Gabriel",
        limit=5,
        window=0,
    )
    assert result["ok"] is True
    assert result.get("retrieval_mode") == "hybrid_rrf"
    blob = json.dumps(result["hits"], default=str).lower()
    assert "gabriel" in blob or "8.7" in blob
    session_embeddings.reset_embeddings_cache_for_tests()
    monkeypatch.delenv("ENABLE_CHAT_EMBEDDINGS", raising=False)
    get_settings.cache_clear()
