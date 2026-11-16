from __future__ import annotations

import asyncio
import logging
import os
import uuid

from rq import SimpleWorker
from rq.timeouts import TimerDeathPenalty

from app.config import get_settings
from app.services.idle_backoff import IdleBackoff
from app.services import broker_chat
from app.services.broker_chat_queue import (
    IN_PROCESS_WORKER_NAME_PREFIX,
    broker_chat_external_worker_available,
    broker_chat_queue,
)
from db.session import SessionLocal

logger = logging.getLogger(__name__)


class BrokerChatSimpleWorker(SimpleWorker):
    death_penalty_class = TimerDeathPenalty

    def _install_signal_handlers(self) -> None:
        return None


def reconcile_broker_chat_jobs_on_startup() -> None:
    db = SessionLocal()
    try:
        result = broker_chat.reconcile_incomplete_runs(db)
        if result["checked"]:
            logger.info("broker chat startup queue reconciliation: %s", result)
    except Exception:
        logger.exception("broker chat startup queue reconciliation failed")
    finally:
        db.close()


async def run_broker_chat_worker(stop_event: asyncio.Event) -> None:
    """Run a small in-process RQ worker for local/single-process deployments."""

    settings = get_settings()
    await asyncio.to_thread(reconcile_broker_chat_jobs_on_startup)
    backoff = IdleBackoff(settings.broker_chat_worker_poll_seconds, maximum_seconds=settings.chat_worker_idle_max_seconds)
    queue = None
    while not stop_event.is_set():
        busy = False
        try:
            if queue is None:
                queue = broker_chat_queue()
            if queue.count:
                busy = True
                if broker_chat_external_worker_available():
                    logger.debug("broker chat scoped RQ worker is available; in-process fallback is idle")
                else:
                    worker = BrokerChatSimpleWorker(
                        [queue],
                        connection=queue.connection,
                        name=f"{IN_PROCESS_WORKER_NAME_PREFIX}{os.getpid()}-{uuid.uuid4().hex[:8]}",
                    )
                    await asyncio.to_thread(worker.work, burst=True, max_jobs=1)
        except Exception:
            queue = None
            logger.exception("broker chat in-process worker iteration failed")
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=backoff.next_delay(busy=busy))
        except asyncio.TimeoutError:
            continue
