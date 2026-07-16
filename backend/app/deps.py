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
    x_user_email: str | None = Header(None, alias="X-User-Email"),
    x_user_name: str | None = Header(None, alias="X-User-Name"),
) -> User:
    display_name = (x_user_name or "").strip() or (x_user_email or "").strip() or None
    email = (x_user_email or "").strip() or None
    user = db.get(User, user_id)
    if user:
        changed = False
        if display_name and not user.display_name:
            user.display_name = display_name
            changed = True
        if email and user.email != email:
            user.email = email
            changed = True
        if changed:
            db.add(user)
            db.commit()
            db.refresh(user)
        return user
    user = User(id=user_id, display_name=display_name, email=email)
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
