from __future__ import annotations

import logging

from rq import Worker

from app.services.broker_chat_queue import broker_chat_queue, redis_connection

logger = logging.getLogger(__name__)


def main() -> None:
    queue = broker_chat_queue()
    worker = Worker([queue], connection=redis_connection())
    logger.info("Starting broker chat RQ worker for queue %s", queue.name)
    worker.work()


if __name__ == "__main__":
    main()
