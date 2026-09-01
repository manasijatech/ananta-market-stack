from __future__ import annotations

import logging

from rq import Worker
from rq.worker_pool import WorkerPool

from app.config import get_settings
from app.services.broker_chat_queue import broker_chat_queue, redis_connection
from app.services.broker_chat_worker_service import reconcile_broker_chat_jobs_on_startup

logger = logging.getLogger(__name__)


def main() -> None:
    # Reconcile once in the parent. Child workers only consume jobs.
    reconcile_broker_chat_jobs_on_startup()
    settings = get_settings()
    count = int(settings.broker_chat_worker_count)
    queue = broker_chat_queue()
    connection = redis_connection()
    logger.info("Starting broker chat RQ workers count=%s queue=%s", count, queue.name)
    if count == 1:
        Worker([queue], connection=connection, name="broker-chat-0").work()
        return
    WorkerPool([queue], connection=connection, num_workers=count).start()


if __name__ == "__main__":
    main()
