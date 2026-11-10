"""Chat-surface market awareness: the read-only tool, the volatile context block.

The contract these tests defend:
- the calendar reaches the model through per-run volatile context, never the
  static system prompt (prefix caching must stay intact);
- ``market_status`` answers without a broker account and without a session;
- outside hours the model is told to answer from the last completed session.
"""

from __future__ import annotations

import asyncio
import json
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
from agents.tool_context import ToolContext

from app.agent_tools import BROKER_DATA_TOOLS, BrokerAgentContext
from app.agent_tools import broker_tools
from app.agent_harness.model_context import build_status_bar
from app.services import market_calendar as mc
from app.services.broker_chat_runner import BROKER_CHAT_INSTRUCTIONS_TEMPLATE, _broker_chat_instructions

IST = ZoneInfo("Asia/Kolkata")


def ist(year: int, month: int, day: int, hour: int = 11, minute: int = 0) -> datetime:
    return datetime(year, month, day, hour, minute, tzinfo=IST)


@pytest.fixture(autouse=True)
def _clean_calendar_env(monkeypatch):
    monkeypatch.delenv("ANANTA_MARKET_CALENDAR_FILE", raising=False)
    mc.clear_calendar_cache()
    yield
    mc.clear_calendar_cache()


def _run_tool(name: str, arguments: str) -> dict:
    tool = next(tool for tool in BROKER_DATA_TOOLS if tool.name == name)
    context = ToolContext(
        context=BrokerAgentContext(user_id="u1"),
        tool_name=name,
        tool_call_id="call-1",
        tool_arguments=arguments,
    )
    result = asyncio.run(tool.on_invoke_tool(context, arguments))
    return json.loads(result) if isinstance(result, str) else result


# --- the tool ---------------------------------------------------------------


def test_market_status_tool_is_registered():
    names = {tool.name for tool in BROKER_DATA_TOOLS}
    assert "market_status" in names


def test_market_status_tool_reports_the_phase_and_last_session():
    payload = _run_tool("market_status", json.dumps({"exchange": "NSE", "segment": "cash"}))
    assert payload["ok"] is True
    assert payload["phase"] in {
        "continuous", "pre_market", "closed", "holiday", "weekend", "post_close",
        "closing_eligibility_unverified", "special_session_closed",
        "special_session_times_unverified",
    }
    assert "last_completed_session" in payload
    assert "next_open" in payload
    assert payload["calendar_coverage"]
    assert payload["label"]


def test_market_status_tool_needs_no_broker_account():
    """A user with no connected broker can still ask whether the market is open."""
    payload = _run_tool("market_status", json.dumps({}))
    assert payload["ok"] is True
    assert "message" not in payload


def test_market_status_tool_description_mentions_the_last_session_rule():
    tool = next(tool for tool in BROKER_DATA_TOOLS if tool.name == "market_status")
    assert "last completed session" in " ".join(tool.description.lower().split())


# --- volatile context, not the system prompt --------------------------------


def test_calendar_context_is_a_separate_status_line():
    bar = build_status_bar(market_calendar_context=mc.market_session_context(now=ist(2026, 11, 10, 11, 0)))
    assert "Phase holiday" in bar
    assert "Last completed cash session 2026-11-09" in bar
    # The clock line is still there; the calendar rides beside it, not inside it.
    assert "in Asia/Kolkata (IST)" in bar


def test_status_bar_without_calendar_context_is_unchanged():
    bar = build_status_bar(market_calendar_context="")
    assert "phase" not in bar
    assert "last completed session" not in bar


def test_system_prompt_carries_guidance_but_no_clock():
    """Guidance is static; the date and phase must never be baked in here."""
    prompt = _broker_chat_instructions()
    flat = " ".join(prompt.lower().split())
    assert "market hours and holidays" in flat
    assert "most recent completed session" in flat
    # Nothing that changes minute to minute.
    for volatile in ("2026-11-1", "2025-1", "phase continuous", "phase holiday", "diwali"):
        assert volatile not in flat


def test_system_prompt_is_byte_stable_across_calls():
    assert _broker_chat_instructions() == _broker_chat_instructions()


def test_instructions_tell_the_model_not_to_refuse_outside_hours():
    flat = " ".join(BROKER_CHAT_INSTRUCTIONS_TEMPLATE.lower().split())
    assert "do not refuse" in flat
    assert "market is closed" in flat
    assert "most recent completed session's data" in flat
    assert "label those numbers with that session date" in flat


def test_context_block_never_claims_the_market_is_open_on_a_holiday():
    text = mc.market_session_context(now=ist(2026, 11, 10, 11, 0))
    assert "Phase holiday" in text
    assert "Phase continuous" not in text
    assert "Live quotes not expected" in text
