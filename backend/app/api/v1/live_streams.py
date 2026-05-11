from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.deps import get_current_user
from app.schemas.alert import (
    LiveStreamsStatusOut,
    LiveSubscriptionBulkIn,
    LiveSubscriptionCreateIn,
    LiveSubscriptionOut,
    LiveSubscriptionReplaceIn,
)
from app.services import alerts as alert_svc
from db.models import User
from db.session import get_db

router = APIRouter()


@router.get("/status", response_model=LiveStreamsStatusOut)
def live_status(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> LiveStreamsStatusOut:
    return alert_svc.live_stream_status(db, user.id)


@router.get("/subscriptions", response_model=list[LiveSubscriptionOut])
def list_subscriptions(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[LiveSubscriptionOut]:
    return alert_svc.list_subscriptions(db, user.id)


@router.post("/subscriptions", response_model=LiveSubscriptionOut)
def add_subscription(
    body: LiveSubscriptionCreateIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> LiveSubscriptionOut:
    return alert_svc.ensure_symbol_subscription(db, user.id, body)


@router.post("/subscriptions/bulk", response_model=list[LiveSubscriptionOut])
def add_subscriptions_bulk(
    body: LiveSubscriptionBulkIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[LiveSubscriptionOut]:
    return alert_svc.ensure_symbol_subscriptions(db, user.id, body.subscriptions)


@router.put("/subscriptions/replace", response_model=list[LiveSubscriptionOut])
def replace_subscriptions(
    body: LiveSubscriptionReplaceIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[LiveSubscriptionOut]:
    return alert_svc.replace_subscriptions(db, user.id, body.subscriptions)


@router.delete("/subscriptions/{subscription_id}")
def remove_subscription(
    subscription_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, bool]:
    ok = alert_svc.remove_subscription(db, user.id, subscription_id)
    if not ok:
        raise HTTPException(status_code=404, detail="subscription not found")
    return {"ok": True}


@router.delete("/subscriptions")
def remove_subscriptions_bulk(
    subscription_ids: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, int]:
    ids = [item.strip() for item in subscription_ids.split(",") if item.strip()]
    return {"deleted": alert_svc.remove_subscriptions(db, user.id, ids)}


@router.post("/subscriptions/reconcile")
def reconcile_subscriptions(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> LiveStreamsStatusOut:
    return alert_svc.live_stream_status(db, user.id)
