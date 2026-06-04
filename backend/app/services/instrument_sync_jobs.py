from __future__ import annotations

import logging
import threading

from sqlalchemy.orm import Session

from app.schemas.broker import InstrumentSyncOut, VerifyOut
from app.services import broker_data
from app.services.broker_data_preferences import _account_session_active
from broker.core.instrument_store import latest_sync_run
from db.models import BrokerAccount
from db.session import SessionLocal

logger = logging.getLogger(__name__)

_lock = threading.Lock()
_inflight: set[str] = set()


def instrument_cache_ready(db: Session, acc: BrokerAccount) -> bool:
    return broker_data.instrument_cache_available(db, acc.broker_code)


def schedule_instrument_sync(account_id: str) -> bool:
    with _lock:
        if account_id in _inflight:
            return False
        _inflight.add(account_id)
    thread = threading.Thread(
        target=_run_instrument_sync,
        args=(account_id,),
        name=f"instrument-sync-{account_id}",
        daemon=True,
    )
    thread.start()
    return True


def schedule_instrument_sync_if_needed(db: Session, acc: BrokerAccount) -> bool:
    if not acc.is_active:
        return False
    if not _account_session_active(acc) and not acc.last_verified_at:
        return False

    last_run = latest_sync_run(db, acc.broker_code)
    if last_run and last_run.status == "running":
        return False
    if instrument_cache_ready(db, acc.broker_code):
        if last_run and last_run.status in {"completed", "preserved"}:
            return False
    return schedule_instrument_sync(acc.id)


def is_instrument_sync_inflight(account_id: str) -> bool:
    with _lock:
        return account_id in _inflight


def instrument_sync_status(db: Session, acc: BrokerAccount) -> InstrumentSyncOut | None:
    last_run = latest_sync_run(db, acc.broker_code)
    if last_run is None and not is_instrument_sync_inflight(acc.id):
        return None
    if last_run is None:
        return InstrumentSyncOut(
            broker=acc.broker_code,
            sync_status="running",
            row_count=0,
            error=None,
            storage_target="db+csv",
        )
    return InstrumentSyncOut(
        broker=acc.broker_code,
        sync_status="running" if is_instrument_sync_inflight(acc.id) and last_run.status != "running" else last_run.status,
        row_count=last_run.row_count,
        started_at=last_run.started_at,
        finished_at=last_run.finished_at,
        error=last_run.error,
        storage_target="db+csv",
    )


def build_verify_out(db: Session, acc: BrokerAccount, ok: bool, message: str) -> VerifyOut:
    if not ok:
        return VerifyOut(ok=False, message=message or "")

    scheduled = schedule_instrument_sync_if_needed(db, acc)
    sync_status, sync_message = _sync_user_message(db, acc, scheduled=scheduled)
    return VerifyOut(
        ok=True,
        message=message or "",
        instrument_sync_scheduled=scheduled,
        instrument_sync_status=sync_status,
        instrument_sync_message=sync_message,
    )


def _sync_user_message(db: Session, acc: BrokerAccount, *, scheduled: bool) -> tuple[str | None, str | None]:
    last_run = latest_sync_run(db, acc.broker_code)
    inflight = is_instrument_sync_inflight(acc.id)
    running = inflight or (last_run is not None and last_run.status == "running")

    if running or scheduled:
        return (
            "running" if running else "scheduled",
            "Downloading the broker instrument master in the background. Symbol search and workflows "
            "will work once this finishes; you can stay on this page.",
        )

    if instrument_cache_ready(db, acc):
        return "completed", None

    if last_run and last_run.status == "failed":
        return (
            "failed",
            last_run.error
            or "Instrument sync failed. Open Test data APIs and run instrument sync, or click Verify again.",
        )

    return (
        "pending",
        "Instrument search is not ready yet. Click Verify or wait a moment for the background sync to start.",
    )


def _run_instrument_sync(account_id: str) -> None:
    db = SessionLocal()
    try:
        acc = db.get(BrokerAccount, account_id)
        if not acc or not acc.is_active:
            return
        try:
            broker_data.sync_instruments_to_db(db, acc)
        except Exception:
            logger.exception("Background instrument DB sync failed for account %s", account_id)
        try:
            broker_data.sync_instruments_to_csv(db, acc)
        except Exception:
            logger.exception("Background instrument CSV sync failed for account %s", account_id)
    finally:
        db.close()
        with _lock:
            _inflight.discard(account_id)
