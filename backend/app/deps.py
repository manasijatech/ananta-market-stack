from __future__ import annotations

from fastapi import Depends, Header
from sqlalchemy.orm import Session

from db.models import User
from db.session import get_db


def _header_user_id(x_user_id: str | None = Header(None, alias="X-User-Id")) -> str:
    return (x_user_id or "").strip() or "local-dev-user"


def get_current_user(
    db: Session = Depends(get_db),
    user_id: str = Depends(_header_user_id),
) -> User:
    user = db.get(User, user_id)
    if user:
        return user
    user = User(id=user_id, display_name=None)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user
