from __future__ import annotations

import asyncio
import json
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.deps import get_current_user
from app.schemas.broker_chat import (
    BrokerChatEventsPageOut,
    BrokerChatPreferenceOut,
    BrokerChatPreferenceUpdateIn,
    BrokerChatRunOut,
    BrokerChatSessionCreateIn,
    BrokerChatSessionOut,
    BrokerChatSubmitIn,
    BrokerChatSubmitOut,
    BrokerChatVisibility,
)
from app.services import broker_chat as chat_svc
from app.services.broker_chat_queue import broker_chat_queue_health, broker_chat_stream_key, redis_connection
from db.models import BrokerChatEvent, BrokerChatRun, User
from db.session import SessionLocal, get_db

router = APIRouter()


def _visibility_override(value: str | None) -> BrokerChatVisibility | None:
    if value in {"minimal", "tool_calls", "full"}:
        return value  # type: ignore[return-value]
    return None


@router.get("/config", response_model=BrokerChatPreferenceOut)
def get_broker_chat_config(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> BrokerChatPreferenceOut:
    return chat_svc.get_preference(db, user.id)


@router.put("/config", response_model=BrokerChatPreferenceOut)
def update_broker_chat_config(
    payload: BrokerChatPreferenceUpdateIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> BrokerChatPreferenceOut:
    try:
        return chat_svc.update_preference(db, user.id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/queue/health")
def get_broker_chat_queue_health() -> dict[str, object]:
    return broker_chat_queue_health()


@router.post("/sessions", response_model=BrokerChatSessionOut)
def create_broker_chat_session(
    payload: BrokerChatSessionCreateIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> BrokerChatSessionOut:
    return BrokerChatSessionOut.model_validate(chat_svc.create_session(db, user.id, payload.title))


@router.get("/sessions", response_model=list[BrokerChatSessionOut])
def list_broker_chat_sessions(
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[BrokerChatSessionOut]:
    return chat_svc.list_sessions(db, user.id, limit=limit)


@router.get("/sessions/{session_id}", response_model=BrokerChatSessionOut)
def get_broker_chat_session(
    session_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> BrokerChatSessionOut:
    try:
        return BrokerChatSessionOut.model_validate(chat_svc.get_owned_session(db, user.id, session_id))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/sessions/{session_id}", status_code=204)
def delete_broker_chat_session(
    session_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    try:
        chat_svc.delete_session(db, user.id, session_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/sessions/{session_id}/runs", response_model=list[BrokerChatRunOut])
def list_broker_chat_session_runs(
    session_id: str,
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[BrokerChatRunOut]:
    try:
        chat_svc.get_owned_session(db, user.id, session_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return chat_svc.list_runs(db, user.id, session_id=session_id, limit=limit)


@router.post("/runs", response_model=BrokerChatSubmitOut)
def submit_broker_chat_run(
    payload: BrokerChatSubmitIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> BrokerChatSubmitOut:
    try:
        run = chat_svc.create_run(db, user.id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"failed to enqueue broker chat run: {exc}") from exc
    return BrokerChatSubmitOut(
        run=BrokerChatRunOut.model_validate(run),
        stream_url=f"/api/v1/broker-chat/runs/{run.id}/stream",
        status_url=f"/api/v1/broker-chat/runs/{run.id}",
        events_url=f"/api/v1/broker-chat/runs/{run.id}/events",
    )


@router.get("/runs", response_model=list[BrokerChatRunOut])
def list_broker_chat_runs(
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[BrokerChatRunOut]:
    return chat_svc.list_runs(db, user.id, limit=limit)


@router.get("/runs/{run_id}", response_model=BrokerChatRunOut)
def get_broker_chat_run(
    run_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> BrokerChatRunOut:
    try:
        return BrokerChatRunOut.model_validate(chat_svc.get_owned_run(db, user.id, run_id))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/runs/{run_id}/cancel", response_model=BrokerChatRunOut)
def cancel_broker_chat_run(
    run_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> BrokerChatRunOut:
    try:
        return BrokerChatRunOut.model_validate(chat_svc.cancel_run(db, user.id, run_id))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/runs/{run_id}/events", response_model=BrokerChatEventsPageOut)
def get_broker_chat_events(
    run_id: str,
    after_sequence: int | None = Query(default=None, ge=0),
    limit: int = Query(default=200, ge=1, le=500),
    visibility: str | None = Query(default=None),
    include_tool_outputs: bool | None = Query(default=None),
    include_reasoning: bool | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> BrokerChatEventsPageOut:
    try:
        run = chat_svc.get_owned_run(db, user.id, run_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return chat_svc.list_events(
        db,
        run,
        after_sequence=after_sequence,
        limit=limit,
        visibility=_visibility_override(visibility),
        include_tool_outputs=include_tool_outputs,
        include_reasoning=include_reasoning,
    )


def _sse(event_id: int | str, event_type: str, data: dict[str, Any]) -> str:
    return (
        f"id: {event_id}\n"
        f"event: {event_type}\n"
        f"data: {json.dumps(data, default=str, ensure_ascii=False)}\n\n"
    )


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
        select(BrokerChatEvent)
        .where(BrokerChatEvent.run_id == run_id, BrokerChatEvent.sequence <= sequence)
        .order_by(BrokerChatEvent.sequence.desc())
        .limit(1)
    ).first()
    return row.redis_stream_id if row and row.redis_stream_id else "0-0"


def _run_is_terminal(db: Session, run_id: str) -> bool:
    run = db.get(BrokerChatRun, run_id)
    return bool(run and run.status in chat_svc.TERMINAL_STATUSES)


@router.get("/runs/{run_id}/stream")
async def stream_broker_chat_run(
    run_id: str,
    after_sequence: int | None = Query(default=None, ge=0),
    visibility: str | None = Query(default=None),
    include_tool_outputs: bool | None = Query(default=None),
    include_reasoning: bool | None = Query(default=None),
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
                yield _sse(sequence, "error", {"message": "broker chat run not found"})
                return
            page = chat_svc.list_events(
                db,
                run,
                after_sequence=sequence,
                limit=500,
                visibility=_visibility_override(visibility),
                include_tool_outputs=include_tool_outputs,
                include_reasoning=include_reasoning,
            )
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
                    page = chat_svc.list_events(
                        db,
                        run,
                        after_sequence=sequence,
                        limit=100,
                        visibility=_visibility_override(visibility),
                        include_tool_outputs=include_tool_outputs,
                        include_reasoning=include_reasoning,
                    )
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
                    {broker_chat_stream_key(run_id): redis_stream_id},
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
                        page = chat_svc.list_events(
                            db,
                            run,
                            after_sequence=sequence,
                            limit=100,
                            visibility=_visibility_override(visibility),
                            include_tool_outputs=include_tool_outputs,
                            include_reasoning=include_reasoning,
                        )
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
