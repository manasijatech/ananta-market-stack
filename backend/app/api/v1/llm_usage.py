from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.deps import get_current_principal
from app.schemas.llm_usage import (
    LlmUsageEventsPageOut,
    LlmUsageFilterOut,
    LlmUsageGranularity,
    LlmUsageOverviewOut,
    LlmUsageTimeseriesOut,
)
from app.services import llm_usage as llm_usage_svc
from app.services import rbac
from app.services.rbac import Principal
from db.session import get_db

router = APIRouter()


def _filters(
    *,
    date_from: date | None = None,
    date_to: date | None = None,
    provider: str | None = None,
    model_id: str | None = None,
    workflow_id: str | None = None,
    request_kind: str | None = None,
    api_surface: str | None = None,
) -> LlmUsageFilterOut:
    return LlmUsageFilterOut(
        date_from=date_from,
        date_to=date_to,
        provider=provider,
        model_id=model_id,
        workflow_id=workflow_id,
        request_kind=request_kind,
        api_surface=api_surface,
    )


@router.get(
    "/overview",
    response_model=LlmUsageOverviewOut,
    summary="LLM usage overview",
    description=(
        "Returns dashboard-level LLM usage aggregates across all tracked providers and workflow tasks. "
        "This endpoint is backed by durable daily snapshots, so historical workflow usage remains available "
        "even if the original workflow is later deleted or disabled."
    ),
)
def get_llm_usage_overview(
    date_from: date | None = Query(default=None, description="Inclusive lower date bound in UTC, YYYY-MM-DD."),
    date_to: date | None = Query(default=None, description="Inclusive upper date bound in UTC, YYYY-MM-DD."),
    provider: str | None = Query(default=None, description="Optional provider filter."),
    model_id: str | None = Query(default=None, description="Optional exact model id filter."),
    workflow_id: str | None = Query(default=None, description="Optional workflow id filter."),
    request_kind: str | None = Query(default=None, description="Optional backend request-kind filter."),
    api_surface: str | None = Query(default=None, description="Optional SDK API surface filter."),
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> LlmUsageOverviewOut:
    rbac.require_workspace_permission(principal, rbac.SETTINGS_VIEW_LLM_USAGE)
    return llm_usage_svc.usage_overview(
        db,
        principal.user.id,
        filters=_filters(
            date_from=date_from,
            date_to=date_to,
            provider=provider,
            model_id=model_id,
            workflow_id=workflow_id,
            request_kind=request_kind,
            api_surface=api_surface,
        ),
    )


@router.get(
    "/timeseries",
    response_model=LlmUsageTimeseriesOut,
    summary="LLM usage timeseries",
    description=(
        "Returns ordered daily, weekly, or monthly LLM usage buckets for charting. "
        "Costs only reflect provider-reported values; no local price estimation is applied."
    ),
)
def get_llm_usage_timeseries(
    granularity: LlmUsageGranularity = Query(
        default="daily",
        description="Bucket granularity: daily, weekly, or monthly.",
    ),
    date_from: date | None = Query(default=None, description="Inclusive lower date bound in UTC, YYYY-MM-DD."),
    date_to: date | None = Query(default=None, description="Inclusive upper date bound in UTC, YYYY-MM-DD."),
    provider: str | None = Query(default=None, description="Optional provider filter."),
    model_id: str | None = Query(default=None, description="Optional exact model id filter."),
    workflow_id: str | None = Query(default=None, description="Optional workflow id filter."),
    request_kind: str | None = Query(default=None, description="Optional backend request-kind filter."),
    api_surface: str | None = Query(default=None, description="Optional SDK API surface filter."),
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> LlmUsageTimeseriesOut:
    rbac.require_workspace_permission(principal, rbac.SETTINGS_VIEW_LLM_USAGE)
    return llm_usage_svc.usage_timeseries(
        db,
        principal.user.id,
        filters=_filters(
            date_from=date_from,
            date_to=date_to,
            provider=provider,
            model_id=model_id,
            workflow_id=workflow_id,
            request_kind=request_kind,
            api_surface=api_surface,
        ),
        granularity=granularity,
    )


@router.get(
    "/events",
    response_model=LlmUsageEventsPageOut,
    summary="Recent LLM usage events",
    description=(
        "Returns the most recent normalized per-request LLM usage events, including provider usage details, "
        "latency, workflow metadata, and provider-reported cost when available."
    ),
)
def get_llm_usage_events(
    limit: int = Query(default=100, ge=1, le=500, description="Maximum number of usage events to return."),
    date_from: date | None = Query(default=None, description="Inclusive lower date bound in UTC, YYYY-MM-DD."),
    date_to: date | None = Query(default=None, description="Inclusive upper date bound in UTC, YYYY-MM-DD."),
    provider: str | None = Query(default=None, description="Optional provider filter."),
    model_id: str | None = Query(default=None, description="Optional exact model id filter."),
    workflow_id: str | None = Query(default=None, description="Optional workflow id filter."),
    request_kind: str | None = Query(default=None, description="Optional backend request-kind filter."),
    api_surface: str | None = Query(default=None, description="Optional SDK API surface filter."),
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> LlmUsageEventsPageOut:
    rbac.require_workspace_permission(principal, rbac.SETTINGS_VIEW_LLM_USAGE)
    return llm_usage_svc.list_usage_events(
        db,
        principal.user.id,
        filters=_filters(
            date_from=date_from,
            date_to=date_to,
            provider=provider,
            model_id=model_id,
            workflow_id=workflow_id,
            request_kind=request_kind,
            api_surface=api_surface,
        ),
        limit=limit,
    )
