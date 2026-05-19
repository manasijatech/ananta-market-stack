from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.deps import get_current_user
from app.schemas.broker import (
    BrokerDataDefaultConfigOut,
    BrokerDataDefaultConfigUpdateIn,
    BrokerDataSearchConfigOut,
    BrokerDataSearchConfigUpdateIn,
    InstrumentSearchRow,
)
from app.services import broker_data_preferences
from db.models import User
from db.session import get_db

router = APIRouter()


@router.get("/search-config", response_model=BrokerDataSearchConfigOut)
def get_search_config(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> BrokerDataSearchConfigOut:
    return broker_data_preferences.get_broker_data_search_config(db, user.id)


@router.put("/search-config", response_model=BrokerDataSearchConfigOut)
def update_search_config(
    body: BrokerDataSearchConfigUpdateIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> BrokerDataSearchConfigOut:
    try:
        return broker_data_preferences.update_broker_data_search_config(db, user.id, body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/default-config", response_model=BrokerDataDefaultConfigOut)
def get_default_config(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> BrokerDataDefaultConfigOut:
    return broker_data_preferences.get_broker_data_default_config(db, user.id)


@router.put("/default-config", response_model=BrokerDataDefaultConfigOut)
def update_default_config(
    body: BrokerDataDefaultConfigUpdateIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> BrokerDataDefaultConfigOut:
    try:
        return broker_data_preferences.update_broker_data_default_config(db, user.id, body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/instruments/search", response_model=list[InstrumentSearchRow])
def search_instruments(
    q: str = Query(default=""),
    exchange: str | None = Query(default=None),
    segment: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[InstrumentSearchRow]:
    return broker_data_preferences.search_instruments_for_user(
        db,
        user.id,
        query=q,
        exchange=exchange,
        segment=segment,
        limit=limit,
    )
