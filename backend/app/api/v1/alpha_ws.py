from __future__ import annotations

import asyncio
import json

import redis
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.services.alpha_websocket import ALPHA_WS_PRODUCTS
from broker.core.redis_cache import _redis_client

router = APIRouter()


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
