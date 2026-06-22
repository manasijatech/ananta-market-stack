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
    BrokerChatRunOut,
    BrokerChatSessionOut,
    BrokerChatSubmitIn,
)
from app.services import llm_config, rbac
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


def preference_to_schema(pref: UserBrokerChatPreference) -> BrokerChatPreferenceOut:
    return BrokerChatPreferenceOut(
        default_provider=pref.default_provider or None,
        default_model=pref.default_model or None,
        event_visibility=pref.event_visibility or "minimal",
        include_tool_outputs=bool(pref.include_tool_outputs),
        include_reasoning=bool(pref.include_reasoning),
        use_mcp=bool(pref.use_mcp),
        mcp_server_ids=json_loads(pref.mcp_server_ids_json, []),
    )


def get_preference(db: Session, user_id: str) -> BrokerChatPreferenceOut:
    return preference_to_schema(get_or_create_preference(db, user_id))


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
    mcp_allowed = rbac.user_has_workspace_permission(db, user_id, rbac.SETTINGS_USE_MCP) or rbac.user_has_workspace_permission(
        db, user_id, rbac.SETTINGS_MANAGE_MCP
    )
    pref.use_mcp = bool(payload.use_mcp and mcp_allowed)
    pref.mcp_server_ids_json = json_dumps(payload.mcp_server_ids if mcp_allowed else [])
    db.add(pref)
    db.commit()
    db.refresh(pref)
    return preference_to_schema(pref)


def _default_title(message: str) -> str:
    cleaned = " ".join(message.strip().split())
    if not cleaned:
        return "Broker chat"
    return cleaned[:80]


def create_session(db: Session, user_id: str, title: str | None = None) -> BrokerChatSession:
    ensure_user(db, user_id)
    now = utc_now()
    row = BrokerChatSession(
        id=str(uuid.uuid4()),
        user_id=user_id,
        title=(title or "Broker chat").strip()[:256] or "Broker chat",
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


def list_sessions(db: Session, user_id: str, *, limit: int = 50) -> list[BrokerChatSessionOut]:
    rows = list(
        db.scalars(
            select(BrokerChatSession)
            .where(BrokerChatSession.user_id == user_id)
            .order_by(BrokerChatSession.updated_at.desc(), BrokerChatSession.id.desc())
            .limit(max(1, min(limit, 200)))
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
    return provider, model


def create_run(
    db: Session,
    user_id: str,
    payload: BrokerChatSubmitIn,
) -> BrokerChatRun:
    ensure_user(db, user_id)
    pref = get_or_create_preference(db, user_id)
    if payload.session_id:
        session = get_owned_session(db, user_id, payload.session_id)
    else:
        session = create_session(db, user_id, payload.session_title or _default_title(payload.message))
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
    if active_run is not None:
        raise ValueError("A broker chat run is already active in this session. Stop it or wait for it to finish.")
    provider, model = _resolve_provider_model(db, user_id, payload, pref)
    now = utc_now()
    mcp_allowed = rbac.user_has_workspace_permission(db, user_id, rbac.SETTINGS_USE_MCP) or rbac.user_has_workspace_permission(
        db, user_id, rbac.SETTINGS_MANAGE_MCP
    )
    requested_use_mcp = pref.use_mcp if payload.use_mcp is None else payload.use_mcp
    use_mcp = bool(requested_use_mcp and mcp_allowed)
    requested_server_ids = payload.mcp_server_ids if payload.mcp_server_ids is not None else json_loads(pref.mcp_server_ids_json, [])
    mcp_server_ids = requested_server_ids if mcp_allowed else []
    run = BrokerChatRun(
        id=str(uuid.uuid4()),
        session_id=session.id,
        user_id=user_id,
        status="queued",
        provider=provider,
        model_id=model,
        message=payload.message.strip(),
        event_visibility=payload.event_visibility or pref.event_visibility or "minimal",
        include_tool_outputs=(
            pref.include_tool_outputs if payload.include_tool_outputs is None else payload.include_tool_outputs
        ),
        include_reasoning=pref.include_reasoning if payload.include_reasoning is None else payload.include_reasoning,
        metadata_json=json_dumps(
            {
                **payload.metadata,
                "default_account_id": payload.default_account_id,
                "search_account_id": payload.search_account_id,
                "use_mcp": bool(use_mcp),
                "mcp_server_ids": mcp_server_ids,
            }
        ),
        queued_at=now,
        created_at=now,
        updated_at=now,
    )
    db.add(run)
    session.updated_at = now
    db.add(session)
    db.commit()
    db.refresh(run)
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
    if run.status != "queued":
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

    Queued runs are re-enqueued onto this app instance's scoped RQ queue. Runs
    that were marked running before a restart are moved back to queued so the
    local in-process worker or any dedicated worker can pick them up again.
    """

    rows = list(
        db.scalars(
            select(BrokerChatRun)
            .where(BrokerChatRun.status.in_(ACTIVE_STATUSES))
            .order_by(BrokerChatRun.created_at.asc(), BrokerChatRun.id.asc())
            .limit(max(1, min(limit, 1000)))
        ).all()
    )
    requeued = 0
    running_reset = 0
    running_kept = 0
    failed = 0
    for run in rows:
        try:
            if run.status == "running":
                status = broker_chat_job_status(run.id)
                if status in {"queued", "started"}:
                    running_kept += 1
                    continue
                run.status = "queued"
                run.error = None
                run.updated_at = utc_now()
                db.add(run)
                db.commit()
                db.refresh(run)
                running_reset += 1
            run.job_id = ensure_broker_chat_job_queued(run.id)
            run.updated_at = utc_now()
            db.add(run)
            db.commit()
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


def list_runs(
    db: Session,
    user_id: str,
    *,
    session_id: str | None = None,
    limit: int = 50,
) -> list[BrokerChatRunOut]:
    stmt = select(BrokerChatRun).where(BrokerChatRun.user_id == user_id)
    if session_id:
        stmt = stmt.where(BrokerChatRun.session_id == session_id)
    rows = list(
        db.scalars(
            stmt.order_by(BrokerChatRun.created_at.desc(), BrokerChatRun.id.desc()).limit(max(1, min(limit, 200)))
        ).all()
    )
    for row in rows:
        reconcile_run_queue_state(db, row)
    return [BrokerChatRunOut.model_validate(row) for row in rows]


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


def cancel_run(db: Session, user_id: str, run_id: str) -> BrokerChatRun:
    run = get_owned_run(db, user_id, run_id)
    if run.status in TERMINAL_STATUSES:
        return run
    request_broker_chat_cancel(run.id)
    cancel_broker_chat_job(run.id)
    mark_run_terminal(db, run, status="cancelled", response_text=run.response_text, error=None)
    db.refresh(run)
    append_event_once(
        db,
        run,
        event_type="run_cancelled",
        public_payload={"status": "cancelled"},
    )
    return run


def run_to_schema(run: BrokerChatRun) -> BrokerChatRunOut:
    return BrokerChatRunOut.model_validate(run)


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
            stmt.order_by(BrokerChatEvent.sequence.asc()).limit(max(1, min(limit, 500)))
        ).all()
    )
    effective_visibility = visibility or run.event_visibility
    include_reasoning_value = run.include_reasoning if include_reasoning is None else include_reasoning
    visible_rows = [
        row
        for row in rows
        if row.event_type != "reasoning" or include_reasoning_value
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
        run=run_to_schema(run),
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
) -> BrokerChatRun:
    now = utc_now()
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
    return run


def conversation_history_for_run(db: Session, run: BrokerChatRun, *, limit: int | None = None) -> list[dict[str, str]]:
    history_limit = limit or get_settings().broker_chat_history_turn_limit
    rows = list(
        db.scalars(
            select(BrokerChatRun)
            .where(
                BrokerChatRun.session_id == run.session_id,
                BrokerChatRun.id != run.id,
                BrokerChatRun.status == "completed",
            )
            .order_by(BrokerChatRun.created_at.desc(), BrokerChatRun.id.desc())
            .limit(max(0, history_limit))
        ).all()
    )
    messages: list[dict[str, str]] = []
    for previous in reversed(rows):
        messages.append({"role": "user", "content": previous.message})
        if previous.response_text:
            messages.append({"role": "assistant", "content": previous.response_text})
    return messages
