from __future__ import annotations

import json

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.agent_harness.builtin_hooks import DeskSpecHook, compact_desk_spec, register_builtin_hooks
from app.agent_harness.hooks import (
    CONTEXT_HOOKS_PREFIX,
    HookContext,
    clear_hooks,
    ensure_builtin_hooks_registered,
    register_hook,
    run_context_hooks,
)
from app.agent_harness.model_context import STATUS_BAR_PREFIX, build_model_input, build_status_bar
from app.services.broker_chat import list_events
from db.models import BrokerChatEvent, BrokerChatRun, BrokerChatSession, User
from db.session import Base


def _db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def _seed_run(db):
    db.add(User(id="user-1", email="u1@example.com"))
    db.add(
        BrokerChatSession(
            id="session-1",
            user_id="user-1",
            title="Desk",
            surface="adaptive_workspace",
        )
    )
    run = BrokerChatRun(
        id="run-1",
        session_id="session-1",
        user_id="user-1",
        status="running",
        provider="openrouter",
        model_id="test",
        message="Show my Reliance desk",
        response_text="",
        event_visibility="full",
        include_tool_outputs=True,
        include_reasoning=True,
        metadata_json="{}",
    )
    db.add(run)
    db.commit()
    return run


def test_compact_desk_spec_extracts_symbols_and_types():
    sketch = compact_desk_spec(
        {
            "title": "Core",
            "components": [
                {
                    "id": "c1",
                    "type": "quote-chart",
                    "title": "RELIANCE",
                    "props": {"symbol": "RELIANCE", "exchange": "NSE"},
                },
                {
                    "id": "c2",
                    "type": "watchlist",
                    "props": {"watchlistId": "wl-1", "symbols": ["TCS", "INFY"]},
                },
            ],
        },
        selected_component_id="c1",
    )
    assert sketch["selected_component_id"] == "c1"
    assert sketch["symbols"][:3] == ["RELIANCE", "TCS", "INFY"]
    assert sketch["watchlist_ids"] == ["wl-1"]
    assert sketch["components"][0]["type"] == "quote-chart"


def test_status_bar_omits_workspace_spec_by_default():
    bar = build_status_bar(
        workspace_spec={"components": [{"id": "x", "type": "quote-ticker"}]},
        selected_component_id="x",
    )
    assert STATUS_BAR_PREFIX in bar
    assert "Today is " in bar
    assert "WorkspaceSpec JSON" not in bar
    assert "Selected canvas component id: x" in bar


def test_desk_spec_hook_renders_and_is_budgeted():
    clear_hooks()
    register_builtin_hooks()
    db = _db()
    run = _seed_run(db)
    huge = {"components": [{"id": f"c{i}", "type": "quote-ticker", "props": {"symbol": f"SYM{i}"}} for i in range(80)]}
    result = run_context_hooks(
        HookContext(
            db=db,
            user_id="user-1",
            session_id="session-1",
            run=run,
            user_message=run.message,
            workspace_spec=huge,
            adaptive_workspace=True,
            sandbox_available=True,
        )
    )
    assert "desk_spec" in result.hook_names
    assert "sandbox_status" in result.hook_names
    assert result.message.startswith(CONTEXT_HOOKS_PREFIX)
    assert "calculator_available: true" in result.message
    assert "Do not recite this snapshot" in result.message
    assert result.total_chars <= 9000


def test_hook_exception_is_skipped_not_fatal():
    clear_hooks()

    class BoomHook:
        id = "boom"
        priority = 1

        def applies(self, ctx):
            return True

        def budget_chars(self):
            return 200

        def render(self, ctx):
            raise RuntimeError("boom")

    register_hook(BoomHook())
    register_hook(DeskSpecHook())
    db = _db()
    run = _seed_run(db)
    result = run_context_hooks(
        HookContext(
            db=db,
            user_id="user-1",
            session_id="session-1",
            run=run,
            user_message="hi",
            workspace_spec={"components": [{"id": "a", "type": "news", "props": {"symbol": "HDFCBANK"}}]},
            adaptive_workspace=True,
        )
    )
    assert any(err["hook_id"] == "boom" for err in result.errors)
    assert "desk_spec" in result.hook_names
    assert "HDFCBANK" in result.message


def test_context_injected_hidden_from_transcript_api():
    from app.agent_harness.evidence import HIDDEN_EVENT_TYPES

    assert "context_injected" in HIDDEN_EVENT_TYPES
    db = _db()
    run = _seed_run(db)
    db.add(
        BrokerChatEvent(
            id="evt-ctx",
            run_id=run.id,
            session_id=run.session_id,
            user_id=run.user_id,
            sequence=1,
            event_type="context_injected",
            public_payload_json=json.dumps({"hook_names": ["desk_spec"]}),
            full_payload_json=json.dumps({"hook_names": ["desk_spec"], "secret": "nope"}),
        )
    )
    db.add(
        BrokerChatEvent(
            id="evt-msg",
            run_id=run.id,
            session_id=run.session_id,
            user_id=run.user_id,
            sequence=2,
            event_type="message_completed",
            public_payload_json=json.dumps({"text": "hello"}),
            full_payload_json=json.dumps({"text": "hello"}),
        )
    )
    db.commit()
    page = list_events(db, run, visibility="full", include_tool_outputs=True)
    assert [event.event_type for event in page.events] == ["message_completed"]


def test_build_model_input_appends_hooks_before_status_bar():
    clear_hooks()
    ensure_builtin_hooks_registered()
    db = _db()
    run = _seed_run(db)
    built = build_model_input(
        db,
        run,
        current_user_text="hello",
        status_bar=f"{STATUS_BAR_PREFIX}\nToday is test.",
        context_hooks_message=f"{CONTEXT_HOOKS_PREFIX}\n## Desk\nok",
    )
    roles = [item["role"] for item in built.messages]
    contents = [item["content"] for item in built.messages]
    assert roles[-3:] == ["user", "user", "user"]
    assert contents[-3] == "hello"
    assert contents[-2].startswith(CONTEXT_HOOKS_PREFIX)
    assert contents[-1].startswith(STATUS_BAR_PREFIX)
