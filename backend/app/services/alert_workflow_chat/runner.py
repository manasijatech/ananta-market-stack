from __future__ import annotations

import asyncio
import json
import re
from datetime import datetime
from typing import Any

from agents import Agent, ModelSettings, RunConfig, Runner
from agents.items import ItemHelpers
from agents.models.openai_chatcompletions import OpenAIChatCompletionsModel
from openai import AsyncOpenAI

from app.services import llm_config
from app.services.llm_usage import LlmTrackingContext, record_llm_usage
from app.services.alert_workflow_chat import sessions
from app.services.alert_workflow_chat.prompts import workflow_chat_instructions
from app.services.alert_workflow_chat.queue import alert_workflow_chat_cancel_requested
from app.services.alert_workflow_chat.serialization import json_loads, safe_data
from app.services.alert_workflow_chat.tools import WORKFLOW_CHAT_TOOLS, WorkflowChatContext
from db.models import AlertWorkflowChatRun
from db.session import SessionLocal
from common.datetime_compat import UTC


class WorkflowChatCancelled(Exception):
    pass


def _usage_response_from_raw_event(data: Any) -> Any:
    return getattr(data, "response", None) or data


def _record_workflow_chat_usage(
    run: AlertWorkflowChatRun,
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
            request_kind="alert_workflow_chat",
            workflow_id=run.workflow_id,
            metadata={"alert_workflow_chat_run_id": run.id, "alert_workflow_chat_session_id": run.session_id},
        ),
        response=response,
        error=error,
    )


def _build_model(db, run: AlertWorkflowChatRun) -> OpenAIChatCompletionsModel:
    definition = llm_config.provider_definition(run.provider)
    api_key = llm_config.get_provider_api_key(db, run.user_id, run.provider)
    return OpenAIChatCompletionsModel(
        model=run.model_id,
        openai_client=AsyncOpenAI(api_key=api_key, base_url=definition["base_url"], timeout=60.0),
        strict_feature_validation=False,
    )


def _json_from_maybe_string(value: Any) -> Any:
    if not isinstance(value, str):
        return safe_data(value)
    try:
        return json.loads(value)
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
    payload: dict[str, Any] = {"type": type(output).__name__, "length": len(text), "preview": text[:400]}
    if isinstance(output, dict):
        snapshot = output.get("snapshot")
        if isinstance(snapshot, dict):
            payload["snapshot_id"] = snapshot.get("id")
            payload["snapshot_valid"] = snapshot.get("valid")
            payload["snapshot_label"] = snapshot.get("label")
    return payload


def _deploy_requested(message: str) -> bool:
    return bool(re.search(r"\b(deploy|activate|go live|make it live)\b", message, flags=re.IGNORECASE))


async def _run_alert_workflow_chat(run_id: str) -> None:
    db = SessionLocal()
    final_text = ""
    tool_names_by_call_id: dict[str, str] = {}
    pending_tool_calls: list[tuple[str, str | None]] = []
    response_started_at = datetime.now(tz=UTC).replace(tzinfo=None)
    usage_events_recorded = 0
    try:
        run = db.get(AlertWorkflowChatRun, run_id)
        if run is None:
            return
        if run.status == "cancelled" or alert_workflow_chat_cancel_requested(run.id):
            sessions.mark_run_terminal(db, run, status="cancelled", response_text=run.response_text)
            sessions.append_event_once(db, run, event_type="run_cancelled", public_payload={"status": "cancelled"})
            return
        sessions.mark_run_running(db, run)
        db.refresh(run)
        sessions.append_event(
            db,
            run,
            event_type="run_started",
            public_payload={"status": "running", "provider": run.provider, "model": run.model_id},
        )
        metadata = json_loads(run.metadata_json, {})
        context = WorkflowChatContext(
            user_id=run.user_id,
            session_id=run.session_id,
            workflow_id=run.workflow_id or "",
            run_id=run.id,
            editor_payload=metadata.get("editor_payload") if isinstance(metadata.get("editor_payload"), dict) else {},
            deploy_allowed=_deploy_requested(run.message),
        )
        agent = Agent[WorkflowChatContext](
            name="Market-Stack Workflow AI Chat",
            instructions=workflow_chat_instructions(),
            model=_build_model(db, run),
            model_settings=ModelSettings(temperature=0.2, max_tokens=5000, include_usage=True),
            tools=WORKFLOW_CHAT_TOOLS,
        )
        messages = sessions.conversation_history_for_run(db, run)
        messages.append({"role": "user", "content": run.message})
        stream = Runner.run_streamed(
            starting_agent=agent,
            input=messages,
            context=context,
            max_turns=20,
            run_config=RunConfig(
                tracing_disabled=run.provider != "openai",
                workflow_name="Market-Stack alert workflow chat",
            ),
        )

        async for event in stream.stream_events():
            db.refresh(run)
            if run.status == "cancelled" or alert_workflow_chat_cancel_requested(run.id):
                raise WorkflowChatCancelled()
            event_type = getattr(event, "type", "")
            if event_type == "raw_response_event":
                data = getattr(event, "data", None)
                raw_type = getattr(data, "type", "")
                if raw_type == "response.output_text.delta":
                    delta = getattr(data, "delta", "")
                    if delta:
                        final_text += delta
                        sessions.append_event(
                            db,
                            run,
                            event_type="token",
                            public_payload={"text": delta},
                            full_payload={"text": delta, "raw_type": raw_type, "raw": safe_data(data)},
                        )
                elif raw_type == "response.created":
                    response_started_at = datetime.now(tz=UTC).replace(tzinfo=None)
                    sessions.append_event(
                        db,
                        run,
                        event_type="response_started",
                        public_payload={"response_id": getattr(data, "response_id", None)},
                        full_payload={"raw_type": raw_type, "raw": safe_data(data)},
                    )
                elif raw_type == "response.completed":
                    completed_at = datetime.now(tz=UTC).replace(tzinfo=None)
                    _record_workflow_chat_usage(
                        run,
                        response=_usage_response_from_raw_event(data),
                        started_at=response_started_at,
                        completed_at=completed_at,
                    )
                    usage_events_recorded += 1
                    sessions.append_event(
                        db,
                        run,
                        event_type="response_completed",
                        public_payload={"response_id": getattr(data, "response_id", None)},
                        full_payload={"raw_type": raw_type, "raw": safe_data(data)},
                    )
                continue
            if event_type == "run_item_stream_event":
                item = getattr(event, "item", None)
                item_type = getattr(item, "type", "")
                if item_type == "tool_call_item":
                    tool_name, arguments, call_id = _extract_tool_call_start(item)
                    if call_id:
                        tool_names_by_call_id[call_id] = tool_name
                    pending_tool_calls.append((tool_name, call_id))
                    sessions.append_event(
                        db,
                        run,
                        event_type="tool_call_started",
                        public_payload={"tool_name": tool_name, "tool_call_id": call_id, "arguments": arguments},
                        full_payload={"tool_name": tool_name, "tool_call_id": call_id, "arguments": arguments, "raw_item": safe_data(item)},
                    )
                elif item_type == "tool_call_output_item":
                    call_id, output = _extract_tool_call_output(item)
                    tool_name = tool_names_by_call_id.get(call_id or "", "unknown")
                    if tool_name == "unknown" and pending_tool_calls:
                        tool_name, pending_call_id = pending_tool_calls.pop(0)
                        call_id = call_id or pending_call_id
                    output_metadata = _output_preview(output)
                    sessions.append_event(
                        db,
                        run,
                        event_type="tool_call_completed",
                        public_payload={"tool_name": tool_name, "tool_call_id": call_id, "output_metadata": output_metadata},
                        full_payload={"tool_name": tool_name, "tool_call_id": call_id, "output": output, "output_metadata": output_metadata, "raw_item": safe_data(item)},
                    )
                    if (
                        isinstance(output, dict)
                        and isinstance(output.get("snapshot"), dict)
                        and isinstance(output.get("workflow"), dict)
                    ):
                        sessions.append_event(
                            db,
                            run,
                            event_type="snapshot_applied",
                            public_payload={"snapshot": output["snapshot"], "workflow": output["workflow"]},
                        )
                    elif isinstance(output, dict) and isinstance(output.get("snapshot"), dict):
                        sessions.append_event(
                            db,
                            run,
                            event_type="snapshot_created",
                            public_payload={"snapshot": output["snapshot"]},
                        )
                elif item_type == "message_output_item":
                    text = ItemHelpers.text_message_output(item)
                    if text:
                        final_text = text
                    sessions.append_event(
                        db,
                        run,
                        event_type="message_output",
                        public_payload={"content": text or final_text, "is_final": True},
                        full_payload={"content": text or final_text, "raw_item": safe_data(item), "is_final": True},
                    )
                continue

        if not final_text and getattr(stream, "final_output", None):
            final_text = str(stream.final_output)
        db.refresh(run)
        if run.status == "cancelled" or alert_workflow_chat_cancel_requested(run.id):
            raise WorkflowChatCancelled()
        sessions.mark_run_terminal(db, run, status="completed", response_text=final_text)
        db.refresh(run)
        sessions.append_event(
            db,
            run,
            event_type="run_completed",
            public_payload={"status": "completed", "response_text": final_text},
        )
    except WorkflowChatCancelled:
        run = db.get(AlertWorkflowChatRun, run_id)
        if run is not None:
            sessions.mark_run_terminal(db, run, status="cancelled", response_text=final_text, error=None)
            db.refresh(run)
            sessions.append_event_once(db, run, event_type="run_cancelled", public_payload={"status": "cancelled"})
    except Exception as exc:
        run = db.get(AlertWorkflowChatRun, run_id)
        if run is not None and run.status != "cancelled":
            if usage_events_recorded == 0:
                _record_workflow_chat_usage(
                    run,
                    started_at=response_started_at,
                    completed_at=datetime.now(tz=UTC).replace(tzinfo=None),
                    status="error",
                    error=str(exc),
                )
            sessions.mark_run_terminal(db, run, status="failed", response_text=final_text, error=str(exc))
            db.refresh(run)
            sessions.append_event(
                db,
                run,
                event_type="run_failed",
                public_payload={"status": "failed", "message": str(exc)},
                full_payload={"status": "failed", "message": str(exc), "error_type": exc.__class__.__name__},
            )
        raise
    finally:
        db.close()


def run_alert_workflow_chat_job(run_id: str) -> str:
    asyncio.run(_run_alert_workflow_chat(run_id))
    return run_id
