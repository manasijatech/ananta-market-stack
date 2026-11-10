from __future__ import annotations

from fastapi import APIRouter, Query

from app.schemas.market_calendar import MarketStatusOut
from app.services import market_calendar

router = APIRouter()


@router.get("/status", response_model=MarketStatusOut)
def market_status(
    exchange: str = Query(default="NSE", description="NSE or BSE (NFO/BFO map to equity derivatives)."),
    segment: str = Query(default="cash", description="cash, equity_derivatives, currency, or commodity."),
) -> MarketStatusOut:
    """
    **Current exchange session phase, holiday status and next open (IST).**

    Read-only and unauthenticated so the workspace shell can render a small
    status indicator without a per-user query. Nothing here is user data.
    """
    return MarketStatusOut(**market_calendar.market_status_now(exchange=exchange, segment=segment).as_dict())
