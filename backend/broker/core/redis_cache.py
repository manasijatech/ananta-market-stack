"""Push normalized quotes into Redis for real-time consumers."""

from __future__ import annotations

import json
import logging
from typing import Any

import redis

from app.config import get_settings

logger = logging.getLogger(__name__)


def _redis_client() -> redis.Redis | None:
    s = get_settings()
    try:
        return redis.Redis(
            host=s.redis_host,
            port=s.redis_port,
            password=s.redis_password or None,
            db=s.redis_db,
            decode_responses=True,
            socket_connect_timeout=2,
            socket_timeout=2,
        )
    except Exception as e:
        logger.warning("Redis client init failed: %s", e)
        return None


def cache_quotes(
    *,
    user_id: str,
    account_id: str,
    broker_code: str,
    quotes: list[dict[str, Any]],
) -> None:
    r = _redis_client()
    if not r or not quotes:
        return
    s = get_settings()
    ttl = s.redis_quote_ttl_seconds
    pipe = r.pipeline()
    try:
        for q in quotes:
            sym = str(q.get("symbol") or q.get("upstox_instrument_key") or "unknown")
            key = f"quote:{user_id}:{account_id}:{broker_code}:{sym}"
            pipe.setex(key, ttl, json.dumps(q))
        pipe.execute()
    except redis.RedisError as e:
        logger.warning("Redis quote write failed: %s", e)


def ping_redis() -> tuple[bool, str]:
    r = _redis_client()
    if not r:
        return False, "no client"
    try:
        return bool(r.ping()), ""
    except redis.RedisError as e:
        return False, str(e)
