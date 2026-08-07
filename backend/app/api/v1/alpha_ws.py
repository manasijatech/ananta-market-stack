from __future__ import annotations

import asyncio
import json

import redis
from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.deps import get_current_user
from app.schemas.alpha import (
    AlphaFeedPageOut,
    AlphaSymbolMetadataBulkRequest,
    AlphaSymbolMetadataResponse,
)
from app.schemas.alert import AlphaWebSocketEventOut
from app.services import alpha_feed_cache, alpha_symbols
from app.services.alpha_websocket import ALPHA_WS_PRODUCTS
from broker.core.redis_cache import _redis_client
from db.models import AlphaWebSocketEvent, User
from db.session import get_db

router = APIRouter()


def _parse_symbols_query(symbols: list[str] | None, *, max_symbols: int = 20) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for raw_value in symbols or []:
        for part in str(raw_value).split(","):
            symbol = part.strip().upper()
            if not symbol or symbol in seen:
                continue
            seen.add(symbol)
            normalized.append(symbol)
    if not normalized:
        raise HTTPException(status_code=400, detail="'symbols' is required")
    if len(normalized) > max_symbols:
        raise HTTPException(
            status_code=400,
            detail=f"'symbols' accepts at most {max_symbols} unique symbols per request",
        )
    return normalized


@router.get("/feeds/{product}", response_model=AlphaFeedPageOut)
def get_alpha_feed_page(
    product: str,
    symbols: list[str] | None = Query(default=None),
    from_: str | None = Query(default=None, alias="from"),
    to: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    force_refresh: bool = Query(default=False),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AlphaFeedPageOut:
    if product not in alpha_feed_cache.ALPHA_FEED_PRODUCTS:
        raise HTTPException(status_code=404, detail=f"Unknown feed product: {product}")
    requested_symbols = _parse_symbols_query(symbols, max_symbols=2000)
    try:
        payload = alpha_feed_cache.list_cached_feed_items(
            db,
            user.id,
            product,
            requested_symbols,
            from_date=from_,
            to_date=to,
            page=page,
            limit=limit,
            force_refresh=force_refresh,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Could not load Alpha feed: {exc}") from exc
    return AlphaFeedPageOut(**payload)


@router.get("/symbols/metadata", response_model=AlphaSymbolMetadataResponse)
def get_alpha_symbol_metadata(
    symbols: list[str] | None = Query(default=None),
    force_refresh: bool = Query(default=False),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AlphaSymbolMetadataResponse:
    requested_symbols = _parse_symbols_query(symbols)
    try:
        rows = alpha_symbols.get_symbol_metadata(
            db,
            user.id,
            requested_symbols,
            force_refresh=force_refresh,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Could not fetch Alpha symbol metadata: {exc}") from exc
    return AlphaSymbolMetadataResponse(data=rows)


@router.post("/symbols/metadata/bulk", response_model=AlphaSymbolMetadataResponse)
def get_alpha_symbol_metadata_bulk(
    body: AlphaSymbolMetadataBulkRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AlphaSymbolMetadataResponse:
    try:
        rows = alpha_symbols.get_symbol_metadata(
            db,
            user.id,
            body.symbols,
            force_refresh=body.force_refresh,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Could not fetch Alpha symbol metadata: {exc}") from exc
    return AlphaSymbolMetadataResponse(data=rows)


@router.get("/events", response_model=list[AlphaWebSocketEventOut])
def list_alpha_websocket_events(
    product: str | None = Query(default=None),
    symbol: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[AlphaWebSocketEventOut]:
    stmt = select(AlphaWebSocketEvent).where(AlphaWebSocketEvent.user_id == user.id)
    if product:
        stmt = stmt.where(AlphaWebSocketEvent.product == product)
    if symbol:
        stmt = stmt.where(AlphaWebSocketEvent.symbol == symbol.strip().upper())
    rows = db.scalars(stmt.order_by(AlphaWebSocketEvent.received_at.desc()).limit(limit)).all()
    return [
        AlphaWebSocketEventOut(
            id=row.id,
            user_id=row.user_id,
            product=row.product,
            symbol=row.symbol,
            event_key=row.event_key,
            payload=json.loads(row.payload_json or "{}"),
            received_at=row.received_at,
            processed_at=row.processed_at,
        )
        for row in rows
    ]


def _stream_names(user_id: str, products: list[str]) -> dict[str, str]:
    return {f"alpha:ws:{user_id}:{product}": "$" for product in products}


def _xread(client: redis.Redis, streams: dict[str, str]) -> list[tuple[str, list[tuple[str, dict]]]]:
    return client.xread(streams, block=1000, count=50)


@router.websocket("/ws")
async def alpha_websocket_endpoint(websocket: WebSocket) -> None:
    user_id = (websocket.query_params.get("user_id") or "").strip() or "local-dev-user"
    raw_products = websocket.query_params.get("products") or ""
    products = [
        item.strip()
        for item in raw_products.split(",")
        if item.strip() in ALPHA_WS_PRODUCTS
    ] or list(ALPHA_WS_PRODUCTS)

    await websocket.accept()
    client = _redis_client()
    if client is None:
        await websocket.send_json({"error": "Redis is not available for Alpha websocket fanout."})
        await websocket.close(code=1011)
        return

    streams = _stream_names(user_id, products)
    await websocket.send_json({"status": "connected", "products": products})
    try:
        while True:
            rows = await asyncio.to_thread(_xread, client, streams)
            for stream_name_raw, messages in rows:
                stream_name = stream_name_raw.decode() if isinstance(stream_name_raw, bytes) else str(stream_name_raw)
                product = stream_name.rsplit(":", 1)[-1]
                for message_id_raw, fields in messages:
                    message_id = message_id_raw.decode() if isinstance(message_id_raw, bytes) else str(message_id_raw)
                    streams[stream_name] = message_id
                    raw = fields.get(b"payload") or fields.get("payload")
                    if isinstance(raw, bytes):
                        raw = raw.decode()
                    try:
                        payload = json.loads(str(raw))
                    except json.JSONDecodeError:
                        payload = {"channel": product, "data": {"raw": raw}}
                    await websocket.send_json(payload)
    except WebSocketDisconnect:
        return
