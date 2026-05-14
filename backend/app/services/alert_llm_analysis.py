from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.schemas.alert import AlertWorkflowOut
from app.services import llm_gateway
from app.services.alert_llm_context import resolve_llm_context
from db.models import UserLlmModel


def _now_iso() -> str:
    return datetime.now(tz=UTC).isoformat().replace("+00:00", "Z")


def _response_text(response: Any) -> str:
    choices = getattr(response, "choices", None)
    if choices:
        message = getattr(choices[0], "message", None)
        content = getattr(message, "content", None)
        if isinstance(content, str):
            return content.strip()
    output_text = getattr(response, "output_text", None)
    if isinstance(output_text, str):
        return output_text.strip()
    return str(response).strip()


def _usage_payload(response: Any) -> dict[str, Any]:
    usage = getattr(response, "usage", None)
    if usage is None:
        return {}
    if hasattr(usage, "model_dump"):
        return usage.model_dump()
    if isinstance(usage, dict):
        return usage
    return {
        key: getattr(usage, key)
        for key in ("prompt_tokens", "completion_tokens", "total_tokens")
        if getattr(usage, key, None) is not None
    }


def validate_llm_model(db: Session, user_id: str, provider: str | None, model_id: str | None) -> None:
    if not provider or not model_id:
        raise ValueError("LLM provider and model are required when analysis is enabled")
    row = db.scalars(
        select(UserLlmModel).where(
            UserLlmModel.user_id == user_id,
            UserLlmModel.provider == provider,
            UserLlmModel.model_id == model_id,
            UserLlmModel.is_enabled.is_(True),
        )
    ).first()
    if row is None:
        raise ValueError("Selected LLM model is not saved or enabled for this user")


def run_workflow_llm_analysis(
    db: Session,
    *,
    workflow: AlertWorkflowOut,
    tick: dict[str, Any],
    previous_tick: dict[str, Any] | None = None,
    reason: str = "",
    evaluation_details: dict[str, Any] | None = None,
    call_llm: bool = True,
) -> dict[str, Any]:
    config = workflow.workflow_dsl.llm_analysis
    if not config.enabled:
        return {"enabled": False, "status": "disabled", "output": "", "ran_at": _now_iso()}

    context = resolve_llm_context(
        db,
        workflow=workflow,
        tick=tick,
        previous_tick=previous_tick,
        reason=reason,
        evaluation_details=evaluation_details,
    )
    result: dict[str, Any] = {
        "enabled": True,
        "status": "context_ready",
        "provider": config.provider,
        "model_id": config.model_id,
        "output": "",
        "context_errors": context["context_errors"],
        "context_metadata": context["metadata"],
        "ran_at": _now_iso(),
    }
    if not call_llm:
        result["status"] = "preview"
        result["context"] = context
        return result
    try:
        validate_llm_model(db, workflow.user_id, config.provider, config.model_id)
        response = llm_gateway.generate_text(
            db,
            workflow.user_id,
            config.provider,  # type: ignore[arg-type]
            model=str(config.model_id),
            developer_prompt="You are a concise Indian-market alert analyst. Explain only what is supported by the provided context.",
            user_text=context["rendered_prompt"],
            temperature=config.temperature,
            max_completion_tokens=config.max_completion_tokens,
            timeout=float(config.timeout_seconds),
        )
        result["status"] = "success"
        result["output"] = _response_text(response)
        result["usage"] = _usage_payload(response)
    except Exception as exc:
        result["status"] = "error"
        result["error"] = str(exc)
    return result
