from __future__ import annotations

import logging
import os

from rq import Worker
from rq.worker_pool import WorkerPool

from app.config import get_settings
from app.services.broker_chat_queue import broker_chat_queue, redis_connection
from app.services.broker_chat_worker_service import BrokerChatSimpleWorker, reconcile_broker_chat_jobs_on_startup

logger = logging.getLogger(__name__)


def main() -> None:
    # Reconcile once in the parent. Child workers only consume jobs.
    reconcile_broker_chat_jobs_on_startup()
    settings = get_settings()
    count = int(settings.broker_chat_worker_count)
    queue = broker_chat_queue()
    connection = redis_connection()
    logger.info("Starting broker chat RQ workers count=%s queue=%s", count, queue.name)
    # Windows cannot os.fork(); RQ's default Worker/WorkerPool crash on every job.
    if os.name == "nt":
        import uuid

        worker_name = f"broker-chat-windows-{os.getpid()}-{uuid.uuid4().hex[:8]}"
        logger.info("Using SimpleWorker on Windows (no fork) name=%s", worker_name)
        BrokerChatSimpleWorker([queue], connection=connection, name=worker_name).work()
        return
    if count == 1:
        Worker([queue], connection=connection, name="broker-chat-0").work()
        return
    WorkerPool([queue], connection=connection, num_workers=count).start()


if __name__ == "__main__":
    main()
