from fastapi import APIRouter
import os
from datetime import datetime, timezone

from broker.core.redis_cache import ping_redis

router = APIRouter()

_STARTED_AT = datetime.now(tz=timezone.utc).isoformat()
_INSTANCE_PID = os.getpid()


@router.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "pid": _INSTANCE_PID,
        "started_at": _STARTED_AT,
    }


@router.get("/health/redis")
def health_redis() -> dict:
    ok, err = ping_redis()
    return {"redis_ok": ok, "error": err, "pid": _INSTANCE_PID}
