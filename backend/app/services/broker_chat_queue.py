from __future__ import annotations

import redis
from rq import Queue

from app.config import get_settings


def redis_connection() -> redis.Redis:
    settings = get_settings()
    return redis.Redis(
        host=settings.redis_host,
        port=settings.redis_port,
        password=settings.redis_password or None,
        db=settings.redis_db,
        decode_responses=False,
        socket_connect_timeout=2,
        socket_timeout=2,
    )


def broker_chat_queue() -> Queue:
    settings = get_settings()
    return Queue(settings.broker_chat_queue_name, connection=redis_connection())


def broker_chat_stream_key(run_id: str) -> str:
    return f"broker-chat:run:{run_id}:events"


def enqueue_broker_chat_run(run_id: str) -> str:
    settings = get_settings()
    queue = broker_chat_queue()
    job = queue.enqueue(
        "app.services.broker_chat_runner.run_broker_chat_job",
        run_id,
        job_id=f"broker-chat-{run_id}",
        job_timeout=settings.broker_chat_job_timeout_seconds,
        result_ttl=settings.broker_chat_result_ttl_seconds,
        failure_ttl=settings.broker_chat_result_ttl_seconds,
        description=f"broker chat run {run_id}",
    )
    return str(job.id)
