from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.deps import get_current_user
from app.schemas.watchlist import (
    WatchlistCreateIn,
    WatchlistOut,
    WatchlistSymbolsBulkIn,
    WatchlistSymbolsBulkOut,
    WatchlistSymbolsReplaceIn,
    WatchlistUpdateIn,
)
from app.services import watchlists as watchlist_svc
from db.models import User
from db.session import get_db

router = APIRouter()


@router.get("", response_model=list[WatchlistOut])
def list_watchlists(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[WatchlistOut]:
    return watchlist_svc.list_watchlists(db, user.id)


@router.post("", response_model=WatchlistOut)
def create_watchlist(
    body: WatchlistCreateIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> WatchlistOut:
    return watchlist_svc.create_watchlist(db, user.id, body)


@router.get("/{watchlist_id}", response_model=WatchlistOut)
def get_watchlist(
    watchlist_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> WatchlistOut:
    row = watchlist_svc.get_watchlist(db, user.id, watchlist_id)
    if row is None:
        raise HTTPException(status_code=404, detail="watchlist not found")
    return row


@router.put("/{watchlist_id}", response_model=WatchlistOut)
def update_watchlist(
    watchlist_id: str,
    body: WatchlistUpdateIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> WatchlistOut:
    row = watchlist_svc.update_watchlist(db, user.id, watchlist_id, body)
    if row is None:
        raise HTTPException(status_code=404, detail="watchlist not found")
    return row


@router.delete("/{watchlist_id}")
def delete_watchlist(
    watchlist_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, bool]:
    ok = watchlist_svc.delete_watchlist(db, user.id, watchlist_id)
    if not ok:
        raise HTTPException(status_code=404, detail="watchlist not found")
    return {"ok": True}


@router.post("/{watchlist_id}/symbols", response_model=WatchlistSymbolsBulkOut)
def add_symbols_to_watchlist(
    watchlist_id: str,
    body: WatchlistSymbolsBulkIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> WatchlistSymbolsBulkOut:
    row = watchlist_svc.add_symbols_to_watchlist(db, user.id, watchlist_id, body)
    if row is None:
        raise HTTPException(status_code=404, detail="watchlist not found")
    return row


@router.put("/{watchlist_id}/symbols", response_model=WatchlistOut)
def replace_watchlist_symbols(
    watchlist_id: str,
    body: WatchlistSymbolsReplaceIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> WatchlistOut:
    row = watchlist_svc.replace_watchlist_symbols(db, user.id, watchlist_id, body)
    if row is None:
        raise HTTPException(status_code=404, detail="watchlist not found")
    return row


@router.delete("/{watchlist_id}/symbols/{symbol}", response_model=WatchlistOut)
def remove_symbol_from_watchlist(
    watchlist_id: str,
    symbol: str,
    exchange: str | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> WatchlistOut:
    row = watchlist_svc.remove_symbol_from_watchlist(db, user.id, watchlist_id, symbol, exchange)
    if row is None:
        raise HTTPException(status_code=404, detail="watchlist symbol not found")
    return row
