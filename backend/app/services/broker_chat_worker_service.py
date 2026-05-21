from __future__ import annotations

import asyncio
import logging

from rq import SimpleWorker

from app.config import get_settings
from app.services import broker_chat
from app.services.broker_chat_queue import broker_chat_queue, redis_connection
from db.session import SessionLocal

logger = logging.getLogger(__name__)


class BrokerChatSimpleWorker(SimpleWorker):
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
    while not stop_event.is_set():
        try:
            queue = broker_chat_queue()
            if queue.count:
                worker = BrokerChatSimpleWorker([queue], connection=redis_connection())
                await asyncio.to_thread(worker.work, burst=True, max_jobs=1)
        except Exception:
            logger.exception("broker chat in-process worker iteration failed")
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=settings.broker_chat_worker_poll_seconds)
        except asyncio.TimeoutError:
            continue
