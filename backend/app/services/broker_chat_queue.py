from __future__ import annotations

from datetime import datetime, timezone

import redis
from rq import Queue
from rq.job import Job
from rq.registry import FailedJobRegistry, StartedJobRegistry
from rq.worker import Worker

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


def broker_chat_cancel_key(run_id: str) -> str:
    return f"broker-chat:run:{run_id}:cancel"


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


def request_broker_chat_cancel(run_id: str) -> None:
    settings = get_settings()
    redis_connection().setex(broker_chat_cancel_key(run_id), settings.broker_chat_result_ttl_seconds, "1")


def clear_broker_chat_cancel(run_id: str) -> None:
    redis_connection().delete(broker_chat_cancel_key(run_id))


def broker_chat_cancel_requested(run_id: str) -> bool:
    return bool(redis_connection().exists(broker_chat_cancel_key(run_id)))


def cancel_broker_chat_job(run_id: str) -> bool:
    """Best-effort removal of a queued RQ job.

    Running jobs cannot be force-killed reliably from the web request path,
    so the runner also checks the cancel marker between streamed events.
    """

    connection = redis_connection()
    queue = broker_chat_queue()
    job_id = f"broker-chat-{run_id}"
    removed = False
    try:
        queue.remove(job_id)
        removed = True
    except Exception:
        removed = False
    for registry_cls in (StartedJobRegistry, FailedJobRegistry):
        try:
            registry_cls(queue.name, connection=connection).remove(job_id, delete_job=False)
        except Exception:
            pass
    try:
        job = Job.fetch(job_id, connection=connection)
        job.cancel()
    except Exception:
        pass
    return removed


def ensure_broker_chat_job_queued(run_id: str) -> str:
    connection = redis_connection()
    queue = broker_chat_queue()
    job_id = f"broker-chat-{run_id}"
    queued_ids = {item.decode() if isinstance(item, bytes) else str(item) for item in connection.lrange(queue.key, 0, -1)}
    try:
        job = Job.fetch(job_id, connection=connection)
    except Exception:
        return enqueue_broker_chat_run(run_id)
    status = job.get_status(refresh=True)
    status_value = getattr(status, "value", str(status))
    if status_value == "queued" and job_id not in queued_ids:
        queue.enqueue_job(job)
    return str(job.id)


def broker_chat_queue_health() -> dict[str, object]:
    connection = redis_connection()
    queue = broker_chat_queue()
    oldest_queued_seconds: float | None = None
    oldest_job_id: str | None = None
    try:
        job_ids = queue.get_job_ids(offset=0, length=1)
        if job_ids:
            oldest_job_id = str(job_ids[0])
            job = Job.fetch(oldest_job_id, connection=connection)
            enqueued_at = getattr(job, "enqueued_at", None) or getattr(job, "created_at", None)
            if enqueued_at:
                now = datetime.now(timezone.utc)
                if enqueued_at.tzinfo is None:
                    enqueued_at = enqueued_at.replace(tzinfo=timezone.utc)
                oldest_queued_seconds = max(0.0, (now - enqueued_at).total_seconds())
    except Exception:
        oldest_queued_seconds = None
        oldest_job_id = None
    workers = []
    try:
        for worker in Worker.all(connection=connection, queue=queue):
            workers.append(
                {
                    "name": worker.name,
                    "state": str(getattr(worker, "state", "")),
                    "queues": worker.queue_names(),
                }
            )
    except Exception:
        workers = []
    return {
        "queue_name": queue.name,
        "queued_count": queue.count,
        "oldest_job_id": oldest_job_id,
        "oldest_queued_seconds": oldest_queued_seconds,
        "workers": workers,
        "active_worker_count": len(workers),
        "has_active_worker": bool(workers),
        "in_process_worker_enabled": get_settings().enable_in_process_broker_chat_worker,
        "has_processing_path": bool(workers) or get_settings().enable_in_process_broker_chat_worker,
    }
