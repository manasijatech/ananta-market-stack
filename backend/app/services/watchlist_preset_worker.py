from __future__ import annotations

import asyncio
import logging

from app.config import get_settings
from app.services.watchlist_presets import refresh_due_presets
from db.session import SessionLocal

logger = logging.getLogger(__name__)


async def run_watchlist_preset_worker(stop_event: asyncio.Event) -> None:
    interval_seconds = max(300, get_settings().watchlist_preset_worker_interval_seconds)
    while not stop_event.is_set():
        db = SessionLocal()
        try:
            refresh_due_presets(db)
        except Exception:
            logger.exception("watchlist preset sync worker failed")
        finally:
            db.close()
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=interval_seconds)
        except asyncio.TimeoutError:
            continue
