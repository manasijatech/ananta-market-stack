from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.schemas.alert import (
    AlertCondition,
    AlertGraphDsl,
    AlertWorkflowCreate,
    AlertWorkflowDsl,
)
from app.schemas.alert_workflow_chat import (
    AlertWorkflowChatEventOut,
    AlertWorkflowChatEventsPageOut,
    AlertWorkflowChatPreferenceOut,
    AlertWorkflowChatPreferenceUpdateIn,
    AlertWorkflowChatRunOut,
    AlertWorkflowChatSessionCreateIn,
    AlertWorkflowChatSessionOut,
    AlertWorkflowChatSubmitIn,
)
from app.services import alerts as alert_svc
from app.services import llm_config
from app.services.alert_workflow_chat.queue import (
    alert_workflow_chat_job_status,
    alert_workflow_chat_stream_key,
    cancel_alert_workflow_chat_job,
    clear_alert_workflow_chat_cancel,
    enqueue_alert_workflow_chat_run,
    ensure_alert_workflow_chat_job_queued,
    redis_connection,
    request_alert_workflow_chat_cancel,
)
from app.services.alert_workflow_chat.serialization import json_dumps, json_loads
from common.datetime_compat import UTC
from db.models import (
    AlertWorkflow,
    AlertWorkflowChatEvent,
    AlertWorkflowChatRun,
    AlertWorkflowChatSession,
    User,
    UserAlertWorkflowChatPreference,
)

TERMINAL_STATUSES = {"completed", "failed", "cancelled"}
ACTIVE_STATUSES = {"queued", "running"}


def utc_now() -> datetime:
    return datetime.now(tz=UTC).replace(tzinfo=None)


def ensure_user(db: Session, user_id: str) -> User:
    user = db.get(User, user_id)
    if user:
        return user
    user = User(id=user_id, display_name=None)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _default_draft_payload(title: str | None = None) -> AlertWorkflowCreate:
    return AlertWorkflowCreate(
        name=(title or "AI workflow draft").strip()[:128] or "AI workflow draft",
        description="Draft created from Workflow AI Chat.",
        symbol=None,
        exchange="NSE",
        workflow_dsl=AlertWorkflowDsl(
            workflow_type="market_data",
            combine="all",
            conditions=[AlertCondition(field="ltp", operator="always")],
        ),
        graph_dsl=AlertGraphDsl(),
        editor_mode="rule",
    )


def get_or_create_preference(db: Session, user_id: str) -> UserAlertWorkflowChatPreference:
    ensure_user(db, user_id)
    pref = db.get(UserAlertWorkflowChatPreference, user_id)
    if pref is not None:
        return pref
    pref = UserAlertWorkflowChatPreference(user_id=user_id, created_at=utc_now(), updated_at=utc_now())
    db.add(pref)
    db.commit()
    db.refresh(pref)
    return pref


def preference_to_schema(pref: UserAlertWorkflowChatPreference) -> AlertWorkflowChatPreferenceOut:
    return AlertWorkflowChatPreferenceOut(
        default_provider=pref.default_provider or None,
        default_model=pref.default_model or None,
    )


def get_preference(db: Session, user_id: str) -> AlertWorkflowChatPreferenceOut:
    return preference_to_schema(get_or_create_preference(db, user_id))


def update_preference(
    db: Session,
    user_id: str,
    payload: AlertWorkflowChatPreferenceUpdateIn,
) -> AlertWorkflowChatPreferenceOut:
    pref = get_or_create_preference(db, user_id)
    if payload.default_provider:
        llm_config.provider_definition(payload.default_provider)
    pref.default_provider = payload.default_provider
    pref.default_model = payload.default_model
    pref.updated_at = utc_now()
    db.add(pref)
    db.commit()
    db.refresh(pref)
    return preference_to_schema(pref)


def _owned_workflow(db: Session, user_id: str, workflow_id: str) -> AlertWorkflow:
    workflow = db.get(AlertWorkflow, workflow_id)
    if not workflow or workflow.user_id != user_id:
        raise ValueError("workflow not found")
    return workflow


def _workflow_for_session_schema(db: Session, session: AlertWorkflowChatSession):
    if not session.workflow_id:
        return None
    return alert_svc.get_workflow(db, session.user_id, session.workflow_id)


def session_to_schema(db: Session, session: AlertWorkflowChatSession) -> AlertWorkflowChatSessionOut:
    return AlertWorkflowChatSessionOut(
        id=session.id,
        user_id=session.user_id,
        workflow_id=session.workflow_id,
        title=session.title,
        status=session.status,
        active_snapshot_id=session.active_snapshot_id,
        created_at=session.created_at,
        updated_at=session.updated_at,
        workflow=_workflow_for_session_schema(db, session),
    )


def create_session(
    db: Session,
    user_id: str,
    payload: AlertWorkflowChatSessionCreateIn,
) -> AlertWorkflowChatSession:
    ensure_user(db, user_id)
    workflow_id = payload.workflow_id
    title = (payload.title or "Workflow AI chat").strip()[:256] or "Workflow AI chat"
    if workflow_id:
        workflow = _owned_workflow(db, user_id, workflow_id)
        if alert_svc._workflow_dsl(json_loads(workflow.workflow_dsl_json, {})).workflow_type != "market_data":
            raise ValueError("Workflow AI Chat only supports broker market-data workflows.")
    else:
        draft_payload = payload.draft_workflow or _default_draft_payload(title)
        draft_payload.workflow_dsl.workflow_type = "market_data"
        workflow = alert_svc.create_draft_workflow(db, user_id, draft_payload)
        workflow_id = workflow.id
    now = utc_now()
    row = AlertWorkflowChatSession(
        id=str(uuid.uuid4()),
        user_id=user_id,
        workflow_id=workflow_id,
        title=title,
        status="active",
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def get_owned_session(db: Session, user_id: str, session_id: str) -> AlertWorkflowChatSession:
    row = db.get(AlertWorkflowChatSession, session_id)
    if not row or row.user_id != user_id:
        raise ValueError("workflow chat session not found")
    return row


def list_sessions(db: Session, user_id: str, *, limit: int = 50) -> list[AlertWorkflowChatSessionOut]:
    rows = list(
        db.scalars(
            select(AlertWorkflowChatSession)
            .where(AlertWorkflowChatSession.user_id == user_id)
            .order_by(AlertWorkflowChatSession.updated_at.desc(), AlertWorkflowChatSession.id.desc())
            .limit(max(1, min(limit, 200)))
        ).all()
    )
    return [session_to_schema(db, row) for row in rows]


def _resolve_provider_model(
    db: Session,
    user_id: str,
    payload: AlertWorkflowChatSubmitIn,
    pref: UserAlertWorkflowChatPreference,
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
        raise ValueError("No enabled LLM provider is configured for Workflow AI Chat.")
    if not model:
        models = llm_config.list_provider_models(db, user_id, provider)
        model = models[0].model_id if models else None
    if not model:
        raise ValueError("No workflow chat model was provided or saved for the selected LLM provider.")
    return provider, model


def create_run(db: Session, user_id: str, payload: AlertWorkflowChatSubmitIn) -> tuple[AlertWorkflowChatRun, AlertWorkflowChatSession]:
    ensure_user(db, user_id)
    pref = get_or_create_preference(db, user_id)
    if payload.session_id:
        session = get_owned_session(db, user_id, payload.session_id)
    else:
        session = create_session(
            db,
            user_id,
            AlertWorkflowChatSessionCreateIn(
                title=payload.session_title,
                workflow_id=payload.workflow_id,
                draft_workflow=payload.draft_workflow,
            ),
        )
    active_run = db.scalars(
        select(AlertWorkflowChatRun)
        .where(
            AlertWorkflowChatRun.session_id == session.id,
            AlertWorkflowChatRun.user_id == user_id,
            AlertWorkflowChatRun.status.in_(ACTIVE_STATUSES),
        )
        .order_by(AlertWorkflowChatRun.created_at.desc(), AlertWorkflowChatRun.id.desc())
        .limit(1)
    ).first()
    if active_run is not None:
        raise ValueError("A workflow chat run is already active in this session.")
    provider, model = _resolve_provider_model(db, user_id, payload, pref)
    now = utc_now()
    run = AlertWorkflowChatRun(
        id=str(uuid.uuid4()),
        session_id=session.id,
        user_id=user_id,
        workflow_id=session.workflow_id,
        status="queued",
        provider=provider,
        model_id=model,
        message=payload.message.strip(),
        metadata_json=json_dumps({**payload.metadata, "editor_payload": payload.editor_payload}),
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
        run.job_id = enqueue_alert_workflow_chat_run(run.id)
    except Exception as exc:
        run.status = "failed"
        run.error = f"failed to enqueue workflow chat run: {exc}"
        run.completed_at = utc_now()
        run.updated_at = run.completed_at
        db.add(run)
        db.commit()
        db.refresh(run)
        raise
    db.add(run)
    db.commit()
    db.refresh(run)
    return run, session


def get_owned_run(db: Session, user_id: str, run_id: str) -> AlertWorkflowChatRun:
    row = db.get(AlertWorkflowChatRun, run_id)
    if not row or row.user_id != user_id:
        raise ValueError("workflow chat run not found")
    reconcile_run_queue_state(db, row)
    return row


def reconcile_run_queue_state(db: Session, run: AlertWorkflowChatRun) -> AlertWorkflowChatRun:
    if run.status != "queued":
        return run
    try:
        run.job_id = ensure_alert_workflow_chat_job_queued(run.id)
        run.updated_at = utc_now()
        db.add(run)
        db.commit()
        db.refresh(run)
    except Exception:
        pass
    return run


def reconcile_incomplete_runs(db: Session, *, limit: int = 200) -> dict[str, int]:
    rows = list(
        db.scalars(
            select(AlertWorkflowChatRun)
            .where(AlertWorkflowChatRun.status.in_(ACTIVE_STATUSES))
            .order_by(AlertWorkflowChatRun.created_at.asc(), AlertWorkflowChatRun.id.asc())
            .limit(max(1, min(limit, 1000)))
        ).all()
    )
    requeued = running_reset = running_kept = failed = 0
    for run in rows:
        try:
            if run.status == "running":
                status = alert_workflow_chat_job_status(run.id)
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
            run.job_id = ensure_alert_workflow_chat_job_queued(run.id)
            run.updated_at = utc_now()
            db.add(run)
            db.commit()
            requeued += 1
        except Exception:
            db.rollback()
            failed += 1
    return {"checked": len(rows), "requeued": requeued, "running_reset": running_reset, "running_kept": running_kept, "failed": failed}


def list_runs(
    db: Session,
    user_id: str,
    *,
    session_id: str | None = None,
    limit: int = 50,
) -> list[AlertWorkflowChatRunOut]:
    stmt = select(AlertWorkflowChatRun).where(AlertWorkflowChatRun.user_id == user_id)
    if session_id:
        stmt = stmt.where(AlertWorkflowChatRun.session_id == session_id)
    rows = list(
        db.scalars(
            stmt.order_by(AlertWorkflowChatRun.created_at.desc(), AlertWorkflowChatRun.id.desc()).limit(max(1, min(limit, 200)))
        ).all()
    )
    for row in rows:
        reconcile_run_queue_state(db, row)
    return [AlertWorkflowChatRunOut.model_validate(row) for row in rows]


def cancel_run(db: Session, user_id: str, run_id: str) -> AlertWorkflowChatRun:
    run = get_owned_run(db, user_id, run_id)
    if run.status in TERMINAL_STATUSES:
        return run
    request_alert_workflow_chat_cancel(run.id)
    cancel_alert_workflow_chat_job(run.id)
    mark_run_terminal(db, run, status="cancelled", response_text=run.response_text, error=None)
    db.refresh(run)
    append_event_once(db, run, event_type="run_cancelled", public_payload={"status": "cancelled"})
    return run


def next_event_sequence(db: Session, run_id: str) -> int:
    value = db.scalar(select(func.max(AlertWorkflowChatEvent.sequence)).where(AlertWorkflowChatEvent.run_id == run_id))
    return int(value or 0) + 1


def append_event(
    db: Session,
    run: AlertWorkflowChatRun,
    *,
    event_type: str,
    public_payload: dict[str, Any],
    full_payload: dict[str, Any] | None = None,
) -> AlertWorkflowChatEvent:
    sequence = next_event_sequence(db, run.id)
    now = utc_now()
    row = AlertWorkflowChatEvent(
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
            alert_workflow_chat_stream_key(run.id),
            {"payload": json_dumps({"sequence": sequence, "event_type": event_type})},
            maxlen=get_settings().alert_workflow_chat_stream_maxlen,
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
    run: AlertWorkflowChatRun,
    *,
    event_type: str,
    public_payload: dict[str, Any],
    full_payload: dict[str, Any] | None = None,
) -> AlertWorkflowChatEvent:
    existing = db.scalar(
        select(AlertWorkflowChatEvent)
        .where(AlertWorkflowChatEvent.run_id == run.id, AlertWorkflowChatEvent.event_type == event_type)
        .order_by(AlertWorkflowChatEvent.sequence.desc())
        .limit(1)
    )
    if existing is not None:
        return existing
    return append_event(db, run, event_type=event_type, public_payload=public_payload, full_payload=full_payload)


def event_to_schema(row: AlertWorkflowChatEvent) -> AlertWorkflowChatEventOut:
    return AlertWorkflowChatEventOut(
        id=row.id,
        run_id=row.run_id,
        sequence=row.sequence,
        event_type=row.event_type,
        payload=json_loads(row.public_payload_json, {}),
        created_at=row.created_at,
    )


def list_events(
    db: Session,
    run: AlertWorkflowChatRun,
    *,
    after_sequence: int | None = None,
    limit: int = 200,
) -> AlertWorkflowChatEventsPageOut:
    stmt = select(AlertWorkflowChatEvent).where(AlertWorkflowChatEvent.run_id == run.id)
    if after_sequence is not None:
        stmt = stmt.where(AlertWorkflowChatEvent.sequence > after_sequence)
    rows = list(
        db.scalars(
            stmt.order_by(AlertWorkflowChatEvent.sequence.asc()).limit(max(1, min(limit, 500)))
        ).all()
    )
    events = [event_to_schema(row) for row in rows]
    return AlertWorkflowChatEventsPageOut(
        run=AlertWorkflowChatRunOut.model_validate(run),
        events=events,
        next_after_sequence=events[-1].sequence if events else after_sequence,
    )


def mark_run_running(db: Session, run: AlertWorkflowChatRun) -> AlertWorkflowChatRun:
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
    run: AlertWorkflowChatRun,
    *,
    status: str,
    response_text: str = "",
    error: str | None = None,
) -> AlertWorkflowChatRun:
    now = utc_now()
    run.status = status
    run.response_text = response_text
    run.error = error
    run.completed_at = now
    run.updated_at = now
    session = db.get(AlertWorkflowChatSession, run.session_id)
    if session is not None:
        session.updated_at = now
        db.add(session)
    db.add(run)
    db.commit()
    db.refresh(run)
    if status in TERMINAL_STATUSES:
        try:
            clear_alert_workflow_chat_cancel(run.id)
        except Exception:
            pass
    return run


def conversation_history_for_run(db: Session, run: AlertWorkflowChatRun, *, limit: int | None = None) -> list[dict[str, str]]:
    history_limit = limit or get_settings().alert_workflow_chat_history_turn_limit
    rows = list(
        db.scalars(
            select(AlertWorkflowChatRun)
            .where(
                AlertWorkflowChatRun.session_id == run.session_id,
                AlertWorkflowChatRun.id != run.id,
                AlertWorkflowChatRun.status == "completed",
            )
            .order_by(AlertWorkflowChatRun.created_at.desc(), AlertWorkflowChatRun.id.desc())
            .limit(max(1, min(history_limit, 100)))
        ).all()
    )
    messages: list[dict[str, str]] = []
    for row in reversed(rows):
        messages.append({"role": "user", "content": row.message})
        if row.response_text:
            messages.append({"role": "assistant", "content": row.response_text})
    return messages

