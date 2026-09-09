"""User/org Agent Skill preferences (Plan 07)."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import uuid4

from sqlalchemy.orm import Session

from db.models import AgentSkillPref


def list_overrides(db: Session, *, user_id: str) -> list[dict[str, Any]]:
    rows = (
        db.query(AgentSkillPref)
        .filter(AgentSkillPref.user_id == user_id)
        .order_by(AgentSkillPref.skill_id.asc())
        .all()
    )
    return [
        {
            "skill_id": row.skill_id,
            "enabled": bool(row.enabled),
            "markdown": row.markdown or None,
            "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        }
        for row in rows
    ]


def upsert_pref(
    db: Session,
    *,
    user_id: str,
    skill_id: str,
    enabled: bool | None = None,
    markdown: str | None = None,
) -> dict[str, Any]:
    skill_id = str(skill_id or "").strip()
    if not skill_id:
        raise ValueError("skill_id required")
    row = (
        db.query(AgentSkillPref)
        .filter(AgentSkillPref.user_id == user_id, AgentSkillPref.skill_id == skill_id)
        .one_or_none()
    )
    if row is None:
        row = AgentSkillPref(
            id=str(uuid4()),
            user_id=user_id,
            skill_id=skill_id,
            enabled=True if enabled is None else bool(enabled),
            markdown=markdown or "",
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        db.add(row)
    else:
        if enabled is not None:
            row.enabled = bool(enabled)
        if markdown is not None:
            row.markdown = markdown
        row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    return {
        "skill_id": row.skill_id,
        "enabled": bool(row.enabled),
        "markdown": row.markdown or None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def delete_pref(db: Session, *, user_id: str, skill_id: str) -> bool:
    row = (
        db.query(AgentSkillPref)
        .filter(AgentSkillPref.user_id == user_id, AgentSkillPref.skill_id == skill_id)
        .one_or_none()
    )
    if row is None:
        return False
    db.delete(row)
    db.commit()
    return True
