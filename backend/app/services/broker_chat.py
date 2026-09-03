from __future__ import annotations

import json
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.schemas.broker_chat import (
    BrokerChatEventOut,
    BrokerChatEventsPageOut,
    BrokerChatPreferenceOut,
    BrokerChatPreferenceUpdateIn,
    BrokerChatRetryPolicyOut,
    BrokerChatRunOut,
    BrokerChatSessionOut,
    BrokerChatSubmitIn,
)
from app.agent_harness.evidence import HIDDEN_EVENT_TYPES
from app.agent_harness.retry_policy import clamp_user_retry, resolve_agent_retry_policy
from app.services import llm_config, mcp_config, rbac
from app.services.broker_chat_queue import (
    cancel_broker_chat_job,
    broker_chat_job_status,
    clear_broker_chat_cancel,
    broker_chat_stream_key,
    enqueue_broker_chat_run,
    ensure_broker_chat_job_queued,
    request_broker_chat_cancel,
    redis_connection,
)
from app.config import get_settings
from common.datetime_compat import UTC
from db.models import (
    BrokerChatEvent,
    BrokerChatRun,
    BrokerChatSession,
    User,
    UserBrokerChatPreference,
)

TERMINAL_STATUSES = {"completed", "failed", "cancelled"}
ACTIVE_STATUSES = {"queued", "running"}
RUNNING_STATUS = "running"
QUEUED_STATUS = "queued"
BROKER_CHAT_SURFACE = "broker_chat"
ADAPTIVE_WORKSPACE_SURFACE = "adaptive_workspace"
VALID_SESSION_SURFACES = {BROKER_CHAT_SURFACE, ADAPTIVE_WORKSPACE_SURFACE}


def _safe_reasoning_effort(value: Any) -> str | None:
    try:
        return llm_config.normalize_reasoning_effort(value)
    except ValueError:
        return None


def utc_now() -> datetime:
    return datetime.now(tz=UTC).replace(tzinfo=None)


def json_dumps(value: Any) -> str:
    return json.dumps(value, default=str, ensure_ascii=False, separators=(",", ":"))


def json_loads(value: str | None, default: Any) -> Any:
    if not value:
        return default
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return default


def ensure_user(db: Session, user_id: str) -> User:
    user = db.get(User, user_id)
    if user:
        return user
    user = User(id=user_id, display_name=None)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def get_or_create_preference(db: Session, user_id: str) -> UserBrokerChatPreference:
    ensure_user(db, user_id)
    pref = db.get(UserBrokerChatPreference, user_id)
    if pref is not None:
        return pref
    pref = UserBrokerChatPreference(user_id=user_id)
    db.add(pref)
    db.commit()
    db.refresh(pref)
    return pref


def _retry_schema(pref: UserBrokerChatPreference) -> BrokerChatRetryPolicyOut:
    policy = resolve_agent_retry_policy(getattr(pref, "retry_json", None))
    return BrokerChatRetryPolicyOut(**policy.user_facing())


def preference_to_schema(db: Session, pref: UserBrokerChatPreference) -> BrokerChatPreferenceOut:
    resolved_ids, _dropped = mcp_config.resolve_mcp_server_ids(db, pref.user_id, json_loads(pref.mcp_server_ids_json, []))
    return BrokerChatPreferenceOut(
        default_provider=pref.default_provider or None,
        default_model=pref.default_model or None,
        event_visibility=pref.event_visibility or "full",
        include_tool_outputs=bool(pref.include_tool_outputs) if pref.include_tool_outputs is not None else True,
        include_reasoning=bool(pref.include_reasoning),
        reasoning_effort=_safe_reasoning_effort(getattr(pref, "reasoning_effort", None)),
        use_mcp=bool(pref.use_mcp),
        mcp_server_ids=resolved_ids,
        retry=_retry_schema(pref),
    )


def get_preference(db: Session, user_id: str) -> BrokerChatPreferenceOut:
    return preference_to_schema(db, get_or_create_preference(db, user_id))


def update_preference(
    db: Session,
    user_id: str,
    payload: BrokerChatPreferenceUpdateIn,
) -> BrokerChatPreferenceOut:
    pref = get_or_create_preference(db, user_id)
    if payload.default_provider:
        llm_config.provider_definition(payload.default_provider)
    pref.default_provider = payload.default_provider
    pref.default_model = payload.default_model
    pref.event_visibility = payload.event_visibility
    pref.include_tool_outputs = payload.include_tool_outputs
    pref.include_reasoning = payload.include_reasoning
    pref.reasoning_effort = _safe_reasoning_effort(payload.reasoning_effort)
    mcp_allowed = rbac.user_has_workspace_permission(db, user_id, rbac.SETTINGS_USE_MCP) or rbac.user_has_workspace_permission(
        db, user_id, rbac.SETTINGS_MANAGE_MCP
    )
    pref.use_mcp = bool(payload.use_mcp and mcp_allowed)
    resolved_ids, _dropped = mcp_config.resolve_mcp_server_ids(db, user_id, payload.mcp_server_ids if mcp_allowed else [])
    pref.mcp_server_ids_json = json_dumps(resolved_ids if mcp_allowed else [])
    if payload.retry is not None:
        pref.retry_json = json_dumps(
            clamp_user_retry(payload.retry.model_dump(), env_policy=resolve_agent_retry_policy())
        )
    db.add(pref)
    db.commit()
    db.refresh(pref)
    return preference_to_schema(db, pref)


PLACEHOLDER_SESSION_TITLES = frozenset(
    {
        "broker chat",
        "adaptive workspace",
        "new broker chat",
        "chat",
    }
)


def _default_title(message: str) -> str:
    cleaned = " ".join(message.strip().split())
    if not cleaned:
        return "Broker chat"
    return cleaned[:80]


def _is_placeholder_session_title(title: str | None) -> bool:
    return (title or "").strip().lower() in PLACEHOLDER_SESSION_TITLES


def _maybe_retitle_session(session: BrokerChatSession, message: str) -> None:
    if not _is_placeholder_session_title(session.title):
        return
    next_title = _default_title(message)
    if _is_placeholder_session_title(next_title):
        return
    session.title = next_title


def _normalize_surface(surface: str | None, *, default: str = BROKER_CHAT_SURFACE) -> str:
    if surface is None or not str(surface).strip():
        return default
    normalized = str(surface).strip()
    if normalized not in VALID_SESSION_SURFACES:
        raise ValueError(f"unsupported broker chat surface: {normalized}")
    return normalized


def _run_is_adaptive(payload: BrokerChatSubmitIn) -> bool:
    return bool(payload.metadata.get("adaptive_workspace"))


def _assert_session_surface_allows_run(session: BrokerChatSession, *, adaptive: bool) -> None:
    session_surface = getattr(session, "surface", None) or BROKER_CHAT_SURFACE
    if adaptive and session_surface == BROKER_CHAT_SURFACE:
        raise ValueError("this session belongs to Broker Chat")
    if not adaptive and session_surface == ADAPTIVE_WORKSPACE_SURFACE:
        raise ValueError("this session belongs to Adaptive Workspace")


def create_session(
    db: Session,
    user_id: str,
    title: str | None = None,
    surface: str | None = None,
) -> BrokerChatSession:
    ensure_user(db, user_id)
    now = utc_now()
    row = BrokerChatSession(
        id=str(uuid.uuid4()),
        user_id=user_id,
        title=(title or "Broker chat").strip()[:256] or "Broker chat",
        surface=_normalize_surface(surface),
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def get_owned_session(db: Session, user_id: str, session_id: str) -> BrokerChatSession:
    row = db.get(BrokerChatSession, session_id)
    if not row or row.user_id != user_id:
        raise ValueError("broker chat session not found")
    return row


def list_sessions(
    db: Session,
    user_id: str,
    *,
    limit: int = 50,
    surface: str | None = BROKER_CHAT_SURFACE,
) -> list[BrokerChatSessionOut]:
    stmt = select(BrokerChatSession).where(BrokerChatSession.user_id == user_id)
    if surface is not None:
        stmt = stmt.where(BrokerChatSession.surface == _normalize_surface(surface))
    rows = list(
        db.scalars(
            stmt.order_by(BrokerChatSession.updated_at.desc(), BrokerChatSession.id.desc()).limit(
                max(1, min(limit, 200))
            )
        ).all()
    )
    return [BrokerChatSessionOut.model_validate(row) for row in rows]


def _resolve_provider_model(
    db: Session,
    user_id: str,
    payload: BrokerChatSubmitIn,
    pref: UserBrokerChatPreference,
) -> tuple[str, str]:
    provider = payload.provider or pref.default_provider
    model = payload.model or pref.default_model
    if provider:
        llm_config.provider_definition(provider)
    if not provider:
        providers = llm_config.list_provider_configs(db, user_id)
        configured = next((item for item in providers if item.is_enabled and item.has_api_key), None)
        provider = configured.provider if configured else None
    if not provider:
        raise ValueError("No enabled LLM provider is configured for broker chat.")
    if not model:
        models = llm_config.list_provider_models(db, user_id, provider)
        model = models[0].model_id if models else None
    if not model:
        raise ValueError("No broker chat model was provided or saved for the selected LLM provider.")
    return provider, llm_config.normalize_provider_model_id(provider, model)


def running_run_for_session(db: Session, session_id: str) -> BrokerChatRun | None:
    return db.scalars(
        select(BrokerChatRun)
        .where(
            BrokerChatRun.session_id == session_id,
            BrokerChatRun.status == RUNNING_STATUS,
        )
        .order_by(BrokerChatRun.started_at.asc(), BrokerChatRun.id.asc())
        .limit(1)
    ).first()


def queued_runs_for_session(db: Session, session_id: str) -> list[BrokerChatRun]:
    return list(
        db.scalars(
            select(BrokerChatRun)
            .where(
                BrokerChatRun.session_id == session_id,
                BrokerChatRun.status == QUEUED_STATUS,
            )
            .order_by(BrokerChatRun.queued_at.asc(), BrokerChatRun.id.asc())
        ).all()
    )


def queue_position_for_run(db: Session, run: BrokerChatRun) -> int | None:
    if run.status != QUEUED_STATUS:
        return None
    for index, item in enumerate(queued_runs_for_session(db, run.session_id), start=1):
        if item.id == run.id:
            return index
    return None


def session_queue_blocked(db: Session, session_id: str) -> bool:
    """True when a follow-up must wait (running or earlier queued head exists)."""
    return running_run_for_session(db, session_id) is not None or bool(queued_runs_for_session(db, session_id))


def start_next_queued_run(db: Session, session_id: str) -> BrokerChatRun | None:
    """Enqueue the oldest queued run for a session when nothing is running.

    Idempotent: safe to call after every terminal transition and from reconcile.
    """
    if running_run_for_session(db, session_id) is not None:
        return None
    queued = queued_runs_for_session(db, session_id)
    if not queued:
        return None
    next_run = queued[0]
    try:
        next_run.job_id = ensure_broker_chat_job_queued(next_run.id)
        next_run.updated_at = utc_now()
        db.add(next_run)
        db.commit()
        db.refresh(next_run)
    except Exception as exc:
        next_run.status = "failed"
        next_run.error = f"failed to enqueue broker chat run: {exc}"
        next_run.completed_at = utc_now()
        next_run.updated_at = next_run.completed_at
        db.add(next_run)
        db.commit()
        db.refresh(next_run)
        return start_next_queued_run(db, session_id)
    return next_run


def create_run(
    db: Session,
    user_id: str,
    payload: BrokerChatSubmitIn,
    *,
    strict_single_active: bool = False,
) -> BrokerChatRun:
    ensure_user(db, user_id)
    pref = get_or_create_preference(db, user_id)
    adaptive = _run_is_adaptive(payload)
    if payload.session_id:
        session = get_owned_session(db, user_id, payload.session_id)
        _assert_session_surface_allows_run(session, adaptive=adaptive)
    else:
        session = create_session(
            db,
            user_id,
            payload.session_title or _default_title(payload.message),
            surface=ADAPTIVE_WORKSPACE_SURFACE if adaptive else BROKER_CHAT_SURFACE,
        )
    active_run = db.scalars(
        select(BrokerChatRun)
        .where(
            BrokerChatRun.session_id == session.id,
            BrokerChatRun.user_id == user_id,
            BrokerChatRun.status.in_(ACTIVE_STATUSES),
        )
        .order_by(BrokerChatRun.created_at.desc(), BrokerChatRun.id.desc())
        .limit(1)
    ).first()
    if strict_single_active and active_run is not None:
        raise ValueError("A broker chat run is already active in this session. Stop it or wait for it to finish.")
    # At most one RQ job per session: enqueue now only when the session is idle.
    should_enqueue_now = not session_queue_blocked(db, session.id)
    existing_run_count = db.scalar(
        select(func.count())
        .select_from(BrokerChatRun)
        .where(BrokerChatRun.session_id == session.id)
    ) or 0
    provider, model = _resolve_provider_model(db, user_id, payload, pref)
    now = utc_now()
    mcp_allowed = rbac.user_has_workspace_permission(db, user_id, rbac.SETTINGS_USE_MCP) or rbac.user_has_workspace_permission(
        db, user_id, rbac.SETTINGS_MANAGE_MCP
    )
    requested_use_mcp = pref.use_mcp if payload.use_mcp is None else payload.use_mcp
    use_mcp = bool(requested_use_mcp and mcp_allowed)
    requested_server_ids = payload.mcp_server_ids if payload.mcp_server_ids is not None else json_loads(pref.mcp_server_ids_json, [])
    mcp_server_ids = (
        mcp_config.resolve_mcp_server_ids(db, user_id, requested_server_ids)[0] if mcp_allowed else []
    )
    override_effort = payload.reasoning_effort if payload.reasoning_effort is not None else pref.reasoning_effort
    try:
        reasoning_effort = llm_config.normalize_reasoning_effort(override_effort) or llm_config.get_model_reasoning_effort(
            db, user_id, provider, model
        )
    except ValueError as exc:
        raise ValueError(str(exc)) from exc
    metadata: dict[str, Any] = {
        **payload.metadata,
        "default_account_id": payload.default_account_id,
        "search_account_id": payload.search_account_id,
        "use_mcp": bool(use_mcp),
        "mcp_server_ids": mcp_server_ids,
        "reasoning_effort": reasoning_effort,
    }
    if not should_enqueue_now:
        # Audit the desk at enqueue time; the runner still binds to the latest
        # session spec when the follow-up actually starts (via tools / status bar).
        if "workspace_spec" in payload.metadata:
            metadata["spec_at_enqueue"] = payload.metadata.get("workspace_spec")
        if "selected_component_id" in payload.metadata:
            metadata["selected_component_id_at_enqueue"] = payload.metadata.get("selected_component_id")
        metadata["session_queue"] = True
    run = BrokerChatRun(
        id=str(uuid.uuid4()),
        session_id=session.id,
        user_id=user_id,
        status=QUEUED_STATUS,
        provider=provider,
        model_id=model,
        message=payload.message.strip(),
        event_visibility=payload.event_visibility or pref.event_visibility or "full",
        include_tool_outputs=(
            pref.include_tool_outputs if payload.include_tool_outputs is None else payload.include_tool_outputs
        ),
        include_reasoning=pref.include_reasoning if payload.include_reasoning is None else payload.include_reasoning,
        metadata_json=json_dumps(metadata),
        queued_at=now,
        created_at=now,
        updated_at=now,
    )
    db.add(run)
    session.updated_at = now
    if existing_run_count == 0:
        _maybe_retitle_session(session, payload.message)
    db.add(session)
    db.commit()
    db.refresh(run)
    if not should_enqueue_now:
        return run
    try:
        job_id = enqueue_broker_chat_run(run.id)
    except Exception as exc:
        run.status = "failed"
        run.error = f"failed to enqueue broker chat run: {exc}"
        run.completed_at = utc_now()
        run.updated_at = run.completed_at
        db.add(run)
        db.commit()
        db.refresh(run)
        raise
    run.job_id = job_id
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


def get_owned_run(db: Session, user_id: str, run_id: str) -> BrokerChatRun:
    row = db.get(BrokerChatRun, run_id)
    if not row or row.user_id != user_id:
        raise ValueError("broker chat run not found")
    reconcile_run_queue_state(db, row)
    return row


def reconcile_run_queue_state(db: Session, run: BrokerChatRun) -> BrokerChatRun:
    """Ensure only the session head is on RQ when nothing is running."""
    if run.status != QUEUED_STATUS:
        return run
    if running_run_for_session(db, run.session_id) is not None:
        return run
    queued = queued_runs_for_session(db, run.session_id)
    if not queued or queued[0].id != run.id:
        return run
    try:
        run.job_id = ensure_broker_chat_job_queued(run.id)
        run.updated_at = utc_now()
        db.add(run)
        db.commit()
        db.refresh(run)
    except Exception:
        pass
    return run


def reconcile_incomplete_runs(db: Session, *, limit: int = 200) -> dict[str, int]:
    """Repair queued/running broker-chat runs after process restarts.

    Per session: keep at most one live RQ job. Stale `running` rows without an
    active job fall back to `queued`; only the oldest queued run is enqueued.
    """

    rows = list(
        db.scalars(
            select(BrokerChatRun)
            .where(BrokerChatRun.status.in_(ACTIVE_STATUSES))
            .order_by(BrokerChatRun.created_at.asc(), BrokerChatRun.id.asc())
            .limit(max(1, min(limit, 1000)))
        ).all()
    )
    by_session: dict[str, list[BrokerChatRun]] = {}
    for run in rows:
        by_session.setdefault(run.session_id, []).append(run)

    requeued = 0
    running_reset = 0
    running_kept = 0
    failed = 0
    for session_id, session_runs in by_session.items():
        try:
            live_running = False
            for run in session_runs:
                if run.status != RUNNING_STATUS:
                    continue
                status = broker_chat_job_status(run.id)
                if status in {"queued", "started"}:
                    running_kept += 1
                    live_running = True
                    continue
                run.status = QUEUED_STATUS
                run.error = None
                run.updated_at = utc_now()
                db.add(run)
                db.commit()
                db.refresh(run)
                running_reset += 1
            if live_running:
                continue
            started = start_next_queued_run(db, session_id)
            if started is not None:
                requeued += 1
        except Exception:
            db.rollback()
            failed += 1
    return {
        "checked": len(rows),
        "requeued": requeued,
        "running_reset": running_reset,
        "running_kept": running_kept,
        "failed": failed,
    }


def run_to_schema(db: Session, run: BrokerChatRun) -> BrokerChatRunOut:
    out = BrokerChatRunOut.model_validate(run)
    out.queue_position = queue_position_for_run(db, run)
    return out


def list_session_queue(db: Session, user_id: str, session_id: str) -> list[BrokerChatRunOut]:
    get_owned_session(db, user_id, session_id)
    return [run_to_schema(db, run) for run in queued_runs_for_session(db, session_id)]


def list_runs(
    db: Session,
    user_id: str,
    *,
    session_id: str | None = None,
    surface: str | None = None,
    limit: int = 50,
) -> list[BrokerChatRunOut]:
    stmt = select(BrokerChatRun).where(BrokerChatRun.user_id == user_id)
    if session_id:
        stmt = stmt.where(BrokerChatRun.session_id == session_id)
    if surface is not None:
        stmt = stmt.join(BrokerChatSession, BrokerChatRun.session_id == BrokerChatSession.id).where(
            BrokerChatSession.surface == _normalize_surface(surface)
        )
    rows = list(
        db.scalars(
            stmt.order_by(BrokerChatRun.created_at.desc(), BrokerChatRun.id.desc()).limit(max(1, min(limit, 200)))
        ).all()
    )
    for row in rows:
        reconcile_run_queue_state(db, row)
    return [run_to_schema(db, row) for row in rows]


def delete_session(db: Session, user_id: str, session_id: str) -> None:
    session = get_owned_session(db, user_id, session_id)
    runs = list(
        db.scalars(select(BrokerChatRun).where(BrokerChatRun.session_id == session.id, BrokerChatRun.user_id == user_id))
    )
    for run in runs:
        if run.status in ACTIVE_STATUSES:
            request_broker_chat_cancel(run.id)
            cancel_broker_chat_job(run.id)
        try:
            redis_connection().delete(broker_chat_stream_key(run.id))
        except Exception:
            pass
    db.query(BrokerChatEvent).filter(
        BrokerChatEvent.session_id == session.id,
        BrokerChatEvent.user_id == user_id,
    ).delete(synchronize_session=False)
    db.query(BrokerChatRun).filter(
        BrokerChatRun.session_id == session.id,
        BrokerChatRun.user_id == user_id,
    ).delete(synchronize_session=False)
    db.delete(session)
    db.commit()


def cancel_run(
    db: Session,
    user_id: str,
    run_id: str,
    *,
    cancel_queued: bool = False,
) -> BrokerChatRun:
    run = get_owned_run(db, user_id, run_id)
    session_id = run.session_id
    if run.status in TERMINAL_STATUSES:
        if cancel_queued:
            cancel_queued_runs(db, user_id, session_id)
        return run
    request_broker_chat_cancel(run.id)
    cancel_broker_chat_job(run.id)
    mark_run_terminal(db, run, status="cancelled", response_text=run.response_text, error=None, start_next=False)
    db.refresh(run)
    append_event_once(
        db,
        run,
        event_type="run_cancelled",
        public_payload={"status": "cancelled"},
    )
    if cancel_queued:
        cancel_queued_runs(db, user_id, session_id)
    else:
        start_next_queued_run(db, session_id)
    db.refresh(run)
    return run


def cancel_queued_runs(db: Session, user_id: str, session_id: str) -> list[BrokerChatRun]:
    get_owned_session(db, user_id, session_id)
    cancelled: list[BrokerChatRun] = []
    for run in list(queued_runs_for_session(db, session_id)):
        if run.user_id != user_id:
            continue
        request_broker_chat_cancel(run.id)
        cancel_broker_chat_job(run.id)
        mark_run_terminal(db, run, status="cancelled", response_text=run.response_text, error=None, start_next=False)
        append_event_once(
            db,
            run,
            event_type="run_cancelled",
            public_payload={"status": "cancelled", "queued": True},
        )
        cancelled.append(run)
    return cancelled


def next_event_sequence(db: Session, run_id: str) -> int:
    value = db.scalar(select(func.max(BrokerChatEvent.sequence)).where(BrokerChatEvent.run_id == run_id))
    return int(value or 0) + 1


def _event_payload_for_visibility(
    row: BrokerChatEvent,
    *,
    visibility: str,
    include_tool_outputs: bool,
    include_reasoning: bool,
) -> dict[str, Any]:
    public_payload = json_loads(row.public_payload_json, {})
    if visibility == "minimal":
        return public_payload

    if visibility == "tool_calls":
        if row.event_type == "tool_call_completed":
            payload = {
                "tool_name": public_payload.get("tool_name"),
                "tool_call_id": public_payload.get("tool_call_id"),
            }
            if include_tool_outputs:
                full_payload = json_loads(row.full_payload_json, public_payload)
                if "output" in full_payload:
                    payload["output"] = full_payload.get("output")
            return {key: value for key, value in payload.items() if value is not None}
        return public_payload

    full_payload = json_loads(row.full_payload_json, public_payload)
    if row.event_type == "tool_call_completed" and not include_tool_outputs:
        full_payload.pop("output", None)
    if row.event_type == "reasoning" and not include_reasoning:
        return public_payload
    return full_payload


def event_to_schema(
    row: BrokerChatEvent,
    *,
    visibility: str,
    include_tool_outputs: bool,
    include_reasoning: bool,
) -> BrokerChatEventOut:
    return BrokerChatEventOut(
        id=row.id,
        run_id=row.run_id,
        sequence=row.sequence,
        event_type=row.event_type,
        payload=_event_payload_for_visibility(
            row,
            visibility=visibility,
            include_tool_outputs=include_tool_outputs,
            include_reasoning=include_reasoning,
        ),
        created_at=row.created_at,
    )


def list_events(
    db: Session,
    run: BrokerChatRun,
    *,
    after_sequence: int | None = None,
    limit: int = 200,
    visibility: str | None = None,
    include_tool_outputs: bool | None = None,
    include_reasoning: bool | None = None,
) -> BrokerChatEventsPageOut:
    stmt = select(BrokerChatEvent).where(BrokerChatEvent.run_id == run.id)
    if after_sequence is not None:
        stmt = stmt.where(BrokerChatEvent.sequence > after_sequence)
    rows = list(
        db.scalars(
            stmt.order_by(BrokerChatEvent.sequence.asc()).limit(max(1, min(limit, 2000)))
        ).all()
    )
    effective_visibility = visibility or run.event_visibility
    include_reasoning_value = run.include_reasoning if include_reasoning is None else include_reasoning
    visible_rows = [
        row
        for row in rows
        if row.event_type not in HIDDEN_EVENT_TYPES
        and (row.event_type != "reasoning" or include_reasoning_value)
    ]
    events = [
        event_to_schema(
            row,
            visibility=effective_visibility,
            include_tool_outputs=run.include_tool_outputs
            if include_tool_outputs is None
            else include_tool_outputs,
            include_reasoning=include_reasoning_value,
        )
        for row in visible_rows
    ]
    return BrokerChatEventsPageOut(
        run=run_to_schema(db, run),
        events=events,
        next_after_sequence=events[-1].sequence if events else after_sequence,
    )


def append_event(
    db: Session,
    run: BrokerChatRun,
    *,
    event_type: str,
    public_payload: dict[str, Any],
    full_payload: dict[str, Any] | None = None,
) -> BrokerChatEvent:
    sequence = next_event_sequence(db, run.id)
    now = utc_now()
    row = BrokerChatEvent(
        id=str(uuid.uuid4()),
        run_id=run.id,
        session_id=run.session_id,
        user_id=run.user_id,
        sequence=sequence,
        event_type=event_type,
        public_payload_json=json_dumps(public_payload),
        full_payload_json=json_dumps(full_payload or public_payload),
        created_at=now,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    try:
        client = redis_connection()
        stream_id = client.xadd(
            broker_chat_stream_key(run.id),
            {"payload": json_dumps({"sequence": sequence, "event_type": event_type})},
            maxlen=get_settings().broker_chat_stream_maxlen,
            approximate=True,
        )
        row.redis_stream_id = str(stream_id)
    except Exception:
        row.redis_stream_id = None
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def append_event_once(
    db: Session,
    run: BrokerChatRun,
    *,
    event_type: str,
    public_payload: dict[str, Any],
    full_payload: dict[str, Any] | None = None,
) -> BrokerChatEvent:
    existing = db.scalar(
        select(BrokerChatEvent)
        .where(BrokerChatEvent.run_id == run.id, BrokerChatEvent.event_type == event_type)
        .order_by(BrokerChatEvent.sequence.desc())
        .limit(1)
    )
    if existing is not None:
        return existing
    return append_event(
        db,
        run,
        event_type=event_type,
        public_payload=public_payload,
        full_payload=full_payload,
    )


def mark_run_running(db: Session, run: BrokerChatRun) -> BrokerChatRun:
    now = utc_now()
    run.status = "running"
    run.started_at = run.started_at or now
    run.updated_at = now
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


def mark_run_terminal(
    db: Session,
    run: BrokerChatRun,
    *,
    status: str,
    response_text: str = "",
    error: str | None = None,
    start_next: bool = True,
) -> BrokerChatRun:
    now = utc_now()
    session_id = run.session_id
    run.status = status
    run.response_text = response_text
    run.error = error
    run.completed_at = now
    run.updated_at = now
    session = db.get(BrokerChatSession, run.session_id)
    if session is not None:
        session.updated_at = now
        db.add(session)
    db.add(run)
    db.commit()
    db.refresh(run)
    if status in TERMINAL_STATUSES:
        try:
            clear_broker_chat_cancel(run.id)
        except Exception:
            pass
        if start_next:
            start_next_queued_run(db, session_id)
            db.refresh(run)
    return run


def conversation_history_for_run(db: Session, run: BrokerChatRun, *, limit: int | None = None) -> list[dict[str, str]]:
    from app.agent_harness.model_context import prior_turn_messages_for_run

    messages, _stats = prior_turn_messages_for_run(db, run, limit=limit)
    return messages
