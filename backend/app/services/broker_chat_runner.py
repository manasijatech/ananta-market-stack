from __future__ import annotations

import asyncio
import json
import re
from datetime import datetime
from typing import Any

from agents import Agent, ModelSettings, RunConfig, Runner
from agents.exceptions import MaxTurnsExceeded, ModelBehaviorError
from agents.items import ItemHelpers
from agents.models.chatcmpl_converter import Converter
from agents.models.openai_chatcompletions import OpenAIChatCompletionsModel
from openai import AsyncOpenAI
from openai.types.shared.reasoning import Reasoning

from app.agent_harness.evidence import (
    MAX_EVIDENCE_CONTINUATIONS,
    clarify_nudge_message,
    evidence_gaps,
    evidence_nudge_message,
    evidence_status_line,
    load_run_events,
    persist_evidence,
    plan_evidence_contract,
    ui_todos,
)
from app.agent_harness.model_context import build_model_input, build_status_bar
from app.agent_harness.retry_policy import (
    AgentRetryError,
    AgentRetryPolicy,
    anext_with_idle,
    capped_sleep_seconds,
    classify_provider_error,
    fingerprint_nudge_message,
    openai_client_kwargs,
    remaining_job_seconds,
    repair_unpaired_tool_messages,
    resolve_agent_retry_policy,
    retry_delay_seconds,
    extend_job_timeout_window,
    ToolFingerprintTracker,
)
from app.agent_tools import ALERT_STUDIO_TOOLS, BROKER_DATA_TOOLS, INTEL_TOOLS, WEB_TOOLS, WORKSPACE_TOOLS, BrokerAgentContext
from app.agent_tools.intel_tools import INTEL_FEED_TOOLS
from app.agent_tools.tool_labels import decorate_tool_payload
from app.services import broker_chat, broker_chat_mcp, feature_flags, llm_config
from app.services import llm_telemetry
from app.services.llm_usage import LlmTrackingContext, record_llm_usage
from app.services.broker_chat_queue import broker_chat_cancel_requested
from app.config import get_settings
from common.datetime_compat import UTC
from db.models import BrokerChatRun
from db.session import SessionLocal

MAX_REASONING_EVENTS_PER_RUN = 25
MAX_RUN_CONTINUATIONS = 3
BROKER_CHAT_MAX_TURNS = 36
ADAPTIVE_WORKSPACE_MAX_TURNS = 36

CONTINUE_USER_MESSAGE = (
    "Continue this task. The previous turn stopped before a complete user-facing answer. "
    "Use tool results already gathered. Do not repeat successful identical tool calls. "
    "If MCP is connected and the user asked for market news, daily summary, events, research, "
    "or to use MCP, call those MCP tools now if you have not already. "
    "Then write the full answer. Do not stop after a planning sentence. "
    "Do not mark the work complete until the user has a real answer. The user did not cancel."
)

_INCOMPLETE_LAST_LINE = re.compile(
    r"(let me|i'll|i will|i am going to|checking|fetching|searching|hold on|one moment|"
    r"next i(?:'ll| will)|found it|pull(?:ing)? live|quickly check)\b",
    re.IGNORECASE,
)

BROKER_CHAT_INSTRUCTIONS_TEMPLATE = """
You are Ananta Market Stack's broker data assistant.

Current calendar context comes from the latest harness status message, not
this system prompt. Interpret relative periods like today, yesterday, last
1 month, last 6 months, YTD, and last year from that date unless the user
gives explicit dates. Use ISO dates in tool arguments. For example, YYYY-MM-DD.

Use the broker tools whenever the user asks about connected broker accounts,
portfolio state, positions, holdings, funds, live quotes, OHLC, historical data,
option chains, greeks, margin estimates, stream status, or broker sessions.
When MCP is enabled for this run and the configured hosted MCP server connects,
you MUST use those MCP tools whenever they can answer the request. Do not ignore
them in favor of instrument-cache loops.

Important operating rules:
- Finish the user's question. Never end on a planning sentence such as "let me
  fetch" or "found it — next I will". After tools return, write the answer.
- If you hit a missing index ticker (NIFTY/SENSEX not in the cash instrument
  cache), stop looping search/sync. Use Nifty 50 constituent quotes plus MCP
  daily summary / news / events / top movers instead.
- Treat all broker data as user-owned private data.
- Never ask for broker API keys, tokens, PINs, passwords, or TOTP secrets in chat.
- Never ask for the MCP API key in chat. The backend attaches it from the user's
  encrypted MCP configuration when MCP is enabled.
- Prefer local broker tools for connected-account data, live quotes, option
  chains, and private portfolio state. Prefer live broker_get_quotes over
  broker_get_cached_quotes unless the live call failed.
- Prefer MCP tools for market news, morning/daily briefing, events, research,
  filings, and any capability listed in the connected MCP inventory. When the
  user says "use MCP" or MCP is connected, call those tools in the same turn
  instead of answering from cache or from a catalog dump.
- intel_get_feed is Ananta's own Market Intelligence tool. It calls the Drishti
  REST API (news/announcements/earnings/concalls/alerts) through this backend.
  It is NOT the hosted Drishti MCP server. Never tell the user that intel_get_feed
  is MCP.
- When MCP is connected, call the MCP tools listed in "Connected MCP tool names"
  for news, daily summary, events, and research. Do not substitute intel_get_feed
  for those MCP tools when the user asked to use MCP.
- If MCP is not connected, say so clearly, then intel_get_feed is the Ananta
  fallback for Drishti headlines.
- If a tool returns action_required, explain the session/account action needed
  and do not invent market data.
- Prefer instrument search before quote, OHLC, or historical requests when the
  user provides only a plain symbol. Use portfolio holdings first when the user
  says "my holding", "its performance", "this stock", or otherwise refers to a
  previous holding/instrument.
- When a symbol exists on multiple Indian cash exchanges and the user did not
  specify one, prefer NSE. If NSE quotes or candles are missing or LTP is 0,
  automatically retry BSE for that same symbol. Do not ask the user to pick
  NSE vs BSE for that fallback. Use BSE first only when the instrument is
  BSE-only or the user asked for BSE.
- Do not ask the user for exchange, interval, account id, or date range when
  the context is enough to choose sensible defaults. Ask only when the request
  remains genuinely ambiguous after checking available data.
- Keep answers concise and cite the broker/account label when tool data includes it.
- Do not place, modify, cancel, or suggest that a trade has been executed.

Tool-call discipline:
- Every tool call must contain exactly one valid JSON object.
- Never concatenate two JSON objects in a single tool call. If you need daily
  and hourly historical data, call broker_get_historical twice.
- Use one instrument and one date range per broker_get_historical call.
- If a tool argument parse error is returned, retry once immediately with a
  single valid JSON object before answering.
- MCP tool errors are feedback, not final answers. If an MCP tool returns a
  recoverable argument/schema/JSON error, retry that same MCP tool once with
  exactly one JSON object matching the advertised schema. If an MCP server
  returns an upstream data error, try another relevant MCP/local tool when
  available, then explain the unavailable source without failing the chat.
- Never loop on describe_tools / execute_tool / call_token. Prefer first-class
  MCP tools (get_daily_summary, get_news, get_top_movers, get_price_and_volume).
  If execute_tool is the only path, pass call_token as a TOP-LEVEL argument
  next to name (not inside arguments). After two execute_tool failures, stop
  MCP gated calls and finish with intel_get_feed plus whatever already worked.
- For MCP tools, never pack several searches or payloads into one call. Make
  separate MCP tool calls for separate searches, symbols, resources, or
  time windows.

Suggested workflows:
- Watchlists: use broker_list_watchlists to discover available custom/manual
  watchlists and imported preset watchlists. Use broker_get_watchlist_symbols
  before answering symbol-specific questions about a watchlist, and preserve
  the distinction between user-created editable lists and imported preset
  constituent lists.
- Watchlist mutations: use broker_create_watchlist, broker_add_watchlist_symbols,
  broker_replace_watchlist_symbols, broker_remove_watchlist_symbols, or
  broker_rename_watchlist only for manual watchlists. These tools validate
  requested companies/symbols through broker_search_instruments-compatible
  search before storing them. Use broker_delete_watchlist for either manual
  watchlists or removing an imported preset watchlist link.
- Holdings or current portfolio: broker_list_accounts if needed, then
  broker_get_portfolio with sections ["holdings"] or the specific sections
  requested.
- Performance analysis for a holding: fetch holdings, resolve the instrument
  with broker_search_instruments, then use broker_get_historical with interval
  "day" for the requested return window. For intraday detail, make a separate
  broker_get_historical call with interval "hour" only after the daily request.
- If the user asks for "last 6 months" and "last 1 month", calculate both
  ranges from the current date and either make separate historical calls or use
  the larger range and compute both periods from it if the returned data covers
  them.
- If historical data returns broker/subscription errors such as 403 or access
  forbidden, say that historical candles are unavailable for that connected
  account, then try broker_get_quotes and broker_get_ohlc for the latest
  snapshot if useful. Do not claim historical data is impossible before trying
  the relevant historical tool or capability check.
- For latest price, LTP, day change, bid/ask, or immediate valuation, use
  broker_get_quotes. For latest open/high/low/close snapshot, use broker_get_ohlc.
- Use broker_get_data_capabilities when unsure whether a broker/account supports
  historical candles, option chains, greeks, streams, or other optional APIs.

Answer quality:
- State the data source, account label, exchange (including NSE→BSE fallback
  when used), interval, and date range when giving analysis from tools.
- If enough candles are returned, calculate simple performance figures such as
  start price, end/latest price, absolute change, percentage change, high, low,
  and a short observation. Do not overstate precision beyond the returned data.
- If a requested analysis is blocked by missing broker permissions, explain the
  exact broker error and provide the best available fallback snapshot.
- When a broker tool returns ok=false with retry=false or code=broker_auth_failed,
  do NOT call that broker's market-data tools again in this run (no live quotes,
  cached quotes, search, or instrument sync on that account). The connected
  account is stale, expired, unpaid, unauthorized, or rate-limited even if
  session_status looked active. Try one other connected account at most once.
  If that also fails (401/403/429), stop broker market data. Tell the user
  briefly to reconnect or renew from Broker connections, then finish with
  MCP/intel/news tools and widgets that do not need that broker.
- HTTP 429 is not fixed by retrying. Switch account or MCP prices; do not hammer
  the same quotes endpoint.
- When MCP tools also ran, incorporate those facts in the same answer instead
  of only describing canvas layout.
"""

ADAPTIVE_WORKSPACE_INSTRUCTIONS = """
This run is an Adaptive Workspace desk session. Chat answers first, then the
canvas visualizes. Do not treat compose_surface as a substitute for answering.

Priority for a market / news / research question (same as Broker Chat):
1. Call connected MCP tools (daily summary, news, events, movers, research).
2. Call local broker tools for live quotes, holdings, chains, health.
3. Call intel_get_feed(force_refresh=true) for Ananta/Drishti headlines.
4. Write a complete briefing in chat with numbers, headlines, and sources.
5. Then compose or patch the canvas so the same facts are visible. First-party
   widgets for live broker data; html-artifact (Canvas) for themed briefings,
   timelines, and snapshots of data you already fetched — host injects CSS.
Do not spend the whole turn on workspace_evaluate_request / authoring docs
unless the user asked to rebuild the desk. Skip evaluate_request when the
query is a market briefing and go straight to MCP + broker + intel tools.

Workspace tools:
- workspace_evaluate_request: plan intents, recommended tools/types, and whether
  a draft spec actually complements the query (not just matching type names).
- workspace_get_authoring_docs: catalog types, allowlisted data.tool names, grid
  rules, forbidden props, and a valid example spec. Call this if you are unsure.
- workspace_get_current: the desk currently on the canvas (includes canvas_inventory).
- workspace_validate_spec: dry-run. Returns ok=true always; check valid and
  validation.errors before compose_surface.
- compose_surface: replace the whole desk with a valid WorkspaceSpec.
- patch_surface: add/remove/move/update/duplicate/retitle one widget.
- workspace_update_html_artifact: evolve an existing Canvas by component id.
- workspace_list_templates / workspace_list_skills / workspace_list_saved_desks:
  named layouts. If the user asks to apply one, compose_surface with that spec.
  Never rearrange because a request was repeated. Suggest only.
- workspace_get_micro_app: curated sandbox apps (payoff-diagram only).
  Research notes go on notes-block, not a micro-app.
- workspace_publish_html_artifact: themed Canvas document for fetched data.
  Author only kit classes from workspace_get_authoring_docs().canvas_kit.
  workspace_update_html_artifact evolves an existing canvas id. No remote scripts.

Data tools also on this desk:
- intel_get_feed(product, symbols, force_refresh=true): news, announcements,
  earnings, concalls, or alpha alerts. Always pass force_refresh=true on the
  first pull so Drishti is queried. Prefer MCP first when it is connected.
- intel_list_alert_workflows / intel_list_alert_notifications: Adaptive-only
  read-only alerts inbox.
- alert_get_studio / alert_refresh_studio / alert_create_draft / alert_deploy_snapshot:
  workflow studio on this canvas. alert_create_draft writes a draft + snapshot
  (not live). alert_get_studio reuses alert_workflow_chat_snapshots.
  Never call alert_deploy_snapshot unless the user explicitly confirmed; pass confirm=true.

Preferred component types: holdings-table, holdings-vs-index, quote-ticker, quote-chart, price-chart,
broker-health, watchlist, intel-feed, alert-rule-draft, workflow-graph,
workflow-simulation, approval-card, micro-app, html-artifact, notes-block,
option-chain, greeks-panel, margin-scenario, pnl-exposure-strip, market-heatmap.
These all have live renderers. Do not list catalog types as "reserved" or
"not live". Compose the matching widget instead.
Common mistakes that WILL be rejected:
- holdings / portfolio → holdings-table
- holdings vs Nifty / vs index → holdings-vs-index (portfolio + index quote)
- quotes / quote → quote-ticker
- quotes AND chart for the same names → quote-chart (not two overlapping widgets)
- chart only → price-chart
- session-status / health / broker-status → broker-health
- news / announcements / earnings / concalls for a universe → ONE intel-feed
  with props.products=["news","announcements","concalls"] (subset as asked).
  Do not emit one intel-feed per company unless the user asked to split.
- alerts / notifications → alert-rule-draft + intel_list_alert_*
- workflow studio / create alert / deploy alert / simulate alert →
  alert_create_draft when they asked to make one, then alert-rule-draft +
  workflow-graph + workflow-simulation + approval-card, all with
  data.tool=alert_get_studio and params.workflow_id. Never silent-deploy.
  /alerts-workspace chat remains; this desk can do the same create/confirm work.
- watchlist / last watchlist → watchlist + broker_list_watchlists then
  broker_get_watchlist_symbols
- option chain → option-chain + broker_get_option_chain (props.symbol, props.expiry).
  Always compose the widget. If the broker cannot price F&O, the live renderer
  shows that — never skip the panel or claim F&O is unsupported as a substitute
  for composing.
- greeks → greeks-panel + broker_get_greeks. Same: compose even when unsupported.
- margin estimate → margin-scenario + broker_calculate_margin (read-only).
  Symbol + exchange is enough; the API hydrates broker scrip codes.
- pnl / exposure → pnl-exposure-strip (holdings + positions)
- heatmap → market-heatmap with props.heatmapScope tracked|watchlist|portfolio_holdings
- payoff / straddle / sandbox → micro-app with props.appId from
  workspace_get_micro_app, plus notes-block. Never src or href on that widget.
- custom viz / Canvas / briefing of fetched data → html-artifact via
  workspace_publish_html_artifact (or workspace_update_html_artifact to evolve).
  After MCP/intel research, publish one briefing canvas even when the user did
  not say "visualize" or "HTML". Kit CSS follows the host light/dark theme —
  never hard-code colors.

Canvas (html-artifact) rules:
- html-artifact is a themed Canvas, not a free HTML dump. The host injects CSS
  that tracks the product theme (light and dark). Do not write colors.
- When composing html-artifact, copy bind.data.params.document from workspace_publish_html_artifact (already kit-wrapped). Do not paste the raw fragment into the spec.
- Forbidden: style tags, gradients, emoji, rainbow pills, hex colors, box-shadow.
- Multiple canvases when the user asks for more than one purpose (e.g. timeline +
  earnings snapshot). Use distinct ids (gabriel-timeline, gabriel-snapshot). Do
  not merge unrelated purposes into one blob.
- Before composing canvases: workspace_get_current. If canvas_inventory already
  has a matching kind/title/symbol, call workspace_update_html_artifact instead
  of adding another.
- Follow-ups that refine the same briefing must UPDATE the existing canvas id,
  not compose_surface a new desk that drops other widgets unless the user asked
  to rebuild.
- patch_surface add for a new purpose; workspace_update_html_artifact for evolving
  one canvas. Answer in chat first, then canvas.
- If broker_get_quotes, broker_get_portfolio, broker_get_historical, or similar
  returns ok=false with retry=false or code=broker_auth_failed, stop retrying that
  broker account for market data this run. Session status can still say active while
  the API key or subscription is dead. Tell the user once to reconnect/renew, then
  answer with MCP/intel and compose widgets that still work (news, html-artifact).
- Do not call workspace_get_authoring_docs unless compose_surface or
  workspace_validate_spec already failed. For a market briefing, skip evaluate_request.
- When publishing a Canvas, call workspace_publish_html_artifact first, then copy
  the returned bind.data object onto the html-artifact component. Never paste a
  truncated HTML document into compose_surface. Never set spec-level props.
  Never concatenate extra JSON after a component. If compose fails on document,
  retry once with intel-feed + quote-ticker only (omit html-artifact).
- If MCP describe_tools/execute_tool fails twice, stop that loop. Answer with
  intel_get_feed and any MCP data already returned.

WorkspaceSpec rules:
- version must be the string "1". layout.mode must be "grid" and columns 12.
- ids match ^[a-z][a-z0-9-]*$ and must be unique.
- Desk name is spec.title only. Never set components[].title.
  html-artifact labels go in props.title, not a component-level title key.
- data.tool must be allowlisted. Never include secrets.
- Never emit React, CSS className, style, href, src, extra keys, or script on
  first-party widgets. Canvas HTML belongs only on html-artifact via
  workspace_publish_html_artifact (document in data.params, kit classes only).
- Prefer readable sizes: quotes 6x3, quote-chart 12x7, holdings 12x5, charts 8x4,
  health 4x3, watchlist 4x4, intel-feed 6x5, alerts 6x4, graph 6x5, simulation 6x4,
  approval 6x4, micro-app 6x5, notes 4x4.
- x + w must be <= 12.
- For a named symbol (RELIANCE, TCS, …) set props.scope="symbol" and
  props.symbol. For several named companies, set universe.symbols to those
  names and props.scope="desk" on quote-chart, intel-feed, and quote-ticker.
  universe is this desk's private list (max 40). Never write it into the user's
  Watchlists settings. Only use props.scope="watchlist" and watchlistId when the
  user named an existing watchlist.
- hiddenSymbols parks a name at the bottom of the quotes table and hides its
  chart series. Do not drop the symbol from the binding.

Operating rules:
- Call workspace_evaluate_request only when composing or rearranging a desk,
  not before answering a briefing/research question.
- Never answer by listing the catalog. Do not call workspace_get_authoring_docs
  unless compose/validate already failed. Prefer broker_* and intel_* tools
  (and connected MCP) the same way Broker Chat does. Fetch real data, answer
  in chat, then compose matching live widgets. A catalog dump is not a desk
  or an answer.
- For research, headlines, or "look into X": use connected MCP tools first,
  then intel_get_feed(force_refresh=true). Answer in chat, then publish or
  update one html-artifact briefing of those facts without being asked for HTML.
- Fetch real data before compose: watchlist symbols, then quotes for those
  symbols (cap 20; NSE then BSE cash fallback is automatic), then intel_get_feed
  with force_refresh=true for each needed product (or one call per product).
- News / latest headlines / "look into X" / Drishti MCP / local broker tools
  still run here exactly as they do on Broker Chat. Also compose intel-feed,
  quote-chart, or notes-block when they help the user see the result. Do not
  skip the canvas because you already wrote a chat briefing, and do not skip
  the briefing because you composed a canvas.
- Chat is the default Intelligence surface at /chat. Do not send the user to
  Broker Chat. That page is hidden on purpose.
- Pass observations (quote_count, quotes_with_change_pct, news_item_count,
  watchlist_symbol_count, alert_workflow_count) into evaluate_request and only
  compose when complements_query is true or you have explained the gap.
- Session change% is enough for "live price movements". Use broker_get_historical
  only for multi-day / backtest-style asks, and only on a few symbols — or bind
  them on quote-chart.
- If validate or compose returns valid=false, read validation.errors, fix the
  listed paths, and retry at most once. Do not loop.
- After one successful compose or patch (applied=true), write a useful desk
  briefing in chat — not just "I composed a canvas":
  - What landed (widget types and bindings).
  - Concrete numbers from tools: LTPs, session %, date range, headline count.
  - Notable news/announcement/concall items (title, symbol, date) when fetched.
  - MCP or other tool findings that are not on the canvas.
  - Gaps: missing NSE then BSE tried, empty intel after refresh, broker errors.
- Then stop. Do not rebuild the desk unless the user asks.
- If a component is selected, prefer patch_surface on that id for "change this"
  requests instead of compose_surface.
- Do not dump the full JSON in the chat reply.
- Keep Broker Chat-quality analysis when MCP or broker tools return data even
  if a canvas was also updated. Canvas is the visual; chat is the briefing.
"""


def _truncate_json(value: Any, limit: int = 8000) -> str:
    text = json.dumps(value, default=str, ensure_ascii=False)
    if len(text) <= limit:
        return text
    return text[: limit - 15] + "...[truncated]"


def _adaptive_workspace_enabled(metadata: dict[str, Any]) -> bool:
    if not feature_flags.adaptive_workspace_enabled():
        return False
    return bool(metadata.get("adaptive_workspace"))


def _workspace_spec_from_metadata(metadata: dict[str, Any]) -> dict[str, Any] | None:
    spec = metadata.get("workspace_spec")
    return spec if isinstance(spec, dict) else None


def _selected_component_id(metadata: dict[str, Any]) -> str | None:
    value = metadata.get("selected_component_id")
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


class BrokerChatCancelled(Exception):
    pass


def response_looks_incomplete(text: str, *, tool_calls: int, had_message: bool) -> bool:
    """True when the model stopped after tools/planning without a usable answer."""

    stripped = (text or "").strip()
    if tool_calls and not had_message:
        return True
    if not stripped:
        return True
    last_line = stripped.splitlines()[-1].strip()
    if last_line.endswith((":", "—", "–", "...")):
        return True
    if _INCOMPLETE_LAST_LINE.search(last_line) and len(stripped) < 1600:
        return True
    return False


def _continuation_input(
    previous_input: list[Any],
    stream: Any,
    final_text: str,
    *,
    nudge: str = CONTINUE_USER_MESSAGE,
) -> list[Any]:
    to_list = getattr(stream, "to_input_list", None)
    if callable(to_list):
        try:
            items = list(to_list())
            if items:
                items.append({"role": "user", "content": nudge})
                return items
        except Exception:
            pass
    next_input = list(previous_input)
    if final_text.strip():
        next_input.append({"role": "assistant", "content": final_text})
    next_input.append({"role": "user", "content": nudge})
    return next_input


def _usage_response_from_raw_event(data: Any) -> Any:
    return getattr(data, "response", None) or data


def _record_broker_chat_usage(
    run: BrokerChatRun,
    *,
    response: Any = None,
    started_at: datetime,
    completed_at: datetime | None = None,
    status: str = "success",
    error: str | None = None,
) -> None:
    record_llm_usage(
        user_id=run.user_id,
        provider=run.provider,
        requested_model_id=run.model_id,
        api_surface="agents_sdk",
        started_at=started_at,
        completed_at=completed_at or datetime.now(tz=UTC).replace(tzinfo=None),
        status=status,
        tracking=LlmTrackingContext(
            request_kind="broker_chat",
            source_kind="broker_chat_run",
            source_id=run.id,
            session_id=run.session_id,
            metadata={"broker_chat_run_id": run.id, "broker_chat_session_id": run.session_id},
        ),
        response=response,
        error=error,
    )


_ORIGINAL_ITEMS_TO_MESSAGES = Converter.items_to_messages
_CHAT_COMPLETIONS_SANITIZER_INSTALLED = False


def _is_single_json_object_text(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    try:
        parsed = json.loads(value)
    except Exception:
        return False
    return isinstance(parsed, dict)


def _text_from_chat_content(value: Any) -> str:
    if isinstance(value, str):
        return value
    if value is None:
        return ""
    if isinstance(value, list):
        chunks: list[str] = []
        for item in value:
            if isinstance(item, dict):
                text = item.get("text")
                if text:
                    chunks.append(str(text))
                    continue
            chunks.append(json.dumps(_safe_data(item), ensure_ascii=False, default=str))
        return "\n".join(chunk for chunk in chunks if chunk).strip()
    return json.dumps(_safe_data(value), ensure_ascii=False, default=str)


def _sanitize_chat_completion_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    sanitized: list[dict[str, Any]] = []
    for message in messages:
        item = dict(message)
        if item.get("role") == "assistant":
            tool_calls = item.get("tool_calls")
            if isinstance(tool_calls, list):
                next_calls: list[Any] = []
                for tool_call in tool_calls:
                    if not isinstance(tool_call, dict):
                        next_calls.append(tool_call)
                        continue
                    next_call = dict(tool_call)
                    function = next_call.get("function")
                    if isinstance(function, dict):
                        next_function = dict(function)
                        arguments = next_function.get("arguments")
                        if not _is_single_json_object_text(arguments):
                            next_function["arguments"] = json.dumps(
                                {
                                    "_invalid_tool_arguments": str(arguments or ""),
                                    "_retry_instruction": (
                                        "The previous tool arguments were not exactly one JSON object. "
                                        "Use the paired tool output as feedback and retry with one valid JSON object matching the tool schema."
                                    ),
                                },
                                ensure_ascii=False,
                            )
                        next_call["function"] = next_function
                    next_calls.append(next_call)
                item["tool_calls"] = next_calls
        elif item.get("role") == "tool":
            content = _text_from_chat_content(item.get("content"))
            item["content"] = content or "Tool returned no text content."
        sanitized.append(item)
    return sanitized


def _install_chat_completions_message_sanitizer() -> None:
    global _CHAT_COMPLETIONS_SANITIZER_INSTALLED
    if _CHAT_COMPLETIONS_SANITIZER_INSTALLED:
        return

    def _patched_items_to_messages(cls: type[Converter], *args: Any, **kwargs: Any) -> list[dict[str, Any]]:
        kwargs.setdefault("preserve_tool_output_all_content", True)
        messages = _ORIGINAL_ITEMS_TO_MESSAGES(*args, **kwargs)
        return _sanitize_chat_completion_messages(messages)

    Converter.items_to_messages = classmethod(_patched_items_to_messages)
    _CHAT_COMPLETIONS_SANITIZER_INSTALLED = True


WEB_RESEARCH_INSTRUCTIONS = """
Public web:
- If the user pastes any http(s) link (Screener, NSE, BSE, filings, news), call web_fetch on it in the same turn.
- If the question needs the open web and MCP/intel/broker do not have it, call web_search at most twice (one query, one refinement), then web_fetch the best 1–3 URLs. Do not keep searching after you have usable titles and URLs.
- Login-walled pages: say the page is not readable and continue with other sources.
- Never mention crawlers, fetch tools, or search engines unless the user asks how you got the page.
"""


def _broker_chat_instructions(
    *,
    adaptive_workspace: bool = False,
) -> str:
    instructions = BROKER_CHAT_INSTRUCTIONS_TEMPLATE
    if adaptive_workspace:
        instructions = f"{instructions}\n{ADAPTIVE_WORKSPACE_INSTRUCTIONS}"
        instructions = f"{instructions}\n{WEB_RESEARCH_INSTRUCTIONS}"
    return instructions


def _safe_data(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, (datetime,)):
        return value.isoformat()
    if hasattr(value, "model_dump"):
        return _safe_data(value.model_dump())
    if isinstance(value, dict):
        return {str(key): _safe_data(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_safe_data(item) for item in value]
    if hasattr(value, "__dict__"):
        return {str(key): _safe_data(item) for key, item in vars(value).items() if not key.startswith("_")}
    return str(value)


def _json_from_maybe_string(value: Any) -> Any:
    if not isinstance(value, str):
        return _safe_data(value)
    stripped = value.strip()
    if not stripped:
        return value
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        return value


def _extract_tool_call_start(item: Any) -> tuple[str, dict[str, Any], str | None]:
    raw_item = getattr(item, "raw_item", None)
    tool_name = (
        getattr(raw_item, "name", None)
        or getattr(item, "name", None)
        or getattr(raw_item, "function", None) and getattr(raw_item.function, "name", None)
        or "unknown"
    )
    call_id = (
        getattr(raw_item, "call_id", None)
        or getattr(raw_item, "id", None)
        or getattr(item, "id", None)
    )
    raw_args = (
        getattr(raw_item, "arguments", None)
        or getattr(item, "arguments", None)
        or getattr(raw_item, "function", None) and getattr(raw_item.function, "arguments", None)
    )
    args = _json_from_maybe_string(raw_args)
    if not isinstance(args, dict):
        args = {"raw": args}
    return str(tool_name or "unknown"), args, str(call_id) if call_id else None


def _extract_tool_call_output(item: Any) -> tuple[str | None, Any]:
    raw_item = getattr(item, "raw_item", None)
    call_id = (
        getattr(item, "raw_item_id", None)
        or getattr(raw_item, "call_id", None)
        or getattr(raw_item, "id", None)
        or getattr(item, "id", None)
    )
    return str(call_id) if call_id else None, _json_from_maybe_string(getattr(item, "output", None))


def _first_text_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, dict):
        for key in ("delta", "text", "summary", "content", "message"):
            text = _first_text_value(value.get(key))
            if text:
                return text
        return ""
    if isinstance(value, (list, tuple, set)):
        parts = [_first_text_value(item) for item in value]
        return " ".join(part for part in parts if part).strip()
    return ""


def _reasoning_event_payload(data: Any) -> tuple[dict[str, Any], dict[str, Any]] | None:
    raw_type = str(getattr(data, "type", "") or "")
    if raw_type.endswith(".delta"):
        return None
    raw = _safe_data(data)
    text = ""
    for attr in ("delta", "text", "summary", "content", "message"):
        text = _first_text_value(getattr(data, attr, None))
        if text:
            break
    if not text:
        text = _first_text_value(raw)
    if not text:
        return None

    public_payload = {
        "message": text[:500],
        "raw_type": raw_type,
    }
    full_payload = {
        "message": text,
        "raw_type": raw_type,
        "raw": raw,
    }
    return public_payload, full_payload


def _output_preview(output: Any) -> dict[str, Any]:
    text = json.dumps(output, default=str, ensure_ascii=False) if not isinstance(output, str) else output
    return {
        "type": type(output).__name__,
        "length": len(text),
        "preview": text[:300],
    }


def _append_run_continued(
    db,
    run,
    *,
    attempt: int,
    reason: str,
    error_class: str | None = None,
    delay_seconds: float | None = None,
    extra_full: dict[str, Any] | None = None,
) -> None:
    public_payload: dict[str, Any] = {
        "status": "running",
        "attempt": attempt,
        "reason": reason,
    }
    if reason == "provider_retry":
        public_payload["display_name"] = "Retrying provider…"
    full_payload: dict[str, Any] = {"reason": reason, "error_class": error_class}
    if delay_seconds is not None:
        full_payload["delay_seconds"] = delay_seconds
    if extra_full:
        full_payload.update(extra_full)
    broker_chat.append_event(
        db,
        run,
        event_type="run_continued",
        public_payload=public_payload,
        full_payload=full_payload,
    )


def _build_model(db, run, policy: AgentRetryPolicy) -> OpenAIChatCompletionsModel:
    _install_chat_completions_message_sanitizer()
    definition = llm_config.provider_definition(run.provider)
    api_key = llm_config.get_provider_api_key(db, run.user_id, run.provider)
    return OpenAIChatCompletionsModel(
        model=run.model_id,
        openai_client=AsyncOpenAI(
            **openai_client_kwargs(
                api_key=api_key,
                base_url=definition["base_url"],
                policy=policy,
            )
        ),
        strict_feature_validation=False,
    )


def _model_settings_for_run(run) -> ModelSettings:
    metadata = broker_chat.json_loads(run.metadata_json, {})
    try:
        effort = llm_config.normalize_reasoning_effort(metadata.get("reasoning_effort"))
    except ValueError:
        effort = None
    extra_body = {"reasoning": {"effort": effort}} if effort and run.provider == "openrouter" else None
    reasoning = Reasoning(effort=effort) if effort else None
    return ModelSettings(
        temperature=0.3,
        max_tokens=8000,
        include_usage=True,
        extra_body=extra_body,
        reasoning=reasoning,
    )


async def _run_broker_chat(run_id: str) -> None:
    db = SessionLocal()
    mcp_handle = broker_chat_mcp.BrokerChatMcpHandle(manager=None, active_servers=[], enabled=False)
    final_text = ""
    tool_names_by_call_id: dict[str, str] = {}
    pending_tool_names: list[str] = []
    reasoning_events_emitted = 0
    response_started_at = datetime.now(tz=UTC).replace(tzinfo=None)
    usage_events_recorded = 0
    try:
        run = db.get(BrokerChatRun, run_id)
        if run is None:
            return
        run_span = llm_telemetry.start_span(
            "llm.broker_chat.run",
            {
                "llm.source_kind": "broker_chat_run",
                "llm.source_id": run.id,
                "llm.session_id": run.session_id,
                "gen_ai.system": run.provider,
                "gen_ai.request.model": run.model_id,
            },
        )
        run_span.__enter__()
        if run.status in {"completed", "failed"}:
            return
        if run.status == "cancelled" or broker_chat_cancel_requested(run.id):
            broker_chat.mark_run_terminal(db, run, status="cancelled", response_text=run.response_text)
            broker_chat.append_event_once(db, run, event_type="run_cancelled", public_payload={"status": "cancelled"})
            return
        broker_chat.mark_run_running(db, run)
        db.refresh(run)
        broker_chat.append_event(
            db,
            run,
            event_type="run_started",
            public_payload={"status": "running", "provider": run.provider, "model": run.model_id},
        )

        metadata = broker_chat.json_loads(run.metadata_json, {})
        adaptive_workspace = _adaptive_workspace_enabled(metadata)
        workspace_spec = _workspace_spec_from_metadata(metadata)
        selected_component_id = _selected_component_id(metadata)
        context = BrokerAgentContext(
            user_id=run.user_id,
            default_account_id=metadata.get("default_account_id"),
            search_account_id=metadata.get("search_account_id"),
            adaptive_workspace=adaptive_workspace,
            session_id=run.session_id,
            workspace_spec=workspace_spec,
            selected_component_id=selected_component_id,
        )
        mcp_handle = await broker_chat_mcp.connect_broker_chat_mcp(db, run, metadata)
        mcp_context = broker_chat_mcp.mcp_context_instructions(mcp_handle)
        pref = broker_chat.get_or_create_preference(db, run.user_id)
        retry_policy = resolve_agent_retry_policy(getattr(pref, "retry_json", None))
        job_timeout = float(get_settings().broker_chat_job_timeout_seconds)
        fingerprint_tracker = ToolFingerprintTracker(threshold=retry_policy.fingerprint_break_threshold)
        nudged_fingerprints: set[str] = set()
        provider_retries_used = 0
        continuations_used = 0
        tools = (
            [*BROKER_DATA_TOOLS, *INTEL_TOOLS, *ALERT_STUDIO_TOOLS, *WORKSPACE_TOOLS]
            if adaptive_workspace
            else [*BROKER_DATA_TOOLS, *INTEL_FEED_TOOLS]
        )
        if adaptive_workspace:
            tools = [*tools, *WEB_TOOLS]
        tools = [*tools, *mcp_handle.extra_tools]
        instructions = _broker_chat_instructions(adaptive_workspace=adaptive_workspace)
        sandbox_available = False
        evidence_contract = plan_evidence_contract(
            run.message,
            adaptive_workspace=adaptive_workspace,
            sandbox_available=sandbox_available,
            mcp_enabled=bool(mcp_handle.enabled),
        )
        evidence_report = evidence_gaps(
            evidence_contract,
            [],
            sandbox_available=sandbox_available,
        )
        persist_evidence(db, run, evidence_report)
        if evidence_report.todos:
            broker_chat.append_event(
                db,
                run,
                event_type="evidence_todos",
                public_payload={"todos": ui_todos(evidence_report.todos), "title": "Research steps"},
                full_payload={"todos": evidence_report.todos},
            )
        evidence_continuations_used = 0
        clarify_used = False
        status_bar = build_status_bar(
            mcp_context=mcp_context,
            workspace_spec=workspace_spec,
            selected_component_id=selected_component_id,
            evidence_line=evidence_status_line(evidence_report),
        )
        context_build = build_model_input(
            db,
            run,
            current_user_text=run.message,
            status_bar=status_bar,
            instructions=instructions,
        )
        if get_settings().broker_chat_emit_model_context_event:
            broker_chat.append_event(
                db,
                run,
                event_type="model_context_built",
                public_payload={
                    "prior_turns": context_build.prior_turns,
                    "tool_projections": context_build.tool_projections,
                    "caps_hit": context_build.caps_hit,
                    "char_count": context_build.char_count,
                },
                full_payload={
                    "prior_turns": context_build.prior_turns,
                    "tool_projections": context_build.tool_projections,
                    "caps_hit": context_build.caps_hit,
                    "dropped_oldest_turns": context_build.dropped_oldest_turns,
                    "char_count": context_build.char_count,
                    "cache_breakers": context_build.cache_breakers,
                    "hook_names": [],
                    "skill_names": [],
                },
            )
        agent = Agent[BrokerAgentContext](
            name="Ananta Market Stack Broker Data Agent",
            instructions=instructions,
            model=_build_model(db, run, retry_policy),
            model_settings=_model_settings_for_run(run),
            tools=tools,
            mcp_servers=mcp_handle.active_servers,
            mcp_config=broker_chat_mcp.broker_chat_mcp_config(
                prefix_server_names=len(mcp_handle.active_servers) > 1 and not mcp_handle.extra_tools
            ),
        )
        messages = context_build.messages
        max_turns = ADAPTIVE_WORKSPACE_MAX_TURNS if adaptive_workspace else BROKER_CHAT_MAX_TURNS
        tool_calls = 0
        had_message = False
        stream = None

        async def consume_stream(active_stream: Any) -> None:
            nonlocal final_text, response_started_at, usage_events_recorded
            nonlocal reasoning_events_emitted, tool_calls, had_message
            event_iter = active_stream.stream_events().__aiter__()
            while True:
                try:
                    event = await anext_with_idle(event_iter, retry_policy.stream_idle_seconds)
                except StopAsyncIteration:
                    break
                extend_job_timeout_window(job_timeout)
                db.refresh(run)
                if run.status == "cancelled" or broker_chat_cancel_requested(run.id):
                    raise BrokerChatCancelled()
                event_type = getattr(event, "type", "")
                if event_type == "raw_response_event":
                    data = getattr(event, "data", None)
                    raw_type = getattr(data, "type", "")
                    if raw_type == "response.output_text.delta":
                        delta = getattr(data, "delta", "")
                        if delta:
                            final_text += delta
                            broker_chat.append_event(
                                db,
                                run,
                                event_type="token",
                                public_payload={"text": delta},
                                full_payload={"text": delta, "raw_type": raw_type},
                            )
                    elif raw_type == "response.created":
                        response_started_at = datetime.now(tz=UTC).replace(tzinfo=None)
                        broker_chat.append_event(
                            db,
                            run,
                            event_type="response_started",
                            public_payload={"response_id": getattr(data, "response_id", None)},
                            full_payload={"raw_type": raw_type, "raw": _safe_data(data)},
                        )
                    elif raw_type == "response.completed":
                        completed_at = datetime.now(tz=UTC).replace(tzinfo=None)
                        _record_broker_chat_usage(
                            run,
                            response=_usage_response_from_raw_event(data),
                            started_at=response_started_at,
                            completed_at=completed_at,
                        )
                        usage_events_recorded += 1
                        broker_chat.append_event(
                            db,
                            run,
                            event_type="response_completed",
                            public_payload={"response_id": getattr(data, "response_id", None)},
                            full_payload={"raw_type": raw_type, "raw": _safe_data(data)},
                        )
                    elif "reasoning" in str(raw_type):
                        if not run.include_reasoning or reasoning_events_emitted >= MAX_REASONING_EVENTS_PER_RUN:
                            continue
                        reasoning_payload = _reasoning_event_payload(data)
                        if reasoning_payload is None:
                            continue
                        public_payload, full_payload = reasoning_payload
                        broker_chat.append_event(
                            db,
                            run,
                            event_type="reasoning",
                            public_payload=public_payload,
                            full_payload=full_payload,
                        )
                        reasoning_events_emitted += 1
                    continue

                if event_type == "run_item_stream_event":
                    item = getattr(event, "item", None)
                    item_type = getattr(item, "type", "")
                    if item_type == "tool_call_item":
                        tool_name, arguments, call_id = _extract_tool_call_start(item)
                        tool_calls += 1
                        fingerprint_tracker.record(tool_name, arguments)
                        if call_id:
                            tool_names_by_call_id[call_id] = tool_name
                        pending_tool_names.append(tool_name)
                        started = decorate_tool_payload(
                            tool_name,
                            {
                                "tool_name": tool_name,
                                "tool_call_id": call_id,
                                "arguments": arguments,
                            },
                        )
                        broker_chat.append_event(
                            db,
                            run,
                            event_type="tool_call_started",
                            public_payload=started,
                            full_payload={**started, "raw_item": _safe_data(item)},
                        )
                    elif item_type == "tool_call_output_item":
                        call_id, output = _extract_tool_call_output(item)
                        tool_name = tool_names_by_call_id.get(call_id or "", "unknown")
                        if tool_name == "unknown" and pending_tool_names:
                            tool_name = pending_tool_names.pop(0)
                        completed = decorate_tool_payload(
                            tool_name,
                            {
                                "tool_name": tool_name,
                                "tool_call_id": call_id,
                                "output_metadata": _output_preview(output),
                            },
                        )
                        broker_chat.append_event(
                            db,
                            run,
                            event_type="tool_call_completed",
                            public_payload=completed,
                            full_payload={
                                **completed,
                                "output": output,
                                "raw_item": _safe_data(item),
                            },
                        )
                    elif item_type == "message_output_item":
                        text = ItemHelpers.text_message_output(item)
                        had_message = True
                        if text:
                            final_text = text
                        broker_chat.append_event(
                            db,
                            run,
                            event_type="message_output",
                            public_payload={"content": text or final_text, "is_final": True},
                            full_payload={"content": text or final_text, "raw_item": _safe_data(item), "is_final": True},
                        )
                    continue

                if event_type == "agent_updated_stream_event":
                    agent_name = getattr(getattr(event, "new_agent", None), "name", None)
                    broker_chat.append_event(
                        db,
                        run,
                        event_type="agent_updated",
                        public_payload={"agent": agent_name},
                        full_payload={"agent": agent_name},
                    )

        while True:
            extend_job_timeout_window(job_timeout)
            db.refresh(run)
            if run.status == "cancelled" or broker_chat_cancel_requested(run.id):
                raise BrokerChatCancelled()
            messages = repair_unpaired_tool_messages(messages)
            stream = Runner.run_streamed(
                starting_agent=agent,
                input=messages,
                context=context,
                max_turns=max_turns,
                run_config=RunConfig(
                    tracing_disabled=run.provider != "openai",
                    workflow_name="Ananta Market Stack broker chat",
                ),
            )
            hit_max_turns = False
            try:
                await consume_stream(stream)
            except BrokerChatCancelled:
                raise
            except AgentRetryError:
                raise
            except MaxTurnsExceeded:
                hit_max_turns = True
            except ModelBehaviorError as exc:
                if continuations_used >= MAX_RUN_CONTINUATIONS:
                    raise AgentRetryError(
                        classify_provider_error(exc, max_server_delay_seconds=retry_policy.max_server_delay_seconds)
                    ) from exc
                continuations_used += 1
                _append_run_continued(
                    db,
                    run,
                    attempt=continuations_used,
                    reason="unknown_tool",
                    error_class="unknown_tool",
                    extra_full={"message": str(exc)[:500]},
                )
                messages.append(
                    {
                        "role": "user",
                        "content": (
                            f"A tool call failed: {exc}. Do not call unknown first-class tool names. "
                            "Use only attached tools. For MCP catalog names, use the prefixed MCP tools "
                            "or execute_tool with name at the top level. Otherwise use web_search, "
                            "web_fetch, intel_get_feed, or broker tools. Continue the original task."
                        ),
                    }
                )
                continue
            except Exception as exc:
                classified = classify_provider_error(
                    exc, max_server_delay_seconds=retry_policy.max_server_delay_seconds
                )
                can_retry = (
                    classified.retryable
                    and retry_policy.enabled
                    and provider_retries_used < retry_policy.max_retries
                )
                if can_retry:
                    delay = retry_delay_seconds(
                        retry_policy, provider_retries_used, classified.retry_after_seconds
                    )
                    remaining = remaining_job_seconds(run.started_at, job_timeout)
                    sleep_for = capped_sleep_seconds(delay, remaining_job_seconds=remaining)
                    if sleep_for is None:
                        raise AgentRetryError(classified) from exc
                    provider_retries_used += 1
                    _append_run_continued(
                        db,
                        run,
                        attempt=provider_retries_used,
                        reason="provider_retry",
                        error_class=classified.error_class,
                        delay_seconds=sleep_for,
                        extra_full={"message": str(exc)[:500], "layer": classified.layer},
                    )
                    await asyncio.sleep(sleep_for)
                    continue
                raise AgentRetryError(classified) from exc
            if not final_text and getattr(stream, "final_output", None):
                final_text = str(stream.final_output)
            db.refresh(run)
            if run.status == "cancelled" or broker_chat_cancel_requested(run.id):
                raise BrokerChatCancelled()
            new_breaks = [
                fingerprint for fingerprint in fingerprint_tracker.broken_fingerprints() if fingerprint not in nudged_fingerprints
            ]
            if new_breaks and continuations_used < MAX_RUN_CONTINUATIONS:
                continuations_used += 1
                nudged_fingerprints.update(new_breaks)
                _append_run_continued(
                    db,
                    run,
                    attempt=continuations_used,
                    reason="repeated_tool",
                    error_class="repeated_tool",
                    extra_full={"fingerprints": new_breaks},
                )
                messages.append({"role": "user", "content": fingerprint_nudge_message(new_breaks)})
                had_message = False
                continue
            incomplete = hit_max_turns or response_looks_incomplete(
                final_text, tool_calls=tool_calls, had_message=had_message
            )
            evidence_report = evidence_gaps(
                evidence_contract,
                load_run_events(db, run.id),
                final_text=final_text,
                sandbox_available=sandbox_available,
            )
            persist_evidence(db, run, evidence_report)
            if evidence_report.todos:
                broker_chat.append_event(
                    db,
                    run,
                    event_type="evidence_todos",
                    public_payload={"todos": ui_todos(evidence_report.todos), "title": "Research steps"},
                    full_payload={"todos": evidence_report.todos},
                )
            evidence_open = bool(evidence_report.unsatisfied())
            if evidence_open and evidence_continuations_used < MAX_EVIDENCE_CONTINUATIONS:
                evidence_continuations_used += 1
                nudge = evidence_nudge_message(evidence_report)
                if evidence_contract.clarify and not clarify_used:
                    nudge = f"{clarify_nudge_message()}\n{nudge}"
                    clarify_used = True
                broker_chat.append_event(
                    db,
                    run,
                    event_type="harness_nudge",
                    public_payload={"reason": "evidence_gap"},
                    full_payload={"message": nudge, "gaps": evidence_report.as_json()["gaps"]},
                )
                _append_run_continued(
                    db,
                    run,
                    attempt=evidence_continuations_used,
                    reason="evidence_gap",
                    error_class="evidence_incomplete",
                )
                messages = _continuation_input(messages, stream, final_text, nudge=nudge)
                had_message = False
                continue
            if incomplete and continuations_used < MAX_RUN_CONTINUATIONS:
                continuations_used += 1
                _append_run_continued(
                    db,
                    run,
                    attempt=continuations_used,
                    reason="max_turns" if hit_max_turns else "incomplete_answer",
                    error_class="task_incomplete",
                )
                messages = _continuation_input(messages, stream, final_text)
                had_message = False
                continue
            if evidence_open:
                evidence_report.status = "partial"
                persist_evidence(db, run, evidence_report)
                missing = "; ".join(gap.reason for gap in evidence_report.unsatisfied())
                broker_chat.append_event(
                    db,
                    run,
                    event_type="evidence_incomplete",
                    public_payload={
                        "message": f"I could not verify every research step. {missing}" if missing else "I could not verify every research step.",
                        "status": "partial",
                    },
                    full_payload=evidence_report.as_json(),
                )
            break

        broker_chat.mark_run_terminal(db, run, status="completed", response_text=final_text)
        db.refresh(run)
        broker_chat.append_event(
            db,
            run,
            event_type="run_completed",
            public_payload={"status": "completed", "response_text": final_text},
        )
    except BrokerChatCancelled:
        run = db.get(BrokerChatRun, run_id)
        if run is not None:
            broker_chat.mark_run_terminal(db, run, status="cancelled", response_text=final_text, error=None)
            db.refresh(run)
            broker_chat.append_event_once(
                db,
                run,
                event_type="run_cancelled",
                public_payload={"status": "cancelled"},
            )
        return
    except Exception as exc:
        run = db.get(BrokerChatRun, run_id)
        if run is not None and run.status != "cancelled":
            classified = classify_provider_error(exc)
            user_message = classified.user_message
            if usage_events_recorded == 0:
                _record_broker_chat_usage(
                    run,
                    started_at=response_started_at,
                    completed_at=datetime.now(tz=UTC).replace(tzinfo=None),
                    status="error",
                    error=str(exc),
                )
            broker_chat.mark_run_terminal(db, run, status="failed", response_text=final_text, error=user_message)
            db.refresh(run)
            broker_chat.append_event(
                db,
                run,
                event_type="run_failed",
                public_payload={"status": "failed", "message": user_message},
                full_payload={
                    "status": "failed",
                    "message": str(exc),
                    "error_type": exc.__class__.__name__,
                    "error_class": classified.error_class,
                    "layer": classified.layer,
                },
            )
        raise
    finally:
        if "run_span" in locals():
            run_span.__exit__(None, None, None)
        await mcp_handle.close()
        db.close()


def run_broker_chat_job(run_id: str) -> str:
    asyncio.run(_run_broker_chat(run_id))
    return run_id
