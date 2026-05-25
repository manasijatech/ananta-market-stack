from __future__ import annotations

import asyncio
import json
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from agents import Agent, ModelSettings, RunConfig, Runner
from agents.items import ItemHelpers
from agents.models.chatcmpl_converter import Converter
from agents.models.openai_chatcompletions import OpenAIChatCompletionsModel
from openai import AsyncOpenAI

from app.agent_tools import BROKER_DATA_TOOLS, BrokerAgentContext
from app.services import broker_chat, broker_chat_mcp, llm_config
from app.services.broker_chat_queue import broker_chat_cancel_requested
from db.models import BrokerChatRun
from db.session import SessionLocal

BROKER_CHAT_INSTRUCTIONS_TEMPLATE = """
You are Market-Stack's broker data assistant.

Current calendar context:
- __CURRENT_DAY_CONTEXT__
- Interpret relative periods like today, yesterday, last 1 month, last 6 months,
  YTD, and last year from this date unless the user gives explicit dates.
- Use ISO dates in tool arguments. For example, YYYY-MM-DD.

Use the broker tools whenever the user asks about connected broker accounts,
portfolio state, positions, holdings, funds, live quotes, OHLC, historical data,
option chains, greeks, margin estimates, stream status, or broker sessions.
When MCP is enabled for this run and the configured hosted MCP server connects,
you may also use MCP tools for any capability advertised by that server when it
is relevant to the user's request.

Important operating rules:
- Treat all broker data as user-owned private data.
- Never ask for broker API keys, tokens, PINs, passwords, or TOTP secrets in chat.
- Never ask for the MCP API key in chat. The backend attaches it from the user's
  encrypted MCP configuration when MCP is enabled.
- Prefer local broker tools for connected-account data and private portfolio
  state. Use MCP tools for server-advertised capabilities that can answer or
  enrich the user's request.
- If a tool returns action_required, explain the session/account action needed
  and do not invent market data.
- Prefer instrument search before quote, OHLC, or historical requests when the
  user provides only a plain symbol. Use portfolio holdings first when the user
  says "my holding", "its performance", "this stock", or otherwise refers to a
  previous holding/instrument.
- When a symbol exists on multiple Indian cash exchanges and the user did not
  specify one, prefer NSE. Use BSE only when the instrument is BSE-only or the
  user asks for BSE.
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
- State the data source, account label, exchange, interval, and date range when
  giving analysis from tools.
- If enough candles are returned, calculate simple performance figures such as
  start price, end/latest price, absolute change, percentage change, high, low,
  and a short observation. Do not overstate precision beyond the returned data.
- If a requested analysis is blocked by missing broker permissions, explain the
  exact broker error and provide the best available fallback snapshot.
"""


class BrokerChatCancelled(Exception):
    pass


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


def _broker_chat_instructions(mcp_context: str = "") -> str:
    now = datetime.now(ZoneInfo("Asia/Kolkata"))
    current_day_context = now.strftime("Today is %A, %B %d, %Y in Asia/Kolkata (IST).")
    instructions = BROKER_CHAT_INSTRUCTIONS_TEMPLATE.replace("__CURRENT_DAY_CONTEXT__", current_day_context)
    if mcp_context.strip():
        instructions = f"{instructions}\n\nConnected MCP context:\n{mcp_context.strip()}"
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


def _output_preview(output: Any) -> dict[str, Any]:
    text = json.dumps(output, default=str, ensure_ascii=False) if not isinstance(output, str) else output
    return {
        "type": type(output).__name__,
        "length": len(text),
        "preview": text[:300],
    }


def _build_model(db, run) -> OpenAIChatCompletionsModel:
    _install_chat_completions_message_sanitizer()
    definition = llm_config.provider_definition(run.provider)
    api_key = llm_config.get_provider_api_key(db, run.user_id, run.provider)
    kwargs: dict[str, Any] = {
        "api_key": api_key,
        "base_url": definition["base_url"],
        "timeout": 60.0,
    }
    return OpenAIChatCompletionsModel(
        model=run.model_id,
        openai_client=AsyncOpenAI(**kwargs),
        strict_feature_validation=False,
    )


async def _run_broker_chat(run_id: str) -> None:
    db = SessionLocal()
    mcp_handle = broker_chat_mcp.BrokerChatMcpHandle(manager=None, active_servers=[], enabled=False)
    final_text = ""
    tool_names_by_call_id: dict[str, str] = {}
    pending_tool_names: list[str] = []
    try:
        run = db.get(BrokerChatRun, run_id)
        if run is None:
            return
        if run.status == "cancelled" or broker_chat_cancel_requested(run.id):
            broker_chat.mark_run_terminal(db, run, status="cancelled", response_text=run.response_text)
            broker_chat.append_event(db, run, event_type="run_cancelled", public_payload={"status": "cancelled"})
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
        context = BrokerAgentContext(
            user_id=run.user_id,
            default_account_id=metadata.get("default_account_id"),
            search_account_id=metadata.get("search_account_id"),
        )
        mcp_handle = await broker_chat_mcp.connect_broker_chat_mcp(db, run, metadata)
        mcp_context = broker_chat_mcp.mcp_context_instructions(mcp_handle)
        agent = Agent[BrokerAgentContext](
            name="Market-Stack Broker Data Agent",
            instructions=_broker_chat_instructions(mcp_context),
            model=_build_model(db, run),
            model_settings=ModelSettings(
                temperature=0.3,
                max_tokens=5000,
                include_usage=True,
            ),
            tools=BROKER_DATA_TOOLS,
            mcp_servers=mcp_handle.active_servers,
            mcp_config=broker_chat_mcp.broker_chat_mcp_config(),
        )
        messages = broker_chat.conversation_history_for_run(db, run)
        messages.append({"role": "user", "content": run.message})
        stream = Runner.run_streamed(
            starting_agent=agent,
            input=messages,
            context=context,
            max_turns=28,
            run_config=RunConfig(
                tracing_disabled=run.provider != "openai",
                workflow_name="Market-Stack broker chat",
            ),
        )

        async for event in stream.stream_events():
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
                            full_payload={"text": delta, "raw_type": raw_type, "raw": _safe_data(data)},
                        )
                elif raw_type == "response.created":
                    broker_chat.append_event(
                        db,
                        run,
                        event_type="response_started",
                        public_payload={"response_id": getattr(data, "response_id", None)},
                        full_payload={"raw_type": raw_type, "raw": _safe_data(data)},
                    )
                elif raw_type == "response.completed":
                    broker_chat.append_event(
                        db,
                        run,
                        event_type="response_completed",
                        public_payload={"response_id": getattr(data, "response_id", None)},
                        full_payload={"raw_type": raw_type, "raw": _safe_data(data)},
                    )
                elif "reasoning" in str(raw_type):
                    broker_chat.append_event(
                        db,
                        run,
                        event_type="reasoning",
                        public_payload={"message": "Reasoning event received."},
                        full_payload={"raw_type": raw_type, "raw": _safe_data(data)},
                    )
                continue

            if event_type == "run_item_stream_event":
                item = getattr(event, "item", None)
                item_type = getattr(item, "type", "")
                if item_type == "tool_call_item":
                    tool_name, arguments, call_id = _extract_tool_call_start(item)
                    if call_id:
                        tool_names_by_call_id[call_id] = tool_name
                    pending_tool_names.append(tool_name)
                    broker_chat.append_event(
                        db,
                        run,
                        event_type="tool_call_started",
                        public_payload={
                            "tool_name": tool_name,
                            "tool_call_id": call_id,
                            "arguments": arguments,
                        },
                        full_payload={
                            "tool_name": tool_name,
                            "tool_call_id": call_id,
                            "arguments": arguments,
                            "raw_item": _safe_data(item),
                        },
                    )
                elif item_type == "tool_call_output_item":
                    call_id, output = _extract_tool_call_output(item)
                    tool_name = tool_names_by_call_id.get(call_id or "", "unknown")
                    if tool_name == "unknown" and pending_tool_names:
                        tool_name = pending_tool_names.pop(0)
                    broker_chat.append_event(
                        db,
                        run,
                        event_type="tool_call_completed",
                        public_payload={
                            "tool_name": tool_name,
                            "tool_call_id": call_id,
                            "output_metadata": _output_preview(output),
                        },
                        full_payload={
                            "tool_name": tool_name,
                            "tool_call_id": call_id,
                            "output": output,
                            "output_metadata": _output_preview(output),
                            "raw_item": _safe_data(item),
                        },
                    )
                elif item_type == "message_output_item":
                    text = ItemHelpers.text_message_output(item)
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

        if not final_text and getattr(stream, "final_output", None):
            final_text = str(stream.final_output)
        db.refresh(run)
        if run.status == "cancelled" or broker_chat_cancel_requested(run.id):
            raise BrokerChatCancelled()
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
            broker_chat.append_event(
                db,
                run,
                event_type="run_cancelled",
                public_payload={"status": "cancelled"},
            )
        return
    except Exception as exc:
        run = db.get(BrokerChatRun, run_id)
        if run is not None and run.status != "cancelled":
            broker_chat.mark_run_terminal(db, run, status="failed", response_text=final_text, error=str(exc))
            db.refresh(run)
            broker_chat.append_event(
                db,
                run,
                event_type="run_failed",
                public_payload={"status": "failed", "message": str(exc)},
                full_payload={"status": "failed", "message": str(exc), "error_type": exc.__class__.__name__},
            )
        raise
    finally:
        await mcp_handle.close()
        db.close()


def run_broker_chat_job(run_id: str) -> str:
    asyncio.run(_run_broker_chat(run_id))
    return run_id
