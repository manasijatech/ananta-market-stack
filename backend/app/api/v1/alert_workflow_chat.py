from __future__ import annotations

import asyncio
import json
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.deps import get_current_user
from app.schemas.alert_workflow_chat import (
    AlertWorkflowChatEventsPageOut,
    AlertWorkflowChatPreferenceOut,
    AlertWorkflowChatPreferenceUpdateIn,
    AlertWorkflowChatRunOut,
    AlertWorkflowChatSessionCreateIn,
    AlertWorkflowChatSessionOut,
    AlertWorkflowChatSnapshotApplyOut,
    AlertWorkflowChatSnapshotOut,
    AlertWorkflowChatSubmitIn,
    AlertWorkflowChatSubmitOut,
)
from app.services.alert_workflow_chat import sessions as chat_svc
from app.services.alert_workflow_chat import snapshots as snapshot_svc
from app.services.alert_workflow_chat.queue import (
    alert_workflow_chat_queue_health,
    alert_workflow_chat_stream_key,
    redis_connection,
)
from db.models import AlertWorkflowChatEvent, AlertWorkflowChatRun, User
from db.session import SessionLocal, get_db

router = APIRouter()


@router.get("/config", response_model=AlertWorkflowChatPreferenceOut)
def get_workflow_chat_config(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AlertWorkflowChatPreferenceOut:
    return chat_svc.get_preference(db, user.id)


@router.put("/config", response_model=AlertWorkflowChatPreferenceOut)
def update_workflow_chat_config(
    payload: AlertWorkflowChatPreferenceUpdateIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AlertWorkflowChatPreferenceOut:
    try:
        return chat_svc.update_preference(db, user.id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/queue/health")
def get_workflow_chat_queue_health() -> dict[str, object]:
    return alert_workflow_chat_queue_health()


@router.post("/sessions", response_model=AlertWorkflowChatSessionOut)
def create_workflow_chat_session(
    payload: AlertWorkflowChatSessionCreateIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AlertWorkflowChatSessionOut:
    try:
        session = chat_svc.create_session(db, user.id, payload)
        return chat_svc.session_to_schema(db, session)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/sessions", response_model=list[AlertWorkflowChatSessionOut])
def list_workflow_chat_sessions(
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[AlertWorkflowChatSessionOut]:
    return chat_svc.list_sessions(db, user.id, limit=limit)


@router.get("/sessions/{session_id}", response_model=AlertWorkflowChatSessionOut)
def get_workflow_chat_session(
    session_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AlertWorkflowChatSessionOut:
    try:
        return chat_svc.session_to_schema(db, chat_svc.get_owned_session(db, user.id, session_id))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/sessions/{session_id}/runs", response_model=list[AlertWorkflowChatRunOut])
def list_workflow_chat_session_runs(
    session_id: str,
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[AlertWorkflowChatRunOut]:
    try:
        chat_svc.get_owned_session(db, user.id, session_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return chat_svc.list_runs(db, user.id, session_id=session_id, limit=limit)


@router.get("/sessions/{session_id}/snapshots", response_model=list[AlertWorkflowChatSnapshotOut])
def list_workflow_chat_snapshots(
    session_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[AlertWorkflowChatSnapshotOut]:
    try:
        chat_svc.get_owned_session(db, user.id, session_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return snapshot_svc.list_snapshots(db, user.id, session_id)


@router.post("/runs", response_model=AlertWorkflowChatSubmitOut)
def submit_workflow_chat_run(
    payload: AlertWorkflowChatSubmitIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AlertWorkflowChatSubmitOut:
    try:
        run, session = chat_svc.create_run(db, user.id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"failed to enqueue workflow chat run: {exc}") from exc
    return AlertWorkflowChatSubmitOut(
        run=AlertWorkflowChatRunOut.model_validate(run),
        session=chat_svc.session_to_schema(db, session),
        stream_url=f"/api/v1/alert-workflow-chat/runs/{run.id}/stream",
        status_url=f"/api/v1/alert-workflow-chat/runs/{run.id}",
        events_url=f"/api/v1/alert-workflow-chat/runs/{run.id}/events",
    )


@router.get("/runs", response_model=list[AlertWorkflowChatRunOut])
def list_workflow_chat_runs(
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[AlertWorkflowChatRunOut]:
    return chat_svc.list_runs(db, user.id, limit=limit)


@router.get("/runs/{run_id}", response_model=AlertWorkflowChatRunOut)
def get_workflow_chat_run(
    run_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AlertWorkflowChatRunOut:
    try:
        return AlertWorkflowChatRunOut.model_validate(chat_svc.get_owned_run(db, user.id, run_id))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/runs/{run_id}/cancel", response_model=AlertWorkflowChatRunOut)
def cancel_workflow_chat_run(
    run_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AlertWorkflowChatRunOut:
    try:
        return AlertWorkflowChatRunOut.model_validate(chat_svc.cancel_run(db, user.id, run_id))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/runs/{run_id}/events", response_model=AlertWorkflowChatEventsPageOut)
def get_workflow_chat_events(
    run_id: str,
    after_sequence: int | None = Query(default=None, ge=0),
    limit: int = Query(default=200, ge=1, le=500),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AlertWorkflowChatEventsPageOut:
    try:
        run = chat_svc.get_owned_run(db, user.id, run_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return chat_svc.list_events(db, run, after_sequence=after_sequence, limit=limit)


@router.get("/snapshots/{snapshot_id}", response_model=AlertWorkflowChatSnapshotOut)
def get_workflow_chat_snapshot(
    snapshot_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AlertWorkflowChatSnapshotOut:
    try:
        return snapshot_svc.snapshot_to_schema(snapshot_svc.get_owned_snapshot(db, user.id, snapshot_id))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/snapshots/{snapshot_id}/apply", response_model=AlertWorkflowChatSnapshotApplyOut)
def apply_workflow_chat_snapshot(
    snapshot_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AlertWorkflowChatSnapshotApplyOut:
    try:
        snapshot, workflow = snapshot_svc.apply_snapshot(db, user.id, snapshot_id)
        return AlertWorkflowChatSnapshotApplyOut(snapshot=snapshot, workflow=workflow)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/snapshots/{snapshot_id}/deploy", response_model=AlertWorkflowChatSnapshotApplyOut)
def deploy_workflow_chat_snapshot(
    snapshot_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AlertWorkflowChatSnapshotApplyOut:
    try:
        snapshot, workflow = snapshot_svc.deploy_snapshot(db, user.id, snapshot_id)
        return AlertWorkflowChatSnapshotApplyOut(snapshot=snapshot, workflow=workflow)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _sse(event_id: int | str, event_type: str, data: dict[str, Any]) -> str:
    return f"id: {event_id}\nevent: {event_type}\ndata: {json.dumps(data, default=str, ensure_ascii=False)}\n\n"


def _last_sequence(last_event_id: str | None, after_sequence: int | None) -> int:
    if after_sequence is not None:
        return max(0, after_sequence)
    if not last_event_id:
        return 0
    try:
        return max(0, int(last_event_id))
    except ValueError:
        return 0


def _latest_stream_id_for_sequence(db: Session, run_id: str, sequence: int) -> str:
    if sequence <= 0:
        return "0-0"
    row = db.scalars(
        select(AlertWorkflowChatEvent)
        .where(AlertWorkflowChatEvent.run_id == run_id, AlertWorkflowChatEvent.sequence <= sequence)
        .order_by(AlertWorkflowChatEvent.sequence.desc())
        .limit(1)
    ).first()
    return row.redis_stream_id if row and row.redis_stream_id else "0-0"


def _run_is_terminal(db: Session, run_id: str) -> bool:
    run = db.get(AlertWorkflowChatRun, run_id)
    return bool(run and run.status in chat_svc.TERMINAL_STATUSES)


@router.get("/runs/{run_id}/stream")
async def stream_workflow_chat_run(
    run_id: str,
    after_sequence: int | None = Query(default=None, ge=0),
    last_event_id: str | None = Header(default=None, alias="Last-Event-ID"),
    user: User = Depends(get_current_user),
) -> StreamingResponse:
    start_sequence = _last_sequence(last_event_id, after_sequence)

    async def event_stream():
        yield "retry: 3000\n: connected\n\n"
        sequence = start_sequence
        redis_stream_id = "0-0"

        db = SessionLocal()
        try:
            try:
                run = chat_svc.get_owned_run(db, user.id, run_id)
            except ValueError:
                yield _sse(sequence, "error", {"message": "workflow chat run not found"})
                return
            page = chat_svc.list_events(db, run, after_sequence=sequence, limit=500)
            for item in page.events:
                sequence = item.sequence
                yield _sse(item.sequence, item.event_type, item.payload)
            redis_stream_id = _latest_stream_id_for_sequence(db, run_id, sequence)
            if run.status in chat_svc.TERMINAL_STATUSES and not page.events:
                return
        finally:
            db.close()

        try:
            redis_client = redis_connection()
        except Exception:
            redis_client = None

        while True:
            if redis_client is None:
                db = SessionLocal()
                try:
                    run = chat_svc.get_owned_run(db, user.id, run_id)
                    page = chat_svc.list_events(db, run, after_sequence=sequence, limit=100)
                    for item in page.events:
                        sequence = item.sequence
                        yield _sse(item.sequence, item.event_type, item.payload)
                    if run.status in chat_svc.TERMINAL_STATUSES:
                        return
                finally:
                    db.close()
                yield "event: ping\ndata: {}\n\n"
                await asyncio.sleep(2)
                continue

            try:
                rows = await asyncio.to_thread(
                    redis_client.xread,
                    {alert_workflow_chat_stream_key(run_id): redis_stream_id},
                    count=50,
                    block=5000,
                )
            except Exception:
                yield "event: ping\ndata: {}\n\n"
                await asyncio.sleep(2)
                continue
            if not rows:
                db = SessionLocal()
                try:
                    if _run_is_terminal(db, run_id):
                        return
                finally:
                    db.close()
                yield "event: ping\ndata: {}\n\n"
                continue
            for _stream_name, messages in rows:
                for message_id, fields in messages:
                    redis_stream_id = message_id.decode() if isinstance(message_id, bytes) else str(message_id)
                    raw_payload = fields.get(b"payload") if b"payload" in fields else fields.get("payload")
                    if isinstance(raw_payload, bytes):
                        raw_payload = raw_payload.decode()
                    try:
                        marker = json.loads(str(raw_payload or "{}"))
                    except json.JSONDecodeError:
                        continue
                    marker_sequence = int(marker.get("sequence") or 0)
                    if marker_sequence <= sequence:
                        continue
                    db = SessionLocal()
                    try:
                        run = chat_svc.get_owned_run(db, user.id, run_id)
                        page = chat_svc.list_events(db, run, after_sequence=sequence, limit=100)
                        for item in page.events:
                            sequence = item.sequence
                            yield _sse(item.sequence, item.event_type, item.payload)
                    finally:
                        db.close()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )

