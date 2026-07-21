"""Unified read-only broker operations and guarded mutation endpoints."""

from __future__ import annotations

import asyncio
import json
import time
from typing import Any
from urllib.parse import urlencode

import websockets

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.config import get_settings
from app.deps import get_current_principal
from app.schemas.broker import (
    DataCapabilitiesOut,
    HistoricalRequest,
    InstrumentSearchRow,
    InstrumentSyncOut,
    MarketChartRequest,
    MarketChartSnapshotOut,
    OhlcRequest,
    OptionChainRequest,
    QuoteRequest,
    QuoteRow,
    StreamStatusOut,
)
from app.services import broker_data
from app.services import market_chart
from app.services import rbac
from app.services.instrument_sync_jobs import instrument_sync_status
from app.services.broker_streams import stream_registry
from broker.core.instrument_store import SQLiteInstrumentResolver
from broker.core.registry import get_client_for_account
from broker.crypto import decrypt_value
from broker.arrow.streaming import (
    HFT_URL as ARROW_HFT_URL,
    STANDARD_URL as ARROW_STANDARD_URL,
    hft_symbol,
    hft_subscription_batches,
    parse_hft_packet,
    parse_standard_packet,
    scale_tick,
    split_hft_frames,
)
from db.models import BrokerAccount, User
from db.session import SessionLocal, get_db

router = APIRouter()


def _account(db: Session, principal: rbac.Principal, account_id: str, permission: str) -> BrokerAccount:
    return rbac.get_broker_account_for_permission(db, principal, account_id, permission)


def _client_or_409(db: Session, acc: BrokerAccount):
    try:
        return get_client_for_account(acc, resolver=SQLiteInstrumentResolver(db, acc.broker_code))
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


def _order_mutations_enabled() -> bool:
    return get_settings().enable_order_mutations


def _reject_order_mutations(principal: rbac.Principal) -> None:
    if not _order_mutations_enabled():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Order mutations are disabled in this environment.",
        )
    if not principal.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Order mutations are limited to admins.",
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
    symbol: str = ""
    exchange: str
    action: str
    product: str
    quantity: int
    pricetype: str = "MARKET"
    price: float = 0
    trigger_price: float = 0
    arrow_token: str | None = None
    instrument_token: str | None = None


class MarginRequest(BaseModel):
    positions: list[MarginLeg]
    include_positions: bool = True


class GreeksRequest(BaseModel):
    symbol: str = ""
    exchange: str = "NSE"
    expiry: str | None = None
    strike: str | None = None
    option_type: str | None = None
    instrument_token: str | None = None
    instrument_tokens: list[str] = Field(default_factory=list)
    tokens: list[str] = Field(default_factory=list)


def _merge_order_payload(body: OrderBody) -> dict[str, Any]:
    payload = body.model_dump(exclude_none=True)
    extra = payload.pop("extra", {}) or {}
    payload.update(extra)
    return payload


@router.get("/{account_id}/portfolio/orders")
def get_orders(
    account_id: str,
    db: Session = Depends(get_db),
    principal: rbac.Principal = Depends(get_current_principal),
) -> dict[str, Any]:
    return _client_or_409(db, _account(db, principal, account_id, rbac.BROKER_USE_DATA)).order_book()


@router.get("/{account_id}/portfolio/trades")
def get_trades(
    account_id: str,
    db: Session = Depends(get_db),
    principal: rbac.Principal = Depends(get_current_principal),
) -> dict[str, Any]:
    return _client_or_409(db, _account(db, principal, account_id, rbac.BROKER_USE_DATA)).trade_book()


@router.get("/{account_id}/portfolio/positions")
def get_positions(
    account_id: str,
    symbol: str | None = Query(default=None),
    exchange: str | None = Query(default=None),
    db: Session = Depends(get_db),
    principal: rbac.Principal = Depends(get_current_principal),
) -> dict[str, Any]:
    payload = _client_or_409(db, _account(db, principal, account_id, rbac.BROKER_USE_DATA)).positions()
    return _filter_payload(payload, symbol=symbol, exchange=exchange)


@router.get("/{account_id}/portfolio/holdings")
def get_holdings(
    account_id: str,
    symbol: str | None = Query(default=None),
    exchange: str | None = Query(default=None),
    db: Session = Depends(get_db),
    principal: rbac.Principal = Depends(get_current_principal),
) -> dict[str, Any]:
    payload = _client_or_409(db, _account(db, principal, account_id, rbac.BROKER_USE_DATA)).holdings()
    return _filter_payload(payload, symbol=symbol, exchange=exchange)


@router.get("/{account_id}/portfolio/funds")
def get_funds(
    account_id: str,
    db: Session = Depends(get_db),
    principal: rbac.Principal = Depends(get_current_principal),
) -> dict[str, Any]:
    return _client_or_409(db, _account(db, principal, account_id, rbac.BROKER_USE_DATA)).funds()


@router.get("/{account_id}/profile")
def get_profile(
    account_id: str,
    db: Session = Depends(get_db),
    principal: rbac.Principal = Depends(get_current_principal),
) -> dict[str, Any]:
    return _client_or_409(db, _account(db, principal, account_id, rbac.BROKER_USE_DATA)).user_profile()


@router.post("/{account_id}/margin/calculate")
def post_margin(
    account_id: str,
    body: MarginRequest,
    db: Session = Depends(get_db),
    principal: rbac.Principal = Depends(get_current_principal),
) -> dict[str, Any]:
    client = _client_or_409(db, _account(db, principal, account_id, rbac.BROKER_USE_DATA))
    positions = [item.model_dump() for item in body.positions]
    if positions:
        positions[0]["include_positions"] = body.include_positions
    return client.calculate_margin(positions)


def _optional_client_method(client: Any, method_name: str):
    method = getattr(client, method_name, None)
    if not callable(method):
        raise HTTPException(status_code=501, detail=f"{method_name} is not supported by this broker")
    return method


@router.get("/{account_id}/portfolio/orders/{order_id}")
def get_order_details(
    account_id: str,
    order_id: str,
    db: Session = Depends(get_db),
    principal: rbac.Principal = Depends(get_current_principal),
) -> dict[str, Any]:
    client = _client_or_409(db, _account(db, principal, account_id, rbac.BROKER_USE_DATA))
    return _optional_client_method(client, "order_details")(order_id)


@router.get("/{account_id}/data/holidays")
def data_holidays(
    account_id: str,
    db: Session = Depends(get_db),
    principal: rbac.Principal = Depends(get_current_principal),
) -> dict[str, Any]:
    client = _client_or_409(db, _account(db, principal, account_id, rbac.BROKER_USE_DATA))
    return _optional_client_method(client, "holidays")()


@router.get("/{account_id}/data/indices")
def data_indices(
    account_id: str,
    db: Session = Depends(get_db),
    principal: rbac.Principal = Depends(get_current_principal),
) -> dict[str, Any]:
    client = _client_or_409(db, _account(db, principal, account_id, rbac.BROKER_USE_DATA))
    return _optional_client_method(client, "indices")()


@router.get("/{account_id}/data/option-chain-symbols")
def data_option_chain_symbols(
    account_id: str,
    db: Session = Depends(get_db),
    principal: rbac.Principal = Depends(get_current_principal),
) -> dict[str, Any]:
    client = _client_or_409(db, _account(db, principal, account_id, rbac.BROKER_USE_DATA))
    return _optional_client_method(client, "option_chain_symbols")()


@router.get("/{account_id}/data/capabilities", response_model=DataCapabilitiesOut)
def get_data_capabilities(
    account_id: str,
    db: Session = Depends(get_db),
    principal: rbac.Principal = Depends(get_current_principal),
) -> DataCapabilitiesOut:
    acc = _account(db, principal, account_id, rbac.BROKER_VIEW)
    return DataCapabilitiesOut(
        broker=acc.broker_code,
        account_id=acc.id,
        capabilities=broker_data.get_capabilities(db, acc),
    )


@router.get("/{account_id}/data/instruments/sync-status", response_model=InstrumentSyncOut)
def get_instrument_sync_status(
    account_id: str,
    db: Session = Depends(get_db),
    principal: rbac.Principal = Depends(get_current_principal),
) -> InstrumentSyncOut:
    acc = _account(db, principal, account_id, rbac.BROKER_VIEW)
    try:
        status = instrument_sync_status(db, acc)
    except Exception:
        return InstrumentSyncOut(
            broker=acc.broker_code,
            sync_status="not_started",
            row_count=0,
            storage_target="csv",
        )
    if status is None:
        return InstrumentSyncOut(
            broker=acc.broker_code,
            sync_status="not_started",
            row_count=0,
            storage_target="csv",
        )
    return status


@router.post("/{account_id}/data/instruments/sync", response_model=InstrumentSyncOut)
def sync_instruments(
    account_id: str,
    db: Session = Depends(get_db),
    principal: rbac.Principal = Depends(get_current_principal),
) -> InstrumentSyncOut:
    return broker_data.sync_instruments_for_account(db, _account(db, principal, account_id, rbac.BROKER_MANAGE_SESSIONS))


@router.post("/{account_id}/data/instruments/sync-db", response_model=InstrumentSyncOut)
def sync_instruments_db(
    account_id: str,
    db: Session = Depends(get_db),
    principal: rbac.Principal = Depends(get_current_principal),
) -> InstrumentSyncOut:
    return broker_data.sync_instruments_to_db(db, _account(db, principal, account_id, rbac.BROKER_MANAGE_SESSIONS))


@router.post("/{account_id}/data/instruments/sync-csv", response_model=InstrumentSyncOut)
def sync_instruments_csv(
    account_id: str,
    db: Session = Depends(get_db),
    principal: rbac.Principal = Depends(get_current_principal),
) -> InstrumentSyncOut:
    return broker_data.sync_instruments_to_csv(db, _account(db, principal, account_id, rbac.BROKER_MANAGE_SESSIONS))


@router.delete("/{account_id}/data/instruments", response_model=InstrumentSyncOut)
def delete_instruments_storage(
    account_id: str,
    db: Session = Depends(get_db),
    principal: rbac.Principal = Depends(get_current_principal),
) -> InstrumentSyncOut:
    return broker_data.delete_instruments_storage(db, _account(db, principal, account_id, rbac.BROKER_MANAGE_SESSIONS))


@router.get("/{account_id}/data/instruments/search", response_model=list[InstrumentSearchRow])
def search_instruments(
    account_id: str,
    q: str = Query(default=""),
    exchange: str | None = Query(default=None),
    segment: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    principal: rbac.Principal = Depends(get_current_principal),
) -> list[InstrumentSearchRow]:
    return broker_data.search_instruments(
        db,
        _account(db, principal, account_id, rbac.BROKER_USE_DATA),
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
    principal: rbac.Principal = Depends(get_current_principal),
) -> list[QuoteRow]:
    acc = _account(db, principal, account_id, rbac.BROKER_USE_DATA)
    return broker_data.fetch_quotes(db, acc, [item.model_dump(exclude_none=True) for item in body.instruments])


@router.post("/{account_id}/data/ohlc")
def data_ohlc(
    account_id: str,
    body: OhlcRequest,
    db: Session = Depends(get_db),
    principal: rbac.Principal = Depends(get_current_principal),
) -> list[dict[str, Any]]:
    acc = _account(db, principal, account_id, rbac.BROKER_USE_DATA)
    return broker_data.fetch_ohlc(db, acc, [item.model_dump(exclude_none=True) for item in body.instruments])


@router.post("/{account_id}/data/historical")
def data_historical(
    account_id: str,
    body: HistoricalRequest,
    db: Session = Depends(get_db),
    principal: rbac.Principal = Depends(get_current_principal),
) -> dict[str, Any]:
    acc = _account(db, principal, account_id, rbac.BROKER_USE_DATA)
    return broker_data.fetch_historical(db, acc, body.model_dump(mode="json"))


@router.post("/{account_id}/data/market-chart", response_model=MarketChartSnapshotOut)
def data_market_chart(
    account_id: str,
    body: MarketChartRequest,
    db: Session = Depends(get_db),
    principal: rbac.Principal = Depends(get_current_principal),
) -> MarketChartSnapshotOut:
    acc = _account(db, principal, account_id, rbac.BROKER_USE_DATA)
    snapshot = market_chart.build_market_chart_snapshot(db, acc, body.model_dump(mode="json"))
    db.commit()
    return snapshot


@router.post("/{account_id}/data/option-chain")
def data_option_chain(
    account_id: str,
    body: OptionChainRequest,
    db: Session = Depends(get_db),
    principal: rbac.Principal = Depends(get_current_principal),
) -> dict[str, Any]:
    acc = _account(db, principal, account_id, rbac.BROKER_USE_DATA)
    return broker_data.fetch_option_chain(db, acc, body.model_dump())


@router.post("/{account_id}/data/greeks")
def data_greeks(
    account_id: str,
    body: GreeksRequest,
    db: Session = Depends(get_db),
    principal: rbac.Principal = Depends(get_current_principal),
) -> dict[str, Any]:
    acc = _account(db, principal, account_id, rbac.BROKER_USE_DATA)
    return broker_data.fetch_greeks(db, acc, body.model_dump())


@router.get("/{account_id}/data/stream/status", response_model=StreamStatusOut)
async def data_stream_status(
    account_id: str,
    db: Session = Depends(get_db),
    principal: rbac.Principal = Depends(get_current_principal),
) -> StreamStatusOut:
    acc = _account(db, principal, account_id, rbac.BROKER_USE_DATA)
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
    arrow_config: dict[str, Any] | None = None
    try:
        user = db.get(User, user_id)
        if user is None:
            await websocket.close(code=4404)
            db.close()
            return
        principal = rbac.ensure_principal(db, user)
        acc = _account(db, principal, account_id, rbac.BROKER_USE_DATA)
        if acc.broker_code == "arrow" and acc.arrow:
            arrow_config = {
                "app_id": decrypt_value(acc.arrow.app_id_cipher),
                "token": decrypt_value(acc.arrow.access_token_cipher),
                "hft": acc.arrow.market_stream_mode == "hft",
                "latency": acc.arrow.hft_latency_ms,
                "standard_capacity": get_settings().arrow_standard_stream_symbol_limit,
            }
    except HTTPException:
        await websocket.close(code=4404)
        db.close()
        return
    db.close()

    await websocket.accept()
    await stream_registry.attach(account_id)
    subscriptions: list[dict[str, Any]] = []
    try:
        if arrow_config:
            await _arrow_native_data_stream_bridge(
                websocket,
                user_id=user_id,
                account_id=account_id,
                config=arrow_config,
            )
            return
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
            except asyncio.TimeoutError:
                if not subscriptions:
                    continue
                poll_db = SessionLocal()
                try:
                    user = poll_db.get(User, user_id)
                    if user is None:
                        await websocket.close(code=4404)
                        break
                    principal = rbac.ensure_principal(poll_db, user)
                    acc = _account(poll_db, principal, account_id, rbac.BROKER_USE_DATA)
                    rows = broker_data.fetch_quotes(poll_db, acc, subscriptions)
                    await websocket.send_json(
                        {
                            "type": "quotes",
                            "rows": [row.model_dump(mode="json") for row in rows],
                        }
                    )
                except Exception as exc:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "message": str(exc)[:1000],
                        }
                    )
                finally:
                    poll_db.close()
            except WebSocketDisconnect:
                break
    finally:
        await stream_registry.detach(account_id)


async def _arrow_native_data_stream_bridge(
    websocket: WebSocket,
    *,
    user_id: str,
    account_id: str,
    config: dict[str, Any],
) -> None:
    desired: dict[str, dict[str, Any]] = {}
    disconnected = False
    max_reconnect_attempts = 300
    for attempt in range(1, max_reconnect_attempts + 1):
        backoff = 0 if attempt <= 3 else 2 if attempt == 4 else 4 if attempt == 5 else 5
        if disconnected:
            return
        if backoff:
            await websocket.send_json({"type": "reconnecting", "attempt": attempt, "delay_seconds": backoff})
            await asyncio.sleep(backoff)
        params = {"appID": config["app_id"], "token": config["token"]}
        if config["hft"]:
            params["zstd"] = "1"
        url = f"{ARROW_HFT_URL if config['hft'] else ARROW_STANDARD_URL}?{urlencode(params)}"
        try:
            async with websockets.connect(
                url,
                open_timeout=10,
                close_timeout=3,
                ping_interval=20,
                ping_timeout=20,
                max_size=4 * 1024 * 1024,
            ) as upstream:
                decompressor = None
                if config["hft"]:
                    import zstandard as zstd

                    decompressor = zstd.ZstdDecompressor()
                if desired:
                    await _arrow_send_native_subscription(upstream, desired, config, code="sub")
                await websocket.send_json(
                    {"type": "connected", "broker": "arrow", "mode": "hft" if config["hft"] else "standard"}
                )
                while True:
                    client_task = asyncio.create_task(websocket.receive_json())
                    upstream_task = asyncio.create_task(upstream.recv())
                    done, pending = await asyncio.wait(
                        {client_task, upstream_task}, return_when=asyncio.FIRST_COMPLETED
                    )
                    for task in pending:
                        task.cancel()
                    if client_task in done:
                        try:
                            message = client_task.result()
                        except WebSocketDisconnect:
                            disconnected = True
                            return
                        message_type = str(message.get("type") or "")
                        if message_type == "ping":
                            await websocket.send_json({"type": "pong"})
                            continue
                        raw_instruments = [item for item in message.get("instruments", []) if isinstance(item, dict)]
                        poll_db = SessionLocal()
                        try:
                            user = poll_db.get(User, user_id)
                            if not user:
                                disconnected = True
                                return
                            principal = rbac.ensure_principal(poll_db, user)
                            acc = _account(poll_db, principal, account_id, rbac.BROKER_USE_DATA)
                            hydrated = broker_data.hydrate_instruments(poll_db, acc, raw_instruments)
                        finally:
                            poll_db.close()
                        previous = dict(desired)
                        if message_type == "unsubscribe":
                            next_desired: dict[str, dict[str, Any]] = {}
                        elif message_type == "subscribe":
                            next_desired = {
                                str(item.get("arrow_token")): item
                                for item in hydrated
                                if item.get("arrow_token")
                            }
                            capacity = 1024 if config["hft"] else int(config["standard_capacity"])
                            if len(next_desired) > capacity:
                                await websocket.send_json(
                                    {
                                        "type": "error",
                                        "message": f"Arrow stream supports at most {capacity} symbols on this connection",
                                    }
                                )
                                continue
                        else:
                            continue
                        desired = next_desired
                        if previous:
                            await _arrow_send_native_subscription(upstream, previous, config, code="unsub")
                        if desired:
                            await _arrow_send_native_subscription(upstream, desired, config, code="sub")
                        await stream_registry.set_subscriptions(account_id, list(desired.values()))
                        await websocket.send_json({"type": "subscribed", "count": len(desired)})
                        continue
                    raw_message = upstream_task.result()
                    if not isinstance(raw_message, bytes):
                        continue
                    packets: list[dict[str, Any]] = []
                    if config["hft"]:
                        assert decompressor is not None
                        decoded = decompressor.decompress(raw_message)
                        packets = [
                            parsed
                            for frame in split_hft_frames(decoded)
                            if (parsed := parse_hft_packet(frame)) and parsed.get("kind") != "ack"
                        ]
                    else:
                        parsed = parse_standard_packet(raw_message)
                        packets = [parsed] if parsed else []
                    rows = []
                    for packet in packets:
                        token = str(packet.get("token") or "")
                        instrument = desired.get(token)
                        if not instrument:
                            continue
                        precision = int(instrument.get("price_precision") or 2)
                        tick = scale_tick(packet, precision)
                        rows.append(
                            {
                                "symbol": instrument.get("symbol") or instrument.get("trading_symbol"),
                                "ltp": float(tick.get("ltp") or 0),
                                "broker_code": "arrow",
                                "account_id": account_id,
                                "detail": {"exchange": instrument.get("exchange"), "raw": tick},
                            }
                        )
                    if rows:
                        await websocket.send_json({"type": "quotes", "rows": rows})
        except WebSocketDisconnect:
            return
        except Exception as exc:
            if attempt == max_reconnect_attempts:
                await websocket.send_json({"type": "error", "message": str(exc)[:1000]})
                await websocket.close(code=1011)
                return


async def _arrow_send_native_subscription(
    upstream: Any,
    instruments: dict[str, dict[str, Any]],
    config: dict[str, Any],
    *,
    code: str,
) -> None:
    if config["hft"]:
        symbols = [
            hft_symbol(
                str(item.get("exchange") or "NSE"),
                str(item.get("trading_symbol") or item.get("symbol")),
            )
            for item in instruments.values()
        ]
        for message in hft_subscription_batches(
            symbols,
            mode="ltpc",
            latency_ms=int(config["latency"]),
            code=code,
        ):
            request_times = config.setdefault("hft_subscription_request_times", [])
            now = time.monotonic()
            request_times[:] = [sent_at for sent_at in request_times if now - sent_at < 1.0]
            if len(request_times) >= 100:
                await asyncio.sleep(max(0.001, 1.0 - (now - request_times[0])))
                now = time.monotonic()
                request_times[:] = [sent_at for sent_at in request_times if now - sent_at < 1.0]
            request_times.append(now)
            await upstream.send(message)
    else:
        tokens = [int(token) for token in instruments]
        await upstream.send(json.dumps({"code": code, "mode": "quote", "quote": tokens}))


@router.websocket("/{account_id}/portfolio/order-updates/ws")
async def order_updates_stream(account_id: str, websocket: WebSocket) -> None:
    user_id = (websocket.query_params.get("user_id") or "").strip() or "local-dev-user"
    db = SessionLocal()
    try:
        user = db.get(User, user_id)
        if user is None:
            await websocket.close(code=4404)
            return
        principal = rbac.ensure_principal(db, user)
        acc = _account(db, principal, account_id, rbac.BROKER_USE_DATA)
        if acc.broker_code != "arrow" or not acc.arrow:
            await websocket.close(code=4400, reason="Order-update streaming is not supported by this broker")
            return
        app_id = decrypt_value(acc.arrow.app_id_cipher)
        token = decrypt_value(acc.arrow.access_token_cipher)
    except HTTPException:
        await websocket.close(code=4404)
        return
    finally:
        db.close()

    await websocket.accept()
    upstream_url = f"wss://order-updates.arrow.trade?{urlencode({'appID': app_id, 'token': token})}"
    max_reconnect_attempts = 300
    for attempt in range(1, max_reconnect_attempts + 1):
        delay = 0 if attempt <= 3 else 2 if attempt == 4 else 4 if attempt == 5 else 5
        if delay:
            try:
                await websocket.send_json({"type": "reconnecting", "attempt": attempt, "delay_seconds": delay})
            except WebSocketDisconnect:
                return
            await asyncio.sleep(delay)
        try:
            async with websockets.connect(
                upstream_url,
                open_timeout=10,
                close_timeout=3,
                ping_interval=20,
                ping_timeout=20,
                max_size=2 * 1024 * 1024,
            ) as upstream:
                await websocket.send_json({"type": "connected", "broker": "arrow", "account_id": account_id})
                last_message_at = time.monotonic()
                while True:
                    try:
                        message = await asyncio.wait_for(upstream.recv(), timeout=3.0)
                    except asyncio.TimeoutError:
                        # Arrow requires the literal application-level PONG on
                        # idle order streams in addition to WebSocket pings.
                        await upstream.send("PONG")
                        await websocket.send_json({"type": "ping"})
                        if time.monotonic() - last_message_at >= 5.0:
                            raise TimeoutError("Arrow order-update stream read timeout")
                        continue
                    last_message_at = time.monotonic()
                    if isinstance(message, bytes):
                        message = message.decode(errors="replace")
                    try:
                        raw = json.loads(message)
                    except (json.JSONDecodeError, TypeError):
                        raw = {"message": str(message)}
                    await websocket.send_json(
                        {
                            "type": "order_update",
                            "order_id": raw.get("id") or raw.get("orderID") or raw.get("orderId"),
                            "status": raw.get("orderStatus") or raw.get("status"),
                            "symbol": raw.get("symbol"),
                            "raw": raw,
                        }
                    )
        except WebSocketDisconnect:
            return
        except Exception as exc:
            if attempt == max_reconnect_attempts:
                try:
                    await websocket.send_json({"type": "error", "message": str(exc)[:1000]})
                    await websocket.close(code=1011)
                except Exception:
                    pass
                return


@router.post("/{account_id}/orders", include_in_schema=False)
def place_order(
    account_id: str,
    body: OrderBody,
    db: Session = Depends(get_db),
    principal: rbac.Principal = Depends(get_current_principal),
) -> dict[str, Any]:
    _reject_order_mutations(principal)
    return _client_or_409(db, _account(db, principal, account_id, rbac.ORDERS_TRADE)).place_order(_merge_order_payload(body))


@router.put("/{account_id}/orders", include_in_schema=False)
def modify_order(
    account_id: str,
    body: OrderBody,
    db: Session = Depends(get_db),
    principal: rbac.Principal = Depends(get_current_principal),
) -> dict[str, Any]:
    _reject_order_mutations(principal)
    return _client_or_409(db, _account(db, principal, account_id, rbac.ORDERS_TRADE)).modify_order(_merge_order_payload(body))


@router.delete("/{account_id}/orders/{order_id}", include_in_schema=False)
def cancel_order(
    account_id: str,
    order_id: str,
    db: Session = Depends(get_db),
    principal: rbac.Principal = Depends(get_current_principal),
) -> dict[str, Any]:
    _reject_order_mutations(principal)
    return _client_or_409(db, _account(db, principal, account_id, rbac.ORDERS_TRADE)).cancel_order(order_id)


@router.post("/{account_id}/orders/cancel-all", include_in_schema=False)
def cancel_all_orders(
    account_id: str,
    db: Session = Depends(get_db),
    principal: rbac.Principal = Depends(get_current_principal),
) -> dict[str, Any]:
    _reject_order_mutations(principal)
    return _client_or_409(db, _account(db, principal, account_id, rbac.ORDERS_TRADE)).cancel_all_open_orders()


@router.post("/{account_id}/orders/smart", include_in_schema=False)
def smart_order(
    account_id: str,
    body: OrderBody,
    db: Session = Depends(get_db),
    principal: rbac.Principal = Depends(get_current_principal),
) -> dict[str, Any]:
    _reject_order_mutations(principal)
    return _client_or_409(db, _account(db, principal, account_id, rbac.ORDERS_TRADE)).smart_order(_merge_order_payload(body))


@router.post("/{account_id}/positions/close-all", include_in_schema=False)
def close_all_positions(
    account_id: str,
    db: Session = Depends(get_db),
    principal: rbac.Principal = Depends(get_current_principal),
) -> dict[str, Any]:
    _reject_order_mutations(principal)
    return _client_or_409(db, _account(db, principal, account_id, rbac.ORDERS_TRADE)).close_all_positions()
