"""Unified trading / portfolio operations for a broker account."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.deps import get_current_user
from broker.core.registry import get_client_for_account
from db.models import BrokerAccount, User
from db.session import get_db
from sqlalchemy.orm import Session

router = APIRouter()


def _owned(db: Session, user_id: str, account_id: str) -> BrokerAccount:
    acc = db.get(BrokerAccount, account_id)
    if not acc or acc.user_id != user_id:
        raise HTTPException(status_code=404, detail="broker account not found")
    return acc


def _client_or_409(acc: BrokerAccount):
    try:
        return get_client_for_account(acc)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e


class OrderBody(BaseModel):
    """
    Canonical order fields. Use `extra` for broker-specific fields.
    
    Fields like `symbol` and `exchange` are often required. 
    `extra` might contain `instrument_token` (Zerodha) or `symboltoken` (Angel).
    """

    symbol: str | None = Field(None, description="The trading symbol (e.g., 'RELIANCE').")
    exchange: str | None = Field(None, description="The exchange (e.g., 'NSE', 'BSE').")
    action: str | None = Field(None, description="Buy or Sell action.")
    pricetype: str = Field("MARKET", description="MARKET, LIMIT, SL, SL-M.")
    quantity: str = Field("1", description="Order quantity as a string.")
    product: str = Field("MIS", description="MIS (Intraday), CNC (Delivery), NRML.")
    price: str = Field("0", description="Limit price if applicable.")
    trigger_price: str = Field("0", description="Trigger price for SL orders.")
    disclosed_quantity: str = Field("0", description="Quantity to disclose to the exchange.")
    orderid: str | None = Field(None, description="Required for modifications/cancellations.")
    position_size: int | None = Field(None, description="Internal tracking for position sizing.")
    extra: dict[str, Any] = Field(
        default_factory=dict, 
        description="Broker-specific overrides or required fields (e.g. {'instrument_token': 12345})."
    )


def _merge_order_payload(body: OrderBody) -> dict[str, Any]:
    d = body.model_dump(exclude_none=True)
    ex = d.pop("extra", {}) or {}
    d.update(ex)
    return d


@router.get("/{account_id}/portfolio/orders")
def get_orders(
    account_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """**Fetch the order book for the day (broker-native format).**"""
    acc = _owned(db, user.id, account_id)
    return _client_or_409(acc).order_book()


@router.get("/{account_id}/portfolio/trades")
def get_trades(
    account_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """**Fetch today's completed trades (broker-native format).**"""
    acc = _owned(db, user.id, account_id)
    return _client_or_409(acc).trade_book()


@router.get("/{account_id}/portfolio/positions")
def get_positions(
    account_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """**Fetch current open and closed positions.**"""
    acc = _owned(db, user.id, account_id)
    return _client_or_409(acc).positions()


@router.get("/{account_id}/portfolio/holdings")
def get_holdings(
    account_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """**Fetch equity holdings (demat).**"""
    acc = _owned(db, user.id, account_id)
    return _client_or_409(acc).holdings()


@router.get("/{account_id}/portfolio/funds")
def get_funds(
    account_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """**Fetch available funds and margins.**"""
    acc = _owned(db, user.id, account_id)
    return _client_or_409(acc).funds()


@router.post("/{account_id}/orders")
def place_order(
    account_id: str,
    body: OrderBody,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """
    **Place a new order.**

    Supply canonical fields in the root JSON and broker-specific fields in `extra`.
    """
    acc = _owned(db, user.id, account_id)
    payload = _merge_order_payload(body)
    return _client_or_409(acc).place_order(payload)


@router.put("/{account_id}/orders")
def modify_order(
    account_id: str,
    body: OrderBody,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """**Modify an existing open order (requires `orderid`).**"""
    acc = _owned(db, user.id, account_id)
    payload = _merge_order_payload(body)
    return _client_or_409(acc).modify_order(payload)


@router.delete("/{account_id}/orders/{order_id}")
def cancel_order(
    account_id: str,
    order_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """**Cancel a specific order by ID.**"""
    acc = _owned(db, user.id, account_id)
    return _client_or_409(acc).cancel_order(order_id)


@router.post("/{account_id}/orders/cancel-all")
def cancel_all_orders(
    account_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """**Cancel all open orders for the account.**"""
    acc = _owned(db, user.id, account_id)
    return _client_or_409(acc).cancel_all_open_orders()


@router.get("/{account_id}/profile")
def get_profile(
    account_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    acc = _owned(db, user.id, account_id)
    return _client_or_409(acc).user_profile()


@router.post("/{account_id}/orders")
def post_place_order(
    account_id: str,
    body: OrderBody,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    acc = _owned(db, user.id, account_id)
    try:
        return _client_or_409(acc).place_order(_merge_order_payload(body))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e)) from e


@router.put("/{account_id}/orders")
def put_modify_order(
    account_id: str,
    body: OrderBody,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    acc = _owned(db, user.id, account_id)
    if not body.orderid:
        raise HTTPException(status_code=400, detail="orderid required")
    try:
        return _client_or_409(acc).modify_order(_merge_order_payload(body))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e)) from e


@router.delete("/{account_id}/orders/{order_id}")
def delete_order(
    account_id: str,
    order_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    acc = _owned(db, user.id, account_id)
    try:
        return _client_or_409(acc).cancel_order(order_id)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e)) from e


@router.post("/{account_id}/orders/cancel-all")
def post_cancel_all(
    account_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    acc = _owned(db, user.id, account_id)
    return _client_or_409(acc).cancel_all_open_orders()


@router.post("/{account_id}/orders/smart")
def post_smart_order(
    account_id: str,
    body: OrderBody,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    acc = _owned(db, user.id, account_id)
    try:
        return _client_or_409(acc).smart_order(_merge_order_payload(body))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e)) from e


@router.post("/{account_id}/positions/close-all")
def post_close_all(
    account_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    acc = _owned(db, user.id, account_id)
    try:
        return _client_or_409(acc).close_all_positions()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e)) from e


class MarginLeg(BaseModel):
    symbol: str
    exchange: str
    action: str
    product: str
    quantity: int
    pricetype: str = "MARKET"
    price: float = 0
    trigger_price: float = 0


class MarginRequest(BaseModel):
    positions: list[MarginLeg]


@router.post("/{account_id}/margin/calculate")
def post_margin(
    account_id: str,
    body: MarginRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    acc = _owned(db, user.id, account_id)
    legs = [p.model_dump() for p in body.positions]
    try:
        return _client_or_409(acc).calculate_margin(legs)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
