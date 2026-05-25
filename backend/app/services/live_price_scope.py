from __future__ import annotations

import logging

import redis

from broker.core.redis_cache import _redis_client

logger = logging.getLogger(__name__)

SCOPE_STREAM_MAXLEN = 2000


def scope_stream_name(user_id: str) -> str:
    return f"live:scope:{user_id}"


def publish_scope_change(user_id: str, *, reason: str = "scope_changed") -> None:
    client = _redis_client()
    if client is None:
        return
    try:
        client.xadd(
            scope_stream_name(user_id),
            {"reason": reason},
            maxlen=SCOPE_STREAM_MAXLEN,
            approximate=True,
        )
    except redis.RedisError as exc:
        logger.warning("live price scope signal failed for %s: %s", user_id, exc)
