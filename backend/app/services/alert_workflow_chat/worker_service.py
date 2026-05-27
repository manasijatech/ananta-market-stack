from __future__ import annotations

import asyncio
import logging
import os
import uuid

from rq import SimpleWorker
from rq.timeouts import TimerDeathPenalty

from app.config import get_settings
from app.services.alert_workflow_chat import sessions
from app.services.alert_workflow_chat.queue import (
    IN_PROCESS_WORKER_NAME_PREFIX,
    alert_workflow_chat_external_worker_available,
    alert_workflow_chat_queue,
    redis_connection,
)
from db.session import SessionLocal

logger = logging.getLogger(__name__)


class AlertWorkflowChatSimpleWorker(SimpleWorker):
    death_penalty_class = TimerDeathPenalty

    def _install_signal_handlers(self) -> None:
        return None


def reconcile_alert_workflow_chat_jobs_on_startup() -> None:
    db = SessionLocal()
    try:
        result = sessions.reconcile_incomplete_runs(db)
        if result["checked"]:
            logger.info("alert workflow chat startup queue reconciliation: %s", result)
    except Exception:
        logger.exception("alert workflow chat startup queue reconciliation failed")
    finally:
        db.close()


async def run_alert_workflow_chat_worker(stop_event: asyncio.Event) -> None:
    settings = get_settings()
    await asyncio.to_thread(reconcile_alert_workflow_chat_jobs_on_startup)
    while not stop_event.is_set():
        try:
            queue = alert_workflow_chat_queue()
            if queue.count:
                if alert_workflow_chat_external_worker_available():
                    logger.debug("alert workflow chat scoped RQ worker is available; in-process fallback is idle")
                else:
                    worker = AlertWorkflowChatSimpleWorker(
                        [queue],
                        connection=redis_connection(),
                        name=f"{IN_PROCESS_WORKER_NAME_PREFIX}{os.getpid()}-{uuid.uuid4().hex[:8]}",
                    )
                    await asyncio.to_thread(worker.work, burst=True, max_jobs=1)
        except Exception:
            logger.exception("alert workflow chat in-process worker iteration failed")
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=settings.alert_workflow_chat_worker_poll_seconds)
        except asyncio.TimeoutError:
            continue

