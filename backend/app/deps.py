from __future__ import annotations

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.services.rbac import Principal, ensure_principal
from db.models import User
from db.session import get_db


def _header_user_id(x_user_id: str | None = Header(None, alias="X-User-Id")) -> str:
    user_id = (x_user_id or "").strip()
    if user_id:
        return user_id
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required.")


def get_current_user(
    db: Session = Depends(get_db),
    user_id: str = Depends(_header_user_id),
) -> User:
    user = db.get(User, user_id)
    if user:
        return user
    user = User(id=user_id, display_name=None)
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        user = db.get(User, user_id)
        if user:
            return user
        raise
    db.refresh(user)
    return user


def get_current_principal(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Principal:
    return ensure_principal(db, user)
