from __future__ import annotations

import asyncio
import json
from datetime import datetime
from typing import Any

from agents import Agent, ModelSettings, Runner
from agents.items import ItemHelpers
from agents.models.openai_chatcompletions import OpenAIChatCompletionsModel
from openai import AsyncOpenAI

from app.agent_tools import BROKER_DATA_TOOLS, BrokerAgentContext
from app.services import broker_chat, llm_config
from db.models import BrokerChatRun
from db.session import SessionLocal

BROKER_CHAT_INSTRUCTIONS = """
You are Market-Stack's broker data assistant.

Use the broker tools whenever the user asks about connected broker accounts,
portfolio state, positions, holdings, funds, live quotes, OHLC, historical data,
option chains, greeks, margin estimates, stream status, or broker sessions.

Important operating rules:
- Treat all broker data as user-owned private data.
- Never ask for broker API keys, tokens, PINs, passwords, or TOTP secrets in chat.
- If a tool returns action_required, explain the session/account action needed
  and do not invent market data.
- Prefer instrument search before quote or historical requests when the user
  provides only a plain symbol.
- Keep answers concise and cite the broker/account label when tool data includes it.
- Do not place, modify, cancel, or suggest that a trade has been executed.
"""


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
    final_text = ""
    tool_names_by_call_id: dict[str, str] = {}
    pending_tool_names: list[str] = []
    try:
        run = db.get(BrokerChatRun, run_id)
        if run is None:
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
        agent = Agent[BrokerAgentContext](
            name="Market-Stack Broker Data Agent",
            instructions=BROKER_CHAT_INSTRUCTIONS,
            model=_build_model(db, run),
            model_settings=ModelSettings(
                temperature=0.2,
                max_tokens=1800,
                include_usage=True,
            ),
            tools=BROKER_DATA_TOOLS,
        )
        messages = broker_chat.conversation_history_for_run(db, run)
        messages.append({"role": "user", "content": run.message})
        stream = Runner.run_streamed(
            starting_agent=agent,
            input=messages,
            context=context,
            max_turns=12,
        )

        async for event in stream.stream_events():
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
        broker_chat.mark_run_terminal(db, run, status="completed", response_text=final_text)
        db.refresh(run)
        broker_chat.append_event(
            db,
            run,
            event_type="run_completed",
            public_payload={"status": "completed", "response_text": final_text},
        )
    except Exception as exc:
        run = db.get(BrokerChatRun, run_id)
        if run is not None:
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
        db.close()


def run_broker_chat_job(run_id: str) -> str:
    asyncio.run(_run_broker_chat(run_id))
    return run_id
