"""Unified read-only broker operations and guarded mutation endpoints."""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.config import get_settings
from app.deps import get_current_user
from app.schemas.broker import (
    DataCapabilitiesOut,
    HistoricalRequest,
    InstrumentSearchRow,
    InstrumentSyncOut,
    OhlcRequest,
    OptionChainRequest,
    QuoteRequest,
    QuoteRow,
    StreamStatusOut,
)
from app.services import broker_data
from app.services.broker_streams import stream_registry
from broker.core.instrument_store import SQLiteInstrumentResolver
from broker.core.registry import get_client_for_account
from db.models import BrokerAccount, User
from db.session import SessionLocal, get_db

router = APIRouter()


def _owned(db: Session, user_id: str, account_id: str) -> BrokerAccount:
    acc = db.get(BrokerAccount, account_id)
    if not acc or acc.user_id != user_id:
        raise HTTPException(status_code=404, detail="broker account not found")
    return acc


def _client_or_409(db: Session, acc: BrokerAccount):
    try:
        return get_client_for_account(acc, resolver=SQLiteInstrumentResolver(db, acc.broker_code))
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


def _order_mutations_enabled() -> bool:
    return get_settings().enable_order_mutations


def _reject_order_mutations() -> None:
    if not _order_mutations_enabled():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Order mutations are disabled in this environment.",
        )


def _rows_from_payload(payload: dict[str, Any]) -> list[dict[str, Any]]:
    for key in ("data", "payload", "positions", "holdings", "orders", "trades", "net"):
        value = payload.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
        if isinstance(value, dict):
            for nested_key in ("positions", "holdings", "orders", "trades", "net"):
                nested = value.get(nested_key)
                if isinstance(nested, list):
                    return [item for item in nested if isinstance(item, dict)]
    return []


def _filter_payload(payload: dict[str, Any], *, symbol: str | None, exchange: str | None) -> dict[str, Any]:
    if not symbol and not exchange:
        return payload
    rows = _rows_from_payload(payload)
    if not rows:
        return payload
    filtered = []
    for row in rows:
        row_symbol = str(
            row.get("tradingsymbol") or row.get("trading_symbol") or row.get("symbol") or row.get("securityId") or ""
        ).upper()
        row_exchange = str(row.get("exchange") or row.get("exchange_segment") or "").upper()
        if symbol and symbol.upper() not in row_symbol:
            continue
        if exchange and exchange.upper() != row_exchange:
            continue
        filtered.append(row)
    out = dict(payload)
    for key in ("positions", "holdings", "orders", "trades", "net"):
        if isinstance(out.get(key), list):
            out[key] = filtered
            return out
    for key in ("data", "payload"):
        value = out.get(key)
        if isinstance(value, dict):
            nested = dict(value)
            for nested_key in ("positions", "holdings", "orders", "trades", "net"):
                if isinstance(nested.get(nested_key), list):
                    nested[nested_key] = filtered
                    out[key] = nested
                    return out
    return out


class OrderBody(BaseModel):
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
    extra: dict[str, Any] = Field(default_factory=dict)


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


class GreeksRequest(BaseModel):
    symbol: str
    exchange: str = "NSE"
    expiry: str | None = None
    strike: str | None = None
    option_type: str | None = None


def _merge_order_payload(body: OrderBody) -> dict[str, Any]:
    payload = body.model_dump(exclude_none=True)
    extra = payload.pop("extra", {}) or {}
    payload.update(extra)
    return payload


@router.get("/{account_id}/portfolio/orders")
def get_orders(
    account_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    return _client_or_409(db, _owned(db, user.id, account_id)).order_book()


@router.get("/{account_id}/portfolio/trades")
def get_trades(
    account_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    return _client_or_409(db, _owned(db, user.id, account_id)).trade_book()


@router.get("/{account_id}/portfolio/positions")
def get_positions(
    account_id: str,
    symbol: str | None = Query(default=None),
    exchange: str | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    payload = _client_or_409(db, _owned(db, user.id, account_id)).positions()
    return _filter_payload(payload, symbol=symbol, exchange=exchange)


@router.get("/{account_id}/portfolio/holdings")
def get_holdings(
    account_id: str,
    symbol: str | None = Query(default=None),
    exchange: str | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    payload = _client_or_409(db, _owned(db, user.id, account_id)).holdings()
    return _filter_payload(payload, symbol=symbol, exchange=exchange)


@router.get("/{account_id}/portfolio/funds")
def get_funds(
    account_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    return _client_or_409(db, _owned(db, user.id, account_id)).funds()


@router.get("/{account_id}/profile")
def get_profile(
    account_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    return _client_or_409(db, _owned(db, user.id, account_id)).user_profile()


@router.post("/{account_id}/margin/calculate")
def post_margin(
    account_id: str,
    body: MarginRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    client = _client_or_409(db, _owned(db, user.id, account_id))
    return client.calculate_margin([item.model_dump() for item in body.positions])


@router.get("/{account_id}/data/capabilities", response_model=DataCapabilitiesOut)
def get_data_capabilities(
    account_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DataCapabilitiesOut:
    acc = _owned(db, user.id, account_id)
    return DataCapabilitiesOut(
        broker=acc.broker_code,
        account_id=acc.id,
        capabilities=broker_data.get_capabilities(db, acc),
    )


@router.post("/{account_id}/data/instruments/sync", response_model=InstrumentSyncOut)
def sync_instruments(
    account_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> InstrumentSyncOut:
    return broker_data.sync_instruments_for_account(db, _owned(db, user.id, account_id))


@router.post("/{account_id}/data/instruments/sync-db", response_model=InstrumentSyncOut)
def sync_instruments_db(
    account_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> InstrumentSyncOut:
    return broker_data.sync_instruments_to_db(db, _owned(db, user.id, account_id))


@router.post("/{account_id}/data/instruments/sync-csv", response_model=InstrumentSyncOut)
def sync_instruments_csv(
    account_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> InstrumentSyncOut:
    return broker_data.sync_instruments_to_csv(db, _owned(db, user.id, account_id))


@router.delete("/{account_id}/data/instruments", response_model=InstrumentSyncOut)
def delete_instruments_storage(
    account_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> InstrumentSyncOut:
    return broker_data.delete_instruments_storage(db, _owned(db, user.id, account_id))


@router.get("/{account_id}/data/instruments/search", response_model=list[InstrumentSearchRow])
def search_instruments(
    account_id: str,
    q: str = Query(default=""),
    exchange: str | None = Query(default=None),
    segment: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[InstrumentSearchRow]:
    return broker_data.search_instruments(
        db,
        _owned(db, user.id, account_id),
        query=q,
        exchange=exchange,
        segment=segment,
        limit=limit,
    )


@router.post("/{account_id}/data/quotes", response_model=list[QuoteRow])
def data_quotes(
    account_id: str,
    body: QuoteRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[QuoteRow]:
    acc = _owned(db, user.id, account_id)
    return broker_data.fetch_quotes(db, acc, [item.model_dump(exclude_none=True) for item in body.instruments])


@router.post("/{account_id}/data/ohlc")
def data_ohlc(
    account_id: str,
    body: OhlcRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[dict[str, Any]]:
    acc = _owned(db, user.id, account_id)
    return broker_data.fetch_ohlc(db, acc, [item.model_dump(exclude_none=True) for item in body.instruments])


@router.post("/{account_id}/data/historical")
def data_historical(
    account_id: str,
    body: HistoricalRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    acc = _owned(db, user.id, account_id)
    return broker_data.fetch_historical(db, acc, body.model_dump(mode="json"))


@router.post("/{account_id}/data/option-chain")
def data_option_chain(
    account_id: str,
    body: OptionChainRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    acc = _owned(db, user.id, account_id)
    return broker_data.fetch_option_chain(db, acc, body.model_dump())


@router.post("/{account_id}/data/greeks")
def data_greeks(
    account_id: str,
    body: GreeksRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    acc = _owned(db, user.id, account_id)
    return broker_data.fetch_greeks(db, acc, body.model_dump())


@router.get("/{account_id}/data/stream/status", response_model=StreamStatusOut)
async def data_stream_status(
    account_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> StreamStatusOut:
    acc = _owned(db, user.id, account_id)
    capability = broker_data.stream_status(db, acc)
    registry = await stream_registry.status(account_id)
    return StreamStatusOut(
        broker=acc.broker_code,
        account_id=acc.id,
        websocket_enabled=bool(capability.get("websocket_enabled")),
        subscription_count=int(registry.get("subscription_count", 0)),
        subscriptions=list(registry.get("subscriptions", [])),
        guidance=str(capability.get("guidance") or ""),
    )


@router.websocket("/{account_id}/data/stream/ws")
async def broker_data_stream(account_id: str, websocket: WebSocket) -> None:
    user_id = (websocket.query_params.get("user_id") or "").strip() or "local-dev-user"
    db = SessionLocal()
    try:
        acc = _owned(db, user_id, account_id)
    except HTTPException:
        await websocket.close(code=4404)
        db.close()
        return
    db.close()

    await websocket.accept()
    await stream_registry.attach(account_id)
    subscriptions: list[dict[str, Any]] = []
    try:
        while True:
            try:
                message = await asyncio.wait_for(websocket.receive_json(), timeout=2.0)
                message_type = str(message.get("type") or "")
                if message_type == "subscribe":
                    subscriptions = [item for item in message.get("instruments", []) if isinstance(item, dict)]
                    await stream_registry.set_subscriptions(account_id, subscriptions)
                    await websocket.send_json({"type": "subscribed", "count": len(subscriptions)})
                elif message_type == "unsubscribe":
                    subscriptions = []
                    await stream_registry.clear_subscriptions(account_id)
                    await websocket.send_json({"type": "unsubscribed"})
                elif message_type == "ping":
                    await websocket.send_json({"type": "pong"})
            except TimeoutError:
                if not subscriptions:
                    continue
                poll_db = SessionLocal()
                try:
                    acc = _owned(poll_db, user_id, account_id)
                    rows = broker_data.fetch_quotes(poll_db, acc, subscriptions)
                    await websocket.send_json(
                        {
                            "type": "quotes",
                            "rows": [row.model_dump(mode="json") for row in rows],
                        }
                    )
                finally:
                    poll_db.close()
            except WebSocketDisconnect:
                break
    finally:
        await stream_registry.detach(account_id)


@router.post("/{account_id}/orders", include_in_schema=False)
def place_order(
    account_id: str,
    body: OrderBody,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    _reject_order_mutations()
    return _client_or_409(db, _owned(db, user.id, account_id)).place_order(_merge_order_payload(body))


@router.put("/{account_id}/orders", include_in_schema=False)
def modify_order(
    account_id: str,
    body: OrderBody,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    _reject_order_mutations()
    return _client_or_409(db, _owned(db, user.id, account_id)).modify_order(_merge_order_payload(body))


@router.delete("/{account_id}/orders/{order_id}", include_in_schema=False)
def cancel_order(
    account_id: str,
    order_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    _reject_order_mutations()
    return _client_or_409(db, _owned(db, user.id, account_id)).cancel_order(order_id)


@router.post("/{account_id}/orders/cancel-all", include_in_schema=False)
def cancel_all_orders(
    account_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    _reject_order_mutations()
    return _client_or_409(db, _owned(db, user.id, account_id)).cancel_all_open_orders()


@router.post("/{account_id}/orders/smart", include_in_schema=False)
def smart_order(
    account_id: str,
    body: OrderBody,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    _reject_order_mutations()
    return _client_or_409(db, _owned(db, user.id, account_id)).smart_order(_merge_order_payload(body))


@router.post("/{account_id}/positions/close-all", include_in_schema=False)
def close_all_positions(
    account_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    _reject_order_mutations()
    return _client_or_409(db, _owned(db, user.id, account_id)).close_all_positions()
