import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.deps import get_current_user
from app.schemas.user import UserCreate, UserOut
from db.models import User
from db.session import get_db

router = APIRouter()


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)) -> User:
    """
    **Get current user profile.**

    Identity is resolved from the `X-User-Id` header (default: `local-dev-user`).
    """
    return user


@router.post("", response_model=UserOut)
def create_user(body: UserCreate, db: Session = Depends(get_db)) -> User:
    """
    **Explicitly create a new user.**

    Generates a fresh UUID. Most environments auto-create the user 
    on the first request if `X-User-Id` is provided.
    """
    uid = str(uuid.uuid4())
    u = User(id=uid, display_name=body.display_name)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


@router.get("/{user_id}", response_model=UserOut)
def get_user(user_id: str, db: Session = Depends(get_db)) -> User:
    """**Fetch user metadata by ID.**"""
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(status_code=404, detail="user not found")
    return u
