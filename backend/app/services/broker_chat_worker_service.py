from __future__ import annotations

import asyncio
import logging

from rq import SimpleWorker

from app.config import get_settings
from app.services.broker_chat_queue import broker_chat_queue, redis_connection

logger = logging.getLogger(__name__)


class BrokerChatSimpleWorker(SimpleWorker):
    def _install_signal_handlers(self) -> None:
        return None


async def run_broker_chat_worker(stop_event: asyncio.Event) -> None:
    """Run a small in-process RQ worker for local/single-process deployments."""

    settings = get_settings()
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
