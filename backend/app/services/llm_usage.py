from __future__ import annotations

import json
import logging
import uuid
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.schemas.alert import AlertWorkflowOut
from app.schemas.llm_usage import (
    LlmUsageEventOut,
    LlmUsageEventsPageOut,
    LlmUsageFilterOut,
    LlmUsageGranularity,
    LlmUsageGroupOut,
    LlmUsageOverviewOut,
    LlmUsageTimeBucketOut,
    LlmUsageTimeseriesOut,
    LlmUsageTotalsOut,
    WorkflowLlmUsageSummaryOut,
)
from db.models import LlmUsageDailySnapshot, LlmUsageEvent
from db.session import SessionLocal

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class LlmTrackingContext:
    request_kind: str
    workflow_id: str | None = None
    workflow_name: str | None = None
    workflow_status: str | None = None
    workflow_type: str | None = None
    template_id: str | None = None
    account_id: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


def workflow_tracking_context(
    workflow: AlertWorkflowOut,
    *,
    request_kind: str,
    metadata: dict[str, Any] | None = None,
) -> LlmTrackingContext:
    return LlmTrackingContext(
        request_kind=request_kind,
        workflow_id=workflow.id,
        workflow_name=workflow.name,
        workflow_status=workflow.status,
        workflow_type=workflow.workflow_dsl.workflow_type,
        template_id=workflow.template_id,
        account_id=workflow.account_id,
        metadata=metadata or {},
    )


def _utc_now() -> datetime:
    return datetime.now(tz=UTC).replace(tzinfo=None)


def _date_utc(value: datetime) -> date:
    return value.date()


def _json_dumps(value: Any) -> str:
    return json.dumps(value, default=str, separators=(",", ":"))


def _json_loads(value: str | None, default: Any) -> Any:
    if not value:
        return default
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return default


def _as_plain_data(value: Any) -> Any:
    if value is None:
        return None
    if hasattr(value, "model_dump"):
        return value.model_dump()
    if isinstance(value, dict):
        return {str(k): _as_plain_data(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_as_plain_data(item) for item in value]
    if hasattr(value, "__dict__"):
        return {str(k): _as_plain_data(v) for k, v in vars(value).items() if not k.startswith("_")}
    return value


def _as_int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _as_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def normalize_usage_payload(response: Any, provider: str) -> dict[str, Any]:
    raw_usage = _as_plain_data(getattr(response, "usage", None)) or {}
    if not isinstance(raw_usage, dict):
        raw_usage = {}
    prompt_details = raw_usage.get("prompt_tokens_details")
    completion_details = raw_usage.get("completion_tokens_details")
    if not isinstance(prompt_details, dict):
        prompt_details = {}
    if not isinstance(completion_details, dict):
        completion_details = {}
    provider_cost = _as_float(raw_usage.get("cost"))
    provider_cost_currency = "credits" if provider == "openrouter" and provider_cost is not None else None
    return {
        "prompt_tokens": _as_int(raw_usage.get("prompt_tokens")),
        "completion_tokens": _as_int(raw_usage.get("completion_tokens")),
        "total_tokens": _as_int(raw_usage.get("total_tokens")),
        "cached_tokens": _as_int(prompt_details.get("cached_tokens")),
        "cache_write_tokens": _as_int(prompt_details.get("cache_write_tokens")),
        "reasoning_tokens": _as_int(completion_details.get("reasoning_tokens")),
        "input_audio_tokens": _as_int(prompt_details.get("audio_tokens")),
        "output_audio_tokens": _as_int(completion_details.get("audio_tokens")),
        "image_tokens": _as_int(completion_details.get("image_tokens")),
        "video_tokens": _as_int(prompt_details.get("video_tokens")),
        "provider_cost": provider_cost,
        "provider_cost_currency": provider_cost_currency,
        "is_byok": raw_usage.get("is_byok") if isinstance(raw_usage.get("is_byok"), bool) else None,
        "cost_details": raw_usage.get("cost_details") if isinstance(raw_usage.get("cost_details"), dict) else {},
        "prompt_tokens_details": prompt_details,
        "completion_tokens_details": completion_details,
        "raw_usage": raw_usage,
    }


def record_llm_usage(
    *,
    user_id: str,
    provider: str,
    requested_model_id: str,
    api_surface: str,
    started_at: datetime,
    completed_at: datetime,
    status: str,
    tracking: LlmTrackingContext | None = None,
    response: Any = None,
    error: str | None = None,
) -> None:
    normalized = normalize_usage_payload(response, provider) if response is not None else {
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "total_tokens": 0,
        "cached_tokens": 0,
        "cache_write_tokens": 0,
        "reasoning_tokens": 0,
        "input_audio_tokens": 0,
        "output_audio_tokens": 0,
        "image_tokens": 0,
        "video_tokens": 0,
        "provider_cost": None,
        "provider_cost_currency": None,
        "is_byok": None,
        "cost_details": {},
        "prompt_tokens_details": {},
        "completion_tokens_details": {},
        "raw_usage": {},
    }
    effective_model_id = str(getattr(response, "model", None) or requested_model_id)
    provider_response_id = getattr(response, "id", None)
    latency_ms = max(int((completed_at - started_at).total_seconds() * 1000), 0)
    tracking = tracking or LlmTrackingContext(request_kind="generic")
    workflow_ref = tracking.workflow_id or ""

    db = SessionLocal()
    try:
        row = LlmUsageEvent(
            id=str(uuid.uuid4()),
            user_id=user_id,
            provider=provider,
            model_id=effective_model_id,
            api_surface=api_surface,
            request_kind=tracking.request_kind,
            status=status,
            provider_response_id=str(provider_response_id) if provider_response_id else None,
            workflow_ref=workflow_ref,
            workflow_id=tracking.workflow_id,
            workflow_name=tracking.workflow_name,
            workflow_status=tracking.workflow_status,
            workflow_type=tracking.workflow_type,
            template_id=tracking.template_id,
            account_id=tracking.account_id,
            prompt_tokens=normalized["prompt_tokens"],
            completion_tokens=normalized["completion_tokens"],
            total_tokens=normalized["total_tokens"],
            cached_tokens=normalized["cached_tokens"],
            cache_write_tokens=normalized["cache_write_tokens"],
            reasoning_tokens=normalized["reasoning_tokens"],
            input_audio_tokens=normalized["input_audio_tokens"],
            output_audio_tokens=normalized["output_audio_tokens"],
            image_tokens=normalized["image_tokens"],
            video_tokens=normalized["video_tokens"],
            provider_cost=normalized["provider_cost"],
            provider_cost_currency=normalized["provider_cost_currency"],
            latency_ms=latency_ms,
            is_byok=normalized["is_byok"],
            usage_json=_json_dumps(
                {
                    "prompt_tokens": normalized["prompt_tokens"],
                    "completion_tokens": normalized["completion_tokens"],
                    "total_tokens": normalized["total_tokens"],
                    "cached_tokens": normalized["cached_tokens"],
                    "cache_write_tokens": normalized["cache_write_tokens"],
                    "reasoning_tokens": normalized["reasoning_tokens"],
                    "input_audio_tokens": normalized["input_audio_tokens"],
                    "output_audio_tokens": normalized["output_audio_tokens"],
                    "image_tokens": normalized["image_tokens"],
                    "video_tokens": normalized["video_tokens"],
                    "prompt_tokens_details": normalized["prompt_tokens_details"],
                    "completion_tokens_details": normalized["completion_tokens_details"],
                    "raw_usage": normalized["raw_usage"],
                }
            ),
            cost_details_json=_json_dumps(normalized["cost_details"]),
            metadata_json=_json_dumps(tracking.metadata),
            error=error,
            started_at=started_at,
            completed_at=completed_at,
        )
        db.add(row)
        _upsert_daily_snapshot(db, row)
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("failed to record llm usage")
    finally:
        db.close()


def _upsert_daily_snapshot(db: Session, row: LlmUsageEvent) -> None:
    bucket_date = _date_utc(row.completed_at)
    snapshot = db.scalars(
        select(LlmUsageDailySnapshot).where(
            LlmUsageDailySnapshot.user_id == row.user_id,
            LlmUsageDailySnapshot.bucket_date == bucket_date,
            LlmUsageDailySnapshot.provider == row.provider,
            LlmUsageDailySnapshot.model_id == row.model_id,
            LlmUsageDailySnapshot.api_surface == row.api_surface,
            LlmUsageDailySnapshot.request_kind == row.request_kind,
            LlmUsageDailySnapshot.workflow_ref == row.workflow_ref,
        )
    ).first()
    if snapshot is None:
        snapshot = LlmUsageDailySnapshot(
            id=str(uuid.uuid4()),
            user_id=row.user_id,
            bucket_date=bucket_date,
            provider=row.provider,
            model_id=row.model_id,
            api_surface=row.api_surface,
            request_kind=row.request_kind,
            workflow_ref=row.workflow_ref,
            workflow_id=row.workflow_id,
            workflow_name=row.workflow_name,
            workflow_status=row.workflow_status,
            workflow_type=row.workflow_type,
            template_id=row.template_id,
            account_id=row.account_id,
            request_count=0,
            success_count=0,
            error_count=0,
            prompt_tokens=0,
            completion_tokens=0,
            total_tokens=0,
            cached_tokens=0,
            cache_write_tokens=0,
            reasoning_tokens=0,
            input_audio_tokens=0,
            output_audio_tokens=0,
            image_tokens=0,
            video_tokens=0,
            provider_cost_total=0.0,
            priced_request_count=0,
            last_request_at=row.completed_at,
        )
    snapshot.workflow_id = row.workflow_id
    snapshot.workflow_name = row.workflow_name
    snapshot.workflow_status = row.workflow_status
    snapshot.workflow_type = row.workflow_type
    snapshot.template_id = row.template_id
    snapshot.account_id = row.account_id
    snapshot.request_count = int(snapshot.request_count or 0) + 1
    if row.status == "success":
        snapshot.success_count = int(snapshot.success_count or 0) + 1
    else:
        snapshot.error_count = int(snapshot.error_count or 0) + 1
    snapshot.prompt_tokens = int(snapshot.prompt_tokens or 0) + row.prompt_tokens
    snapshot.completion_tokens = int(snapshot.completion_tokens or 0) + row.completion_tokens
    snapshot.total_tokens = int(snapshot.total_tokens or 0) + row.total_tokens
    snapshot.cached_tokens = int(snapshot.cached_tokens or 0) + row.cached_tokens
    snapshot.cache_write_tokens = int(snapshot.cache_write_tokens or 0) + row.cache_write_tokens
    snapshot.reasoning_tokens = int(snapshot.reasoning_tokens or 0) + row.reasoning_tokens
    snapshot.input_audio_tokens = int(snapshot.input_audio_tokens or 0) + row.input_audio_tokens
    snapshot.output_audio_tokens = int(snapshot.output_audio_tokens or 0) + row.output_audio_tokens
    snapshot.image_tokens = int(snapshot.image_tokens or 0) + row.image_tokens
    snapshot.video_tokens = int(snapshot.video_tokens or 0) + row.video_tokens
    if row.provider_cost is not None:
        snapshot.provider_cost_total = float(snapshot.provider_cost_total or 0.0) + float(row.provider_cost)
        snapshot.priced_request_count = int(snapshot.priced_request_count or 0) + 1
    snapshot.last_request_at = row.completed_at
    db.add(snapshot)


def _apply_snapshot_filters(stmt, user_id: str, filters: LlmUsageFilterOut):
    stmt = stmt.where(LlmUsageDailySnapshot.user_id == user_id)
    if filters.date_from is not None:
        stmt = stmt.where(LlmUsageDailySnapshot.bucket_date >= filters.date_from)
    if filters.date_to is not None:
        stmt = stmt.where(LlmUsageDailySnapshot.bucket_date <= filters.date_to)
    if filters.provider:
        stmt = stmt.where(LlmUsageDailySnapshot.provider == filters.provider)
    if filters.model_id:
        stmt = stmt.where(LlmUsageDailySnapshot.model_id == filters.model_id)
    if filters.workflow_id:
        stmt = stmt.where(LlmUsageDailySnapshot.workflow_id == filters.workflow_id)
    if filters.request_kind:
        stmt = stmt.where(LlmUsageDailySnapshot.request_kind == filters.request_kind)
    if filters.api_surface:
        stmt = stmt.where(LlmUsageDailySnapshot.api_surface == filters.api_surface)
    return stmt


def _apply_event_filters(stmt, user_id: str, filters: LlmUsageFilterOut):
    stmt = stmt.where(LlmUsageEvent.user_id == user_id)
    if filters.date_from is not None:
        stmt = stmt.where(func.date(LlmUsageEvent.completed_at) >= filters.date_from)
    if filters.date_to is not None:
        stmt = stmt.where(func.date(LlmUsageEvent.completed_at) <= filters.date_to)
    if filters.provider:
        stmt = stmt.where(LlmUsageEvent.provider == filters.provider)
    if filters.model_id:
        stmt = stmt.where(LlmUsageEvent.model_id == filters.model_id)
    if filters.workflow_id:
        stmt = stmt.where(LlmUsageEvent.workflow_id == filters.workflow_id)
    if filters.request_kind:
        stmt = stmt.where(LlmUsageEvent.request_kind == filters.request_kind)
    if filters.api_surface:
        stmt = stmt.where(LlmUsageEvent.api_surface == filters.api_surface)
    return stmt


def _totals_from_rows(rows: list[LlmUsageDailySnapshot]) -> LlmUsageTotalsOut:
    totals = LlmUsageTotalsOut()
    for row in rows:
        totals.request_count += row.request_count
        totals.success_count += row.success_count
        totals.error_count += row.error_count
        totals.prompt_tokens += row.prompt_tokens
        totals.completion_tokens += row.completion_tokens
        totals.total_tokens += row.total_tokens
        totals.cached_tokens += row.cached_tokens
        totals.cache_write_tokens += row.cache_write_tokens
        totals.reasoning_tokens += row.reasoning_tokens
        totals.input_audio_tokens += row.input_audio_tokens
        totals.output_audio_tokens += row.output_audio_tokens
        totals.image_tokens += row.image_tokens
        totals.video_tokens += row.video_tokens
        totals.provider_cost_total += float(row.provider_cost_total or 0.0)
        totals.priced_request_count += row.priced_request_count
    return totals


def _group_rows(
    rows: list[LlmUsageDailySnapshot],
    key_fn,
    value_fn,
) -> list[LlmUsageGroupOut]:
    grouped: dict[tuple[Any, ...], dict[str, Any]] = {}
    for row in rows:
        key = key_fn(row)
        current = grouped.setdefault(
            key,
            {
                **value_fn(row),
                "request_count": 0,
                "success_count": 0,
                "error_count": 0,
                "prompt_tokens": 0,
                "completion_tokens": 0,
                "total_tokens": 0,
                "cached_tokens": 0,
                "cache_write_tokens": 0,
                "reasoning_tokens": 0,
                "input_audio_tokens": 0,
                "output_audio_tokens": 0,
                "image_tokens": 0,
                "video_tokens": 0,
                "provider_cost_total": 0.0,
                "priced_request_count": 0,
                "last_request_at": row.last_request_at,
            },
        )
        current["request_count"] += row.request_count
        current["success_count"] += row.success_count
        current["error_count"] += row.error_count
        current["prompt_tokens"] += row.prompt_tokens
        current["completion_tokens"] += row.completion_tokens
        current["total_tokens"] += row.total_tokens
        current["cached_tokens"] += row.cached_tokens
        current["cache_write_tokens"] += row.cache_write_tokens
        current["reasoning_tokens"] += row.reasoning_tokens
        current["input_audio_tokens"] += row.input_audio_tokens
        current["output_audio_tokens"] += row.output_audio_tokens
        current["image_tokens"] += row.image_tokens
        current["video_tokens"] += row.video_tokens
        current["provider_cost_total"] += float(row.provider_cost_total or 0.0)
        current["priced_request_count"] += row.priced_request_count
        if row.last_request_at and (current["last_request_at"] is None or row.last_request_at > current["last_request_at"]):
            current["last_request_at"] = row.last_request_at
    result = [LlmUsageGroupOut(**payload) for payload in grouped.values()]
    result.sort(key=lambda item: (item.provider_cost_total, item.total_tokens, item.request_count), reverse=True)
    return result


def _bucket_identity(bucket_date: date, granularity: LlmUsageGranularity) -> tuple[str, str, date, date]:
    if granularity == "daily":
        key = bucket_date.isoformat()
        return key, key, bucket_date, bucket_date
    if granularity == "weekly":
        iso_year, iso_week, _ = bucket_date.isocalendar()
        start = bucket_date - timedelta(days=bucket_date.weekday())
        end = start + timedelta(days=6)
        key = f"{iso_year}-W{iso_week:02d}"
        return key, key, start, end
    start = bucket_date.replace(day=1)
    if start.month == 12:
        end = date(start.year + 1, 1, 1) - timedelta(days=1)
    else:
        end = date(start.year, start.month + 1, 1) - timedelta(days=1)
    key = f"{start.year}-{start.month:02d}"
    return key, key, start, end


def list_usage_events(
    db: Session,
    user_id: str,
    *,
    filters: LlmUsageFilterOut,
    limit: int = 100,
) -> LlmUsageEventsPageOut:
    stmt = _apply_event_filters(select(LlmUsageEvent), user_id, filters)
    rows = db.scalars(stmt.order_by(LlmUsageEvent.completed_at.desc()).limit(limit)).all()
    return LlmUsageEventsPageOut(
        generated_at=_utc_now(),
        filters=filters,
        limit=limit,
        items=[
            LlmUsageEventOut(
                id=row.id,
                provider=row.provider,
                model_id=row.model_id,
                api_surface=row.api_surface,
                request_kind=row.request_kind,
                status=row.status,
                provider_response_id=row.provider_response_id,
                workflow_id=row.workflow_id,
                workflow_name=row.workflow_name,
                workflow_status=row.workflow_status,
                workflow_type=row.workflow_type,
                template_id=row.template_id,
                account_id=row.account_id,
                prompt_tokens=row.prompt_tokens,
                completion_tokens=row.completion_tokens,
                total_tokens=row.total_tokens,
                cached_tokens=row.cached_tokens,
                cache_write_tokens=row.cache_write_tokens,
                reasoning_tokens=row.reasoning_tokens,
                input_audio_tokens=row.input_audio_tokens,
                output_audio_tokens=row.output_audio_tokens,
                image_tokens=row.image_tokens,
                video_tokens=row.video_tokens,
                provider_cost=row.provider_cost,
                provider_cost_currency=row.provider_cost_currency,
                latency_ms=row.latency_ms,
                is_byok=row.is_byok,
                usage=_json_loads(row.usage_json, {}),
                cost_details=_json_loads(row.cost_details_json, {}),
                metadata=_json_loads(row.metadata_json, {}),
                error=row.error,
                started_at=row.started_at,
                completed_at=row.completed_at,
                created_at=row.created_at,
            )
            for row in rows
        ],
    )


def usage_overview(db: Session, user_id: str, *, filters: LlmUsageFilterOut) -> LlmUsageOverviewOut:
    all_rows = db.scalars(_apply_snapshot_filters(select(LlmUsageDailySnapshot), user_id, filters)).all()
    today = _utc_now().date()
    week_start = today - timedelta(days=today.weekday())
    month_start = today.replace(day=1)
    today_rows = [row for row in all_rows if row.bucket_date == today]
    week_rows = [row for row in all_rows if row.bucket_date >= week_start]
    month_rows = [row for row in all_rows if row.bucket_date >= month_start]
    return LlmUsageOverviewOut(
        generated_at=_utc_now(),
        filters=filters,
        totals=_totals_from_rows(all_rows),
        today=_totals_from_rows(today_rows),
        current_week=_totals_from_rows(week_rows),
        current_month=_totals_from_rows(month_rows),
        by_provider=_group_rows(
            all_rows,
            key_fn=lambda row: (row.provider,),
            value_fn=lambda row: {"provider": row.provider},
        ),
        by_model=_group_rows(
            all_rows,
            key_fn=lambda row: (row.provider, row.model_id),
            value_fn=lambda row: {"provider": row.provider, "model_id": row.model_id},
        ),
        top_workflows=_group_rows(
            [row for row in all_rows if row.workflow_ref],
            key_fn=lambda row: (row.workflow_ref, row.request_kind, row.provider, row.model_id),
            value_fn=lambda row: {
                "workflow_id": row.workflow_id,
                "workflow_name": row.workflow_name,
                "workflow_status": row.workflow_status,
                "workflow_type": row.workflow_type,
                "request_kind": row.request_kind,
                "provider": row.provider,
                "model_id": row.model_id,
            },
        )[:20],
        request_kinds=_group_rows(
            all_rows,
            key_fn=lambda row: (row.request_kind,),
            value_fn=lambda row: {"request_kind": row.request_kind},
        ),
        notes=[
            "provider_cost_total only includes cost returned by the provider response; no local pricing estimates are injected.",
            "historical workflow usage is retained even after workflow deletion because workflow identity is denormalized into the ledger.",
            "daily snapshots are updated at write time and power weekly/monthly aggregations without requiring the source workflow to remain active.",
        ],
    )


def usage_timeseries(
    db: Session,
    user_id: str,
    *,
    filters: LlmUsageFilterOut,
    granularity: LlmUsageGranularity,
) -> LlmUsageTimeseriesOut:
    rows = db.scalars(
        _apply_snapshot_filters(select(LlmUsageDailySnapshot), user_id, filters).order_by(LlmUsageDailySnapshot.bucket_date.asc())
    ).all()
    grouped: dict[str, dict[str, Any]] = {}
    for row in rows:
        key, label, bucket_start, bucket_end = _bucket_identity(row.bucket_date, granularity)
        current = grouped.setdefault(
            key,
            {
                "bucket_key": key,
                "bucket_label": label,
                "bucket_start": bucket_start,
                "bucket_end": bucket_end,
                "request_count": 0,
                "success_count": 0,
                "error_count": 0,
                "prompt_tokens": 0,
                "completion_tokens": 0,
                "total_tokens": 0,
                "cached_tokens": 0,
                "cache_write_tokens": 0,
                "reasoning_tokens": 0,
                "input_audio_tokens": 0,
                "output_audio_tokens": 0,
                "image_tokens": 0,
                "video_tokens": 0,
                "provider_cost_total": 0.0,
                "priced_request_count": 0,
            },
        )
        current["request_count"] += row.request_count
        current["success_count"] += row.success_count
        current["error_count"] += row.error_count
        current["prompt_tokens"] += row.prompt_tokens
        current["completion_tokens"] += row.completion_tokens
        current["total_tokens"] += row.total_tokens
        current["cached_tokens"] += row.cached_tokens
        current["cache_write_tokens"] += row.cache_write_tokens
        current["reasoning_tokens"] += row.reasoning_tokens
        current["input_audio_tokens"] += row.input_audio_tokens
        current["output_audio_tokens"] += row.output_audio_tokens
        current["image_tokens"] += row.image_tokens
        current["video_tokens"] += row.video_tokens
        current["provider_cost_total"] += float(row.provider_cost_total or 0.0)
        current["priced_request_count"] += row.priced_request_count
    buckets = [LlmUsageTimeBucketOut(**payload) for _, payload in sorted(grouped.items())]
    return LlmUsageTimeseriesOut(
        generated_at=_utc_now(),
        granularity=granularity,
        filters=filters,
        buckets=buckets,
    )


def workflow_usage_summary(
    db: Session,
    user_id: str,
    *,
    workflow_id: str,
    date_from: date | None = None,
    date_to: date | None = None,
) -> WorkflowLlmUsageSummaryOut:
    filters = LlmUsageFilterOut(workflow_id=workflow_id, date_from=date_from, date_to=date_to)
    rows = db.scalars(_apply_snapshot_filters(select(LlmUsageDailySnapshot), user_id, filters)).all()
    return WorkflowLlmUsageSummaryOut(
        workflow_id=workflow_id,
        filters=filters,
        totals=_totals_from_rows(rows),
        daily=usage_timeseries(db, user_id, filters=filters, granularity="daily").buckets,
        request_kinds=_group_rows(
            rows,
            key_fn=lambda row: (row.request_kind,),
            value_fn=lambda row: {
                "request_kind": row.request_kind,
                "workflow_id": row.workflow_id,
                "workflow_name": row.workflow_name,
                "workflow_status": row.workflow_status,
                "workflow_type": row.workflow_type,
            },
        ),
    )
