from fastapi import APIRouter

from broker.core.redis_cache import ping_redis

router = APIRouter()


@router.get("/health")
def health() -> dict:
    return {"status": "ok"}


@router.get("/health/redis")
def health_redis() -> dict:
    ok, err = ping_redis()
    return {"redis_ok": ok, "error": err}
