from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.deps import get_current_user
from app.schemas.adaptive_workspace import WorkspaceSpec
from app.schemas.adaptive_workspace_api import (
    AdaptiveAlertStudioDeployIn,
    AdaptiveAlertStudioOut,
    AdaptiveWorkspaceApplyIn,
    AdaptiveWorkspaceCurrentOut,
    AdaptiveWorkspacePreferenceOut,
    AdaptiveWorkspacePreferencePutIn,
    AdaptiveWorkspaceSavedDeskCreateIn,
    AdaptiveWorkspaceSavedDeskOut,
    AdaptiveWorkspaceSavedDeskRenameIn,
    AdaptiveWorkspaceSnapshotCreateIn,
    AdaptiveWorkspaceSnapshotOut,
    AdaptiveWorkspaceSuggestionOut,
)
from app.services import adaptive_workspace as workspace_svc
from app.services import adaptive_workspace_alert_studio as alert_studio
from app.services import adaptive_workspace_personalization as personalization
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


@router.get("/templates")
def list_workspace_templates(
    user: User = Depends(get_current_user),
) -> list[dict]:
    _ = user
    return personalization.list_templates()


@router.post("/templates/{template_id}/apply", response_model=AdaptiveWorkspaceCurrentOut)
def apply_workspace_template(
    template_id: str,
    session_id: str = Query(...),
    payload: AdaptiveWorkspaceApplyIn | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AdaptiveWorkspaceCurrentOut:
    if payload is not None and payload.confirm is False:
        raise HTTPException(status_code=400, detail="Applying a template requires confirm=true")
    try:
        template = personalization.get_template(template_id)
        row = workspace_svc.create_snapshot(
            db,
            user.id,
            session_id,
            template["spec"],
            label=f"Template: {template['label']}",
            apply=True,
        )
        spec = _spec_from_snapshot(row)
    except ValueError as exc:
        raise _http_error(exc) from exc
    return AdaptiveWorkspaceCurrentOut(snapshot=workspace_svc.snapshot_to_out(row), spec=spec)


@router.get("/skills")
def list_workspace_skills(
    user: User = Depends(get_current_user),
) -> list[dict]:
    _ = user
    return personalization.list_skills()


@router.post("/skills/{skill_id}/apply", response_model=AdaptiveWorkspaceCurrentOut)
def apply_workspace_skill(
    skill_id: str,
    session_id: str = Query(...),
    payload: AdaptiveWorkspaceApplyIn | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AdaptiveWorkspaceCurrentOut:
    if payload is not None and payload.confirm is False:
        raise HTTPException(status_code=400, detail="Applying a skill requires confirm=true")
    try:
        skill = personalization.get_skill(skill_id)
        row = workspace_svc.create_snapshot(
            db,
            user.id,
            session_id,
            skill["spec"],
            label=f"Skill: {skill['label']}",
            apply=True,
        )
        spec = _spec_from_snapshot(row)
    except ValueError as exc:
        raise _http_error(exc) from exc
    return AdaptiveWorkspaceCurrentOut(snapshot=workspace_svc.snapshot_to_out(row), spec=spec)


@router.get("/desks", response_model=list[AdaptiveWorkspaceSavedDeskOut])
def list_named_desks(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[AdaptiveWorkspaceSavedDeskOut]:
    return [AdaptiveWorkspaceSavedDeskOut.model_validate(item) for item in personalization.list_saved_desks(db, user.id)]


@router.post("/desks", response_model=AdaptiveWorkspaceSavedDeskOut)
def create_named_desk(
    payload: AdaptiveWorkspaceSavedDeskCreateIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AdaptiveWorkspaceSavedDeskOut:
    try:
        item = personalization.save_desk(db, user.id, payload.name, payload.workspace_payload)
    except ValueError as exc:
        raise _http_error(exc) from exc
    return AdaptiveWorkspaceSavedDeskOut.model_validate(item)


@router.get("/desks/{desk_id}", response_model=AdaptiveWorkspaceSavedDeskOut)
def get_named_desk(
    desk_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AdaptiveWorkspaceSavedDeskOut:
    try:
        item = personalization.get_saved_desk(db, user.id, desk_id)
    except ValueError as exc:
        raise _http_error(exc) from exc
    return AdaptiveWorkspaceSavedDeskOut.model_validate(item)


@router.patch("/desks/{desk_id}", response_model=AdaptiveWorkspaceSavedDeskOut)
def rename_named_desk(
    desk_id: str,
    payload: AdaptiveWorkspaceSavedDeskRenameIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AdaptiveWorkspaceSavedDeskOut:
    try:
        item = personalization.rename_saved_desk(db, user.id, desk_id, payload.name)
    except ValueError as exc:
        raise _http_error(exc) from exc
    return AdaptiveWorkspaceSavedDeskOut.model_validate(item)


@router.post("/desks/{desk_id}/apply", response_model=AdaptiveWorkspaceCurrentOut)
def apply_named_desk(
    desk_id: str,
    session_id: str = Query(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AdaptiveWorkspaceCurrentOut:
    try:
        desk = personalization.get_saved_desk(db, user.id, desk_id)
        row = workspace_svc.create_snapshot(
            db,
            user.id,
            session_id,
            desk["workspace_payload"],
            label=f"Saved desk: {desk['name']}",
            apply=True,
        )
        spec = _spec_from_snapshot(row)
    except ValueError as exc:
        raise _http_error(exc) from exc
    return AdaptiveWorkspaceCurrentOut(snapshot=workspace_svc.snapshot_to_out(row), spec=spec)


@router.delete("/desks/{desk_id}", status_code=204)
def delete_named_desk(
    desk_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    try:
        personalization.delete_saved_desk(db, user.id, desk_id)
    except ValueError as exc:
        raise _http_error(exc) from exc


@router.get("/preferences", response_model=list[AdaptiveWorkspacePreferenceOut])
def list_workspace_preferences(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[AdaptiveWorkspacePreferenceOut]:
    return [AdaptiveWorkspacePreferenceOut.model_validate(item) for item in personalization.list_preferences(db, user.id)]


@router.put("/preferences", response_model=AdaptiveWorkspacePreferenceOut)
def put_workspace_preference(
    payload: AdaptiveWorkspacePreferencePutIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AdaptiveWorkspacePreferenceOut:
    try:
        item = personalization.upsert_preference(db, user.id, payload.key, payload.value)
    except ValueError as exc:
        raise _http_error(exc) from exc
    return AdaptiveWorkspacePreferenceOut.model_validate(item)


@router.delete("/preferences/{key}", status_code=204)
def delete_workspace_preference(
    key: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    try:
        personalization.delete_preference(db, user.id, key)
    except ValueError as exc:
        raise _http_error(exc) from exc


@router.get("/suggestions", response_model=list[AdaptiveWorkspaceSuggestionOut])
def list_workspace_suggestions(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[AdaptiveWorkspaceSuggestionOut]:
    return [AdaptiveWorkspaceSuggestionOut.model_validate(item) for item in personalization.list_suggestions(db, user.id)]


@router.get("/alert-studio", response_model=AdaptiveAlertStudioOut)
def get_alert_studio(
    workflow_id: str | None = Query(default=None),
    snapshot_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AdaptiveAlertStudioOut:
    try:
        return alert_studio.get_studio(db, user.id, workflow_id=workflow_id, snapshot_id=snapshot_id)
    except ValueError as exc:
        raise _http_error(exc) from exc


@router.post("/alert-studio/refresh", response_model=AdaptiveAlertStudioOut)
def refresh_alert_studio(
    workflow_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AdaptiveAlertStudioOut:
    try:
        return alert_studio.refresh_studio(db, user.id, workflow_id=workflow_id)
    except ValueError as exc:
        raise _http_error(exc) from exc


@router.post("/alert-studio/deploy", response_model=AdaptiveAlertStudioOut)
def deploy_alert_studio(
    payload: AdaptiveAlertStudioDeployIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AdaptiveAlertStudioOut:
    try:
        return alert_studio.deploy_studio(db, user.id, payload.snapshot_id, confirm=payload.confirm)
    except ValueError as exc:
        raise _http_error(exc) from exc
