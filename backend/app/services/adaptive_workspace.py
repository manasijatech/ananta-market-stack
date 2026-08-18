from __future__ import annotations

import json
import uuid
from copy import deepcopy
from datetime import datetime
from typing import Any

from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.schemas.adaptive_workspace import (
    WorkspaceSpec,
    empty_workspace_spec,
    next_component_id,
    next_grid_position,
    parse_workspace_spec,
    workspace_spec_dump,
)
from app.schemas.adaptive_workspace_api import AdaptiveWorkspaceSnapshotOut
from app.services import broker_chat
from common.datetime_compat import UTC
from db.models import AdaptiveWorkspaceSnapshot, BrokerChatSession


def json_dumps(value: Any) -> str:
    return json.dumps(value, default=str, ensure_ascii=False, separators=(",", ":"))


def json_loads(value: str | None, default: Any) -> Any:
    if not value:
        return default
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return default


def validation_payload(exc: ValidationError | None = None, *, issues: list[dict[str, str]] | None = None) -> dict[str, Any]:
    if exc is not None:
        return {
            "ok": False,
            "errors": [
                {"path": ".".join(str(part) for part in err.get("loc", ())), "message": err.get("msg", "invalid")}
                for err in exc.errors()
            ],
        }
    if issues:
        return {"ok": False, "errors": issues}
    return {"ok": True, "errors": []}


def parse_spec_or_error(payload: Any) -> tuple[WorkspaceSpec | None, dict[str, Any]]:
    if not isinstance(payload, dict):
        return None, validation_payload(issues=[{"path": "", "message": "WorkspaceSpec must be an object"}])
    try:
        return parse_workspace_spec(payload), validation_payload()
    except ValidationError as exc:
        return None, validation_payload(exc)


def empty_spec(title: str = "Untitled desk") -> WorkspaceSpec:
    return empty_workspace_spec(title)


def patch_workspace_spec(
    current: dict[str, Any] | WorkspaceSpec | None,
    *,
    operation: str,
    spec: dict[str, Any] | None = None,
    component: dict[str, Any] | None = None,
    component_id: str | None = None,
    position: dict[str, Any] | None = None,
    title: str | None = None,
) -> WorkspaceSpec:
    if operation == "replace":
        if not isinstance(spec, dict):
            raise ValueError("replace requires a WorkspaceSpec object")
        parsed, validation = parse_spec_or_error(spec)
        if parsed is None:
            raise ValueError(json_dumps(validation))
        return parsed

    if isinstance(current, WorkspaceSpec):
        base = current
    elif isinstance(current, dict) and current:
        parsed, validation = parse_spec_or_error(current)
        if parsed is None:
            raise ValueError(json_dumps(validation))
        base = parsed
    else:
        base = empty_workspace_spec()

    dumped = workspace_spec_dump(base)
    components: list[dict[str, Any]] = list(dumped.get("components") or [])

    if operation == "set_title":
        if not title or not str(title).strip():
            raise ValueError("set_title requires a non-empty title")
        dumped["title"] = str(title).strip()[:120]
        parsed, validation = parse_spec_or_error(dumped)
        if parsed is None:
            raise ValueError(json_dumps(validation))
        return parsed

    if operation == "add":
        if not isinstance(component, dict):
            raise ValueError("add requires a component object")
        incoming = deepcopy(component)
        if not incoming.get("id"):
            incoming["id"] = next_component_id(
                [str(item.get("id") or "") for item in components],
                str(incoming.get("type") or "widget"),
            )
        if not incoming.get("position"):
            parsed_base = parse_workspace_spec(dumped)
            pos = next_grid_position(parsed_base.components)
            incoming["position"] = pos.model_dump()
        components.append(incoming)
        dumped["components"] = components
        parsed, validation = parse_spec_or_error(dumped)
        if parsed is None:
            raise ValueError(json_dumps(validation))
        return parsed

    if not component_id:
        raise ValueError(f"{operation} requires component_id")

    if operation == "remove":
        dumped["components"] = [item for item in components if item.get("id") != component_id]
        if len(dumped["components"]) == len(components):
            raise ValueError(f"component {component_id!r} was not found on the desk")
        parsed, validation = parse_spec_or_error(dumped)
        if parsed is None:
            raise ValueError(json_dumps(validation))
        return parsed

    if operation == "move":
        if not isinstance(position, dict):
            raise ValueError("move requires a position object")
        found = False
        for item in components:
            if item.get("id") == component_id:
                item["position"] = position
                found = True
                break
        if not found:
            raise ValueError(f"component {component_id!r} was not found on the desk")
        dumped["components"] = components
        parsed, validation = parse_spec_or_error(dumped)
        if parsed is None:
            raise ValueError(json_dumps(validation))
        return parsed

    if operation == "update":
        if not isinstance(component, dict):
            raise ValueError("update requires a component object")
        found = False
        for index, item in enumerate(components):
            if item.get("id") != component_id:
                continue
            merged = {**item, **deepcopy(component), "id": component_id}
            components[index] = merged
            found = True
            break
        if not found:
            raise ValueError(f"component {component_id!r} was not found on the desk")
        dumped["components"] = components
        parsed, validation = parse_spec_or_error(dumped)
        if parsed is None:
            raise ValueError(json_dumps(validation))
        return parsed

    if operation == "duplicate":
        source = None
        for item in components:
            if item.get("id") == component_id:
                source = deepcopy(item)
                break
        if source is None:
            raise ValueError(f"component {component_id!r} was not found on the desk")
        clone_id = next_component_id(
            [str(item.get("id") or "") for item in components],
            str(source.get("id") or source.get("type") or "widget"),
        )
        parsed_base = parse_workspace_spec(dumped)
        pos = source.get("position") if isinstance(source.get("position"), dict) else {}
        clone_position = next_grid_position(
            parsed_base.components,
            int(pos.get("w") or 6),
            int(pos.get("h") or 3),
        )
        source["id"] = clone_id
        source["position"] = clone_position.model_dump()
        components.append(source)
        dumped["components"] = components
        parsed, validation = parse_spec_or_error(dumped)
        if parsed is None:
            raise ValueError(json_dumps(validation))
        return parsed

    raise ValueError(f"unsupported patch operation {operation!r}")


def snapshot_to_out(row: AdaptiveWorkspaceSnapshot) -> AdaptiveWorkspaceSnapshotOut:
    spec, validation = parse_spec_or_error(json_loads(row.workspace_payload_json, {}))
    payload = workspace_spec_dump(spec) if spec is not None else json_loads(row.workspace_payload_json, {})
    stored_validation = json_loads(row.validation_json, {})
    return AdaptiveWorkspaceSnapshotOut(
        id=row.id,
        session_id=row.session_id,
        user_id=row.user_id,
        version=row.version,
        label=row.label,
        workspace_payload=payload,
        validation=stored_validation or validation,
        valid=row.valid,
        applied_at=row.applied_at,
        created_at=row.created_at,
    )


def _next_version(db: Session, session_id: str) -> int:
    current = db.scalar(
        select(func.max(AdaptiveWorkspaceSnapshot.version)).where(
            AdaptiveWorkspaceSnapshot.session_id == session_id
        )
    )
    return int(current or 0) + 1


def create_snapshot(
    db: Session,
    user_id: str,
    session_id: str,
    workspace_payload: dict[str, Any] | WorkspaceSpec,
    *,
    label: str | None = None,
    apply: bool = True,
) -> AdaptiveWorkspaceSnapshot:
    session = broker_chat.get_owned_session(db, user_id, session_id)
    payload = workspace_spec_dump(workspace_payload) if isinstance(workspace_payload, WorkspaceSpec) else workspace_payload
    spec, validation = parse_spec_or_error(payload)
    if spec is None:
        raise ValueError(json_dumps(validation))
    now = datetime.now(UTC).replace(tzinfo=None)
    row = AdaptiveWorkspaceSnapshot(
        id=str(uuid.uuid4()),
        session_id=session.id,
        user_id=user_id,
        version=_next_version(db, session.id),
        label=(label or "Workspace snapshot").strip()[:256] or "Workspace snapshot",
        workspace_payload_json=json_dumps(workspace_spec_dump(spec)),
        validation_json=json_dumps(validation),
        valid=True,
        applied_at=now if apply else None,
        created_at=now,
    )
    db.add(row)
    session.updated_at = now
    db.add(session)
    db.commit()
    db.refresh(row)
    return row


def list_snapshots(db: Session, user_id: str, session_id: str, *, limit: int = 50) -> list[AdaptiveWorkspaceSnapshot]:
    broker_chat.get_owned_session(db, user_id, session_id)
    return list(
        db.scalars(
            select(AdaptiveWorkspaceSnapshot)
            .where(
                AdaptiveWorkspaceSnapshot.session_id == session_id,
                AdaptiveWorkspaceSnapshot.user_id == user_id,
            )
            .order_by(AdaptiveWorkspaceSnapshot.version.desc(), AdaptiveWorkspaceSnapshot.created_at.desc())
            .limit(max(1, min(limit, 200)))
        ).all()
    )


def get_snapshot(db: Session, user_id: str, snapshot_id: str) -> AdaptiveWorkspaceSnapshot:
    row = db.get(AdaptiveWorkspaceSnapshot, snapshot_id)
    if not row or row.user_id != user_id:
        raise ValueError("workspace snapshot not found")
    return row


def get_current_snapshot(db: Session, user_id: str, session_id: str) -> AdaptiveWorkspaceSnapshot | None:
    broker_chat.get_owned_session(db, user_id, session_id)
    applied = db.scalars(
        select(AdaptiveWorkspaceSnapshot)
        .where(
            AdaptiveWorkspaceSnapshot.session_id == session_id,
            AdaptiveWorkspaceSnapshot.user_id == user_id,
            AdaptiveWorkspaceSnapshot.applied_at.is_not(None),
            AdaptiveWorkspaceSnapshot.valid.is_(True),
        )
        .order_by(AdaptiveWorkspaceSnapshot.applied_at.desc(), AdaptiveWorkspaceSnapshot.version.desc())
        .limit(1)
    ).first()
    if applied is not None:
        return applied
    return db.scalars(
        select(AdaptiveWorkspaceSnapshot)
        .where(
            AdaptiveWorkspaceSnapshot.session_id == session_id,
            AdaptiveWorkspaceSnapshot.user_id == user_id,
            AdaptiveWorkspaceSnapshot.valid.is_(True),
        )
        .order_by(AdaptiveWorkspaceSnapshot.version.desc())
        .limit(1)
    ).first()


def apply_snapshot(db: Session, user_id: str, snapshot_id: str) -> AdaptiveWorkspaceSnapshot:
    row = get_snapshot(db, user_id, snapshot_id)
    spec, validation = parse_spec_or_error(json_loads(row.workspace_payload_json, {}))
    if spec is None:
        raise ValueError(json_dumps(validation))
    now = datetime.now(UTC).replace(tzinfo=None)
    row.applied_at = now
    row.valid = True
    row.validation_json = json_dumps(validation)
    session = db.get(BrokerChatSession, row.session_id)
    if session is not None:
        session.updated_at = now
        db.add(session)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def persist_spec(
    db: Session,
    user_id: str,
    session_id: str,
    spec: WorkspaceSpec,
    *,
    label: str,
) -> AdaptiveWorkspaceSnapshot:
    return create_snapshot(db, user_id, session_id, spec, label=label, apply=True)
