from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.deps import get_current_user
from app.schemas.adaptive_workspace import WorkspaceSpec
from app.schemas.adaptive_workspace_api import (
    AdaptiveWorkspaceCurrentOut,
    AdaptiveWorkspaceSnapshotCreateIn,
    AdaptiveWorkspaceSnapshotOut,
)
from app.services import adaptive_workspace as workspace_svc
from db.models import AdaptiveWorkspaceSnapshot, User
from db.session import get_db

router = APIRouter()


def _http_error(exc: ValueError) -> HTTPException:
    message = str(exc)
    status = 404 if "not found" in message else 400
    return HTTPException(status_code=status, detail=message)


def _spec_from_snapshot(row: AdaptiveWorkspaceSnapshot) -> WorkspaceSpec:
    out = workspace_svc.snapshot_to_out(row)
    spec, validation = workspace_svc.parse_spec_or_error(out.workspace_payload)
    if spec is None:
        raise ValueError(workspace_svc.json_dumps(validation))
    return spec


@router.get("/sessions/{session_id}/current", response_model=AdaptiveWorkspaceCurrentOut)
def get_current_workspace(
    session_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AdaptiveWorkspaceCurrentOut:
    try:
        row = workspace_svc.get_current_snapshot(db, user.id, session_id)
    except ValueError as exc:
        raise _http_error(exc) from exc
    if row is None:
        return AdaptiveWorkspaceCurrentOut(snapshot=None, spec=workspace_svc.empty_spec())
    try:
        spec = _spec_from_snapshot(row)
    except ValueError as exc:
        raise _http_error(exc) from exc
    return AdaptiveWorkspaceCurrentOut(snapshot=workspace_svc.snapshot_to_out(row), spec=spec)


@router.get("/sessions/{session_id}/snapshots", response_model=list[AdaptiveWorkspaceSnapshotOut])
def list_workspace_snapshots(
    session_id: str,
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[AdaptiveWorkspaceSnapshotOut]:
    try:
        rows = workspace_svc.list_snapshots(db, user.id, session_id, limit=limit)
    except ValueError as exc:
        raise _http_error(exc) from exc
    return [workspace_svc.snapshot_to_out(row) for row in rows]


@router.post("/sessions/{session_id}/snapshots", response_model=AdaptiveWorkspaceSnapshotOut)
def create_workspace_snapshot(
    session_id: str,
    payload: AdaptiveWorkspaceSnapshotCreateIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AdaptiveWorkspaceSnapshotOut:
    try:
        row = workspace_svc.create_snapshot(
            db,
            user.id,
            session_id,
            payload.workspace_payload,
            label=payload.label,
            apply=payload.apply,
        )
    except ValueError as exc:
        raise _http_error(exc) from exc
    return workspace_svc.snapshot_to_out(row)


@router.get("/snapshots/{snapshot_id}", response_model=AdaptiveWorkspaceSnapshotOut)
def get_workspace_snapshot(
    snapshot_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AdaptiveWorkspaceSnapshotOut:
    try:
        row = workspace_svc.get_snapshot(db, user.id, snapshot_id)
    except ValueError as exc:
        raise _http_error(exc) from exc
    return workspace_svc.snapshot_to_out(row)


@router.post("/snapshots/{snapshot_id}/apply", response_model=AdaptiveWorkspaceCurrentOut)
def apply_workspace_snapshot(
    snapshot_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AdaptiveWorkspaceCurrentOut:
    try:
        row = workspace_svc.apply_snapshot(db, user.id, snapshot_id)
        spec = _spec_from_snapshot(row)
    except ValueError as exc:
        raise _http_error(exc) from exc
    return AdaptiveWorkspaceCurrentOut(snapshot=workspace_svc.snapshot_to_out(row), spec=spec)
