import json

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.agent_harness.model_context import (
    FETCH_SOURCE_LABEL,
    STATUS_BAR_PREFIX,
    TRUNCATION_SUFFIX,
    build_model_input,
    build_status_bar,
    freeze_truncate,
    frozen_system_cache_breakers,
    project_generic,
    project_web_fetch,
    stable_json,
    tool_usage_line,
)
from app.services.broker_chat import (
    _event_payload_for_visibility,
    conversation_history_for_run,
    list_events,
)
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


def test_freeze_truncate_is_byte_stable():
    text = "abcdefghij" * 400
    first, hit = freeze_truncate(text, 1200)
    second, hit_again = freeze_truncate(text, 1200)
    assert hit and hit_again
    assert first == second
    assert first.endswith(TRUNCATION_SUFFIX)
    assert TRUNCATION_SUFFIX not in freeze_truncate("short", 1200)[0]


def test_web_fetch_model_view_caps_html_stays_on_audit():
    full_text = "Revenue 1,234 " + ("x" * 20_000)
    full_payload = {
        "tool_name": "web_fetch",
        "output": {
            "ok": True,
            "title": "Screener",
            "url": "https://www.screener.in/company/RELIANCE/",
            "status_code": 200,
            "text": full_text,
            "html": "<html>" + ("<p>secret-ish</p>" * 200),
        },
    }
    projection = project_web_fetch(full_payload, 1200, "evt-fetch-1")
    encoded = stable_json(projection.payload)

    assert projection.truncated
    assert projection.retrieval_key == "evt-fetch-1"
    assert projection.payload["source"] == FETCH_SOURCE_LABEL
    assert projection.payload["title"] == "Screener"
    assert "html" not in projection.payload
    assert len(projection.payload["text"]) < len(full_text)
    assert "Revenue 1,234" in projection.payload["text"]
    assert len(full_payload["output"]["text"]) == len(full_text)
    assert stable_json(project_web_fetch(full_payload, 1200, "evt-fetch-1").payload) == encoded


def test_model_items_redact_secrets():
    projection = project_generic(
        {
            "tool_name": "custom_mcp",
            "output": {"title": "ok", "api_key": "sk-live-should-not-leak", "access_token": "tok"},
        },
        800,
        "evt-secret",
    )
    blob = stable_json(projection.payload)
    assert "sk-live-should-not-leak" not in blob
    assert "[redacted]" in blob


def test_frozen_system_prompt_has_no_clock_or_spec():
    import inspect

    from app.services.broker_chat_runner import _broker_chat_instructions

    kwargs = {"adaptive_workspace": True}
    if "sandbox_available" in inspect.signature(_broker_chat_instructions).parameters:
        kwargs["sandbox_available"] = True
    instructions = _broker_chat_instructions(**kwargs)
    assert frozen_system_cache_breakers(instructions) == []
    assert "Today is " not in instructions
    assert "WorkspaceSpec JSON" not in instructions
    assert "Never invent prices" in instructions
    status = build_status_bar(
        mcp_context="Connected MCP tool names: get_news",
        workspace_spec={"components": [{"id": "w1", "type": "watchlist"}]},
        selected_component_id="w1",
        tools_line="tools: web_search 2, sandbox_run_python 1",
    )
    assert status.startswith(STATUS_BAR_PREFIX)
    assert "Today is " in status
    assert "watchlist" in status
    assert "get_news" in status
    assert "tools: web_search 2, sandbox_run_python 1" in status


def _seed_fetch_session(db):
    db.add(User(id="user-1", display_name="Owner"))
    db.add(BrokerChatSession(id="session-1", user_id="user-1", title="Desk", surface="adaptive_workspace"))
    prior = BrokerChatRun(
        id="run-prior",
        session_id="session-1",
        user_id="user-1",
        status="completed",
        provider="openai",
        model_id="gpt-4o-mini",
        message="Fetch Reliance screener",
        response_text="Revenue is 1,234.",
        event_visibility="full",
        include_tool_outputs=True,
    )
    current = BrokerChatRun(
        id="run-current",
        session_id="session-1",
        user_id="user-1",
        status="running",
        provider="openai",
        model_id="gpt-4o-mini",
        message="What was the revenue?",
        event_visibility="full",
        include_tool_outputs=True,
    )
    db.add_all([prior, current])
    db.add(
        BrokerChatEvent(
            id="evt-fetch-1",
            run_id="run-prior",
            session_id="session-1",
            user_id="user-1",
            sequence=1,
            event_type="tool_call_completed",
            public_payload_json=json.dumps({"tool_name": "web_fetch", "display_name": "Open page"}),
            full_payload_json=json.dumps(
                {
                    "tool_name": "web_fetch",
                    "output": {
                        "ok": True,
                        "title": "Screener",
                        "url": "https://www.screener.in/company/RELIANCE/",
                        "status_code": 200,
                        "text": "Revenue 1,234 " + ("body " * 8000),
                        "html": "<html>full</html>",
                    },
                }
            ),
        )
    )
    db.add(
        BrokerChatEvent(
            id="evt-debug",
            run_id="run-current",
            session_id="session-1",
            user_id="user-1",
            sequence=1,
            event_type="model_context_built",
            public_payload_json=json.dumps({"caps_hit": 1}),
            full_payload_json=json.dumps({"caps_hit": 1, "cache_breakers": []}),
        )
    )
    db.commit()
    return current, prior


def test_prior_turn_web_fetch_uses_projection_not_full_dump():
    db = _db()
    current, prior = _seed_fetch_session(db)
    history = conversation_history_for_run(db, current)
    blob = "\n".join(item["content"] for item in history)

    assert history[0] == {"role": "user", "content": "Fetch Reliance screener"}
    assert history[1]["role"] == "assistant"
    assert "Screener" in blob
    assert "evt-fetch-1" in blob
    assert '"truncated":true' in blob.replace(" ", "")
    assert "<html>full</html>" not in blob

    page = list_events(db, current, visibility="full", include_tool_outputs=True)
    assert all(event.event_type != "model_context_built" for event in page.events)

    fetch_event = db.get(BrokerChatEvent, "evt-fetch-1")
    visible = _event_payload_for_visibility(
        fetch_event,
        visibility="full",
        include_tool_outputs=True,
        include_reasoning=False,
    )
    assert "html" in visible["output"]
    assert len(visible["output"]["text"]) > 10_000


def test_build_model_input_puts_user_and_status_at_end():
    db = _db()
    current, _prior = _seed_fetch_session(db)
    status = build_status_bar(mcp_context="get_news")
    built = build_model_input(
        db,
        current,
        current_user_text=current.message,
        status_bar=status,
        instructions="You are Ananta.",
    )
    assert built.messages[-1]["content"] == status
    assert built.messages[-2]["content"] == "What was the revenue?"
    assert built.cache_breakers == []
    assert built.caps_hit >= 1
    assert built.prior_turns == 1


def test_tool_usage_line_counts_completed_tools_from_audit():
    events = [
        {
            "event_type": "tool_call_completed",
            "payload": {"tool_name": "web_search"},
        },
        {
            "event_type": "tool_call_completed",
            "payload": {"tool_name": "web_search"},
        },
        {
            "event_type": "tool_call_completed",
            "payload": {"tool_name": "web_fetch"},
        },
        {
            "event_type": "tool_call_completed",
            "payload": {"tool_name": "get_daily_summary"},
        },
        {
            "event_type": "response_delta",
            "payload": {"tool_name": "web_search"},
        },
    ]
    line = tool_usage_line(events)
    assert line == "tools: web_search 2, web_fetch 1, mcp 1"
    assert tool_usage_line([]) == ""
