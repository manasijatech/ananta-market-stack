from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.schemas.alert import AlertWorkflowOut
from app.schemas.system_config import LlmProvider
from app.services import llm_gateway
from app.services.alert_llm_analysis import (
    _now_iso,
    _response_text,
    _usage_payload,
    run_workflow_llm_analysis,
    validate_llm_model,
)
from app.services.alert_llm_context import resolve_llm_context
from app.services.llm_usage import LlmTrackingContext


class FeedWorkflowCase(BaseModel):
    workflow_id: str
    workflow_name: str
    condition_prompt: str
    provider: LlmProvider
    model_id: str
    temperature: float = 0.1
    max_completion_tokens: int = 400
    timeout_seconds: int = 25
    batch_index: int = 0
    notification: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)


class FeedWorkflowVerdict(BaseModel):
    workflow_id: str
    matches: bool = False
    reason: str = ""
    confidence: float | int | None = None
    matched_terms: list[str] = Field(default_factory=list)
    error: str | None = None


class FeedBatchClassificationResult(BaseModel):
    results: list[FeedWorkflowVerdict] = Field(default_factory=list)
    diagnostics: dict[str, Any] = Field(default_factory=dict)


class FeedAnalysisCase(BaseModel):
    workflow_id: str
    workflow_name: str
    rendered_prompt: str
    provider: LlmProvider
    model_id: str
    temperature: float = 0.2
    max_completion_tokens: int = 500
    timeout_seconds: int = 25
    batch_index: int = 0
    context_errors: list[dict[str, Any]] = Field(default_factory=list)
    context_metadata: dict[str, Any] = Field(default_factory=dict)


class FeedAnalysisOutput(BaseModel):
    workflow_id: str
    output: str = ""
    error: str | None = None


class FeedBatchAnalysisResult(BaseModel):
    results: list[FeedAnalysisOutput] = Field(default_factory=list)
    diagnostics: dict[str, Any] = Field(default_factory=dict)


@dataclass(frozen=True)
class FeedAnalysisRequest:
    workflow: AlertWorkflowOut
    tick: dict[str, Any]
    reason: str
    evaluation_details: dict[str, Any]


def feed_case_from_workflow(
    workflow: AlertWorkflowOut,
    *,
    batch_index: int,
    metadata: dict[str, Any] | None = None,
) -> FeedWorkflowCase:
    trigger = workflow.workflow_dsl.feed_trigger
    if not trigger.provider or not trigger.model_id:
        raise ValueError("Feed trigger LLM provider and model are required")
    return FeedWorkflowCase(
        workflow_id=workflow.id,
        workflow_name=workflow.name,
        condition_prompt=trigger.condition_prompt.strip(),
        provider=trigger.provider,
        model_id=str(trigger.model_id),
        temperature=trigger.temperature,
        max_completion_tokens=trigger.max_completion_tokens,
        timeout_seconds=trigger.timeout_seconds,
        batch_index=batch_index,
        notification=workflow.workflow_dsl.notification.model_dump(),
        metadata=metadata or {},
    )


def _json_text(value: Any) -> str:
    return json.dumps(value, default=str, ensure_ascii=False, separators=(",", ":"))


def _extract_json_payload(text: str) -> Any:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`").strip()
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:].strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start >= 0 and end > start:
            return json.loads(cleaned[start : end + 1])
        start = cleaned.find("[")
        end = cleaned.rfind("]")
        if start >= 0 and end > start:
            return json.loads(cleaned[start : end + 1])
        raise


def _classification_from_text(text: str) -> FeedBatchClassificationResult:
    parsed = _extract_json_payload(text)
    if isinstance(parsed, list):
        parsed = {"results": parsed}
    if not isinstance(parsed, dict):
        parsed = {}
    raw_results = parsed.get("results")
    if not isinstance(raw_results, list):
        raw_results = []
    results: list[FeedWorkflowVerdict] = []
    for item in raw_results:
        if not isinstance(item, dict):
            continue
        matched_terms = item.get("matched_terms")
        if not isinstance(matched_terms, list):
            matched_terms = []
        results.append(
            FeedWorkflowVerdict(
                workflow_id=str(item.get("workflow_id") or ""),
                matches=bool(item.get("matches")),
                reason=str(item.get("reason") or ""),
                confidence=item.get("confidence"),
                matched_terms=[str(term) for term in matched_terms],
                error=str(item.get("error")) if item.get("error") else None,
            )
        )
    diagnostics = parsed.get("diagnostics") if isinstance(parsed.get("diagnostics"), dict) else {}
    return FeedBatchClassificationResult(results=results, diagnostics=diagnostics)


def _analysis_from_text(text: str) -> FeedBatchAnalysisResult:
    parsed = _extract_json_payload(text)
    if isinstance(parsed, list):
        parsed = {"results": parsed}
    if not isinstance(parsed, dict):
        parsed = {}
    raw_results = parsed.get("results")
    if not isinstance(raw_results, list):
        raw_results = []
    results: list[FeedAnalysisOutput] = []
    for item in raw_results:
        if not isinstance(item, dict):
            continue
        results.append(
            FeedAnalysisOutput(
                workflow_id=str(item.get("workflow_id") or ""),
                output=str(item.get("output") or ""),
                error=str(item.get("error")) if item.get("error") else None,
            )
        )
    diagnostics = parsed.get("diagnostics") if isinstance(parsed.get("diagnostics"), dict) else {}
    return FeedBatchAnalysisResult(results=results, diagnostics=diagnostics)


def _group_key(case: FeedWorkflowCase | FeedAnalysisCase) -> tuple[str, str, float, int, int]:
    return (
        str(case.provider),
        str(case.model_id),
        float(case.temperature),
        int(case.max_completion_tokens),
        int(case.timeout_seconds),
    )


def _batched_token_limit(base_limit: int, item_count: int) -> int:
    return min(max(base_limit, base_limit * max(item_count, 1)), 8000)


def _result_metadata(
    *,
    batch_id: str,
    batch_size: int,
    group_size: int,
    case: FeedWorkflowCase | FeedAnalysisCase,
    alpha_event_id: str,
    event_key: str,
    raw_output: str | None = None,
    parse_error: str | None = None,
) -> dict[str, Any]:
    return {
        "batch_id": batch_id,
        "batch_size": batch_size,
        "batch_index": case.batch_index,
        "group_size": group_size,
        "alpha_event_id": alpha_event_id,
        "event_key": event_key,
        "raw_output": raw_output,
        "parse_error": parse_error,
    }


def run_feed_trigger_batches(
    db: Session,
    *,
    user_id: str,
    event_id: str,
    event_key: str,
    product: str,
    payload: dict[str, Any],
    cases: list[FeedWorkflowCase],
) -> dict[str, dict[str, Any]]:
    batch_id = str(uuid.uuid4())
    if not cases:
        return {}
    grouped: dict[tuple[str, str, float, int, int], list[FeedWorkflowCase]] = {}
    for case in cases:
        grouped.setdefault(_group_key(case), []).append(case)

    out: dict[str, dict[str, Any]] = {}
    for group_cases in grouped.values():
        first = group_cases[0]
        try:
            validate_llm_model(db, user_id, first.provider, first.model_id)
            developer_prompt = (
                "You classify one Manasija websocket market-data event against multiple independent alert workflow conditions. "
                "Return only strict JSON matching this schema: "
                '{"results":[{"workflow_id":"string","matches":boolean,"reason":"string","confidence":number,'
                '"matched_terms":["string"],"error":null|string}],"diagnostics":{}}. '
                "Return exactly one result for every workflow_id. Use only the provided event and condition text. Do not add markdown."
            )
            user_text = _json_text(
                {
                    "product": product,
                    "event": payload,
                    "workflow_cases": [
                        {
                            "workflow_id": case.workflow_id,
                            "workflow_name": case.workflow_name,
                            "condition_prompt": case.condition_prompt,
                        }
                        for case in group_cases
                    ],
                }
            )
            response = llm_gateway.generate_text(
                db,
                user_id,
                first.provider,
                model=first.model_id,
                developer_prompt=developer_prompt,
                user_text=user_text,
                temperature=first.temperature,
                max_completion_tokens=_batched_token_limit(first.max_completion_tokens, len(group_cases)),
                timeout=float(first.timeout_seconds),
                tracking=LlmTrackingContext(
                    request_kind="workflow_feed_trigger_batch",
                    workflow_type="alpha_feed",
                    metadata={
                        "alpha_product": product,
                        "alpha_event_id": event_id,
                        "event_key": event_key,
                        "batch_id": batch_id,
                        "workflow_count": len(group_cases),
                        "workflow_ids": [case.workflow_id for case in group_cases],
                    },
                ),
            )
            text = _response_text(response)
            usage = _usage_payload(response)
            parsed = _classification_from_text(text)
            by_id = {item.workflow_id: item for item in parsed.results if item.workflow_id}
            for case in group_cases:
                verdict = by_id.get(case.workflow_id)
                parse_error = None if verdict else "LLM response did not include this workflow_id"
                out[case.workflow_id] = {
                    "matches": bool(verdict.matches) if verdict else False,
                    "reason": (verdict.reason if verdict else "") or "",
                    "confidence": verdict.confidence if verdict else None,
                    "matched_terms": verdict.matched_terms if verdict else [],
                    "error": verdict.error if verdict else parse_error,
                    "status": "error" if (verdict and verdict.error) or parse_error else "success",
                    "provider": case.provider,
                    "model_id": case.model_id,
                    "raw_output": text,
                    "usage": usage,
                    "batch": _result_metadata(
                        batch_id=batch_id,
                        batch_size=len(cases),
                        group_size=len(group_cases),
                        case=case,
                        alpha_event_id=event_id,
                        event_key=event_key,
                        raw_output=text,
                        parse_error=parse_error,
                    ),
                    "diagnostics": parsed.diagnostics,
                }
        except Exception as exc:
            message = str(exc)
            for case in group_cases:
                out[case.workflow_id] = {
                    "matches": False,
                    "reason": "",
                    "confidence": None,
                    "matched_terms": [],
                    "error": message,
                    "status": "error",
                    "provider": case.provider,
                    "model_id": case.model_id,
                    "raw_output": "",
                    "usage": {},
                    "batch": _result_metadata(
                        batch_id=batch_id,
                        batch_size=len(cases),
                        group_size=len(group_cases),
                        case=case,
                        alpha_event_id=event_id,
                        event_key=event_key,
                        parse_error=message,
                    ),
                    "diagnostics": {},
                }
    return out


def run_followup_analysis_batches(
    db: Session,
    *,
    user_id: str,
    event_id: str,
    event_key: str,
    product: str,
    requests: list[FeedAnalysisRequest],
) -> dict[str, dict[str, Any]]:
    batch_id = str(uuid.uuid4())
    out: dict[str, dict[str, Any]] = {}
    cases: list[tuple[FeedAnalysisCase, FeedAnalysisRequest]] = []
    for index, request in enumerate(requests):
        config = request.workflow.workflow_dsl.llm_analysis
        if not config.enabled:
            out[request.workflow.id] = {"enabled": False, "status": "disabled", "output": "", "ran_at": _now_iso()}
            continue
        context = resolve_llm_context(
            db,
            workflow=request.workflow,
            tick=request.tick,
            previous_tick={},
            reason=request.reason,
            evaluation_details=request.evaluation_details,
        )
        if not config.provider or not config.model_id:
            out[request.workflow.id] = {
                "enabled": True,
                "status": "error",
                "provider": config.provider,
                "model_id": config.model_id,
                "output": "",
                "context_errors": context["context_errors"],
                "context_metadata": context["metadata"],
                "ran_at": _now_iso(),
                "error": "LLM provider and model are required when analysis is enabled",
            }
            continue
        cases.append(
            (
                FeedAnalysisCase(
                    workflow_id=request.workflow.id,
                    workflow_name=request.workflow.name,
                    rendered_prompt=context["rendered_prompt"],
                    provider=config.provider,
                    model_id=str(config.model_id),
                    temperature=config.temperature,
                    max_completion_tokens=config.max_completion_tokens,
                    timeout_seconds=config.timeout_seconds,
                    batch_index=index,
                    context_errors=context["context_errors"],
                    context_metadata=context["metadata"],
                ),
                request,
            )
        )

    grouped: dict[tuple[str, str, float, int, int], list[tuple[FeedAnalysisCase, FeedAnalysisRequest]]] = {}
    for item in cases:
        grouped.setdefault(_group_key(item[0]), []).append(item)

    for group_items in grouped.values():
        first_case = group_items[0][0]
        try:
            validate_llm_model(db, user_id, first_case.provider, first_case.model_id)
            developer_prompt = (
                "You are a concise Indian-market alert analyst. "
                "Analyze each workflow prompt independently and explain only what is supported by its provided context. "
                "Return only strict JSON matching this schema: "
                '{"results":[{"workflow_id":"string","output":"string","error":null|string}],"diagnostics":{}}. '
                "Return exactly one result for every workflow_id. Do not add markdown."
            )
            user_text = _json_text(
                {
                    "product": product,
                    "alpha_event_id": event_id,
                    "analysis_cases": [
                        {
                            "workflow_id": case.workflow_id,
                            "workflow_name": case.workflow_name,
                            "rendered_prompt": case.rendered_prompt,
                        }
                        for case, _request in group_items
                    ],
                }
            )
            response = llm_gateway.generate_text(
                db,
                user_id,
                first_case.provider,
                model=first_case.model_id,
                developer_prompt=developer_prompt,
                user_text=user_text,
                temperature=first_case.temperature,
                max_completion_tokens=_batched_token_limit(first_case.max_completion_tokens, len(group_items)),
                timeout=float(first_case.timeout_seconds),
                tracking=LlmTrackingContext(
                    request_kind="workflow_followup_analysis_batch",
                    workflow_type="alpha_feed",
                    metadata={
                        "alpha_product": product,
                        "alpha_event_id": event_id,
                        "event_key": event_key,
                        "batch_id": batch_id,
                        "workflow_count": len(group_items),
                        "workflow_ids": [case.workflow_id for case, _request in group_items],
                    },
                ),
            )
            text = _response_text(response)
            usage = _usage_payload(response)
            parsed = _analysis_from_text(text)
            by_id = {item.workflow_id: item for item in parsed.results if item.workflow_id}
            for case, _request in group_items:
                item = by_id.get(case.workflow_id)
                parse_error = None if item else "LLM response did not include this workflow_id"
                out[case.workflow_id] = {
                    "enabled": True,
                    "status": "error" if (item and item.error) or parse_error else "success",
                    "provider": case.provider,
                    "model_id": case.model_id,
                    "output": (item.output if item else "") or "",
                    "context_errors": case.context_errors,
                    "context_metadata": case.context_metadata,
                    "ran_at": _now_iso(),
                    "error": item.error if item else parse_error,
                    "usage": usage,
                    "batch": _result_metadata(
                        batch_id=batch_id,
                        batch_size=len(cases),
                        group_size=len(group_items),
                        case=case,
                        alpha_event_id=event_id,
                        event_key=event_key,
                        raw_output=text,
                        parse_error=parse_error,
                    ),
                    "diagnostics": parsed.diagnostics,
                }
        except Exception:
            for case, request in group_items:
                out[case.workflow_id] = run_workflow_llm_analysis(
                    db,
                    workflow=request.workflow,
                    tick=request.tick,
                    previous_tick={},
                    reason=request.reason,
                    evaluation_details=request.evaluation_details,
                    request_kind="workflow_followup_analysis",
                )
                out[case.workflow_id]["batch_fallback"] = {
                    "batch_id": batch_id,
                    "alpha_event_id": event_id,
                    "event_key": event_key,
                    "reason": "batch follow-up analysis failed",
                }
    return out
