from __future__ import annotations

import json
import threading
from datetime import datetime, timedelta

from common.datetime_compat import UTC
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.schemas.broker import (
    BrokerAccountOut,
    BrokerDataDefaultAccountOut,
    BrokerDataDefaultConfigOut,
    BrokerDataDefaultConfigUpdateIn,
    BrokerDataSearchAccountOut,
    BrokerDataSearchConfigOut,
    BrokerDataSearchConfigUpdateIn,
    InstrumentSearchRow,
)
from app.services import broker_data
from app.services import broker_sessions as broker_session_svc
from broker.core.instrument_store import latest_sync_run
from db.models import BrokerAccount, BrokerHoldingsSnapshot, UserBrokerDataPreference
from db.session import SessionLocal

_HOLDINGS_REFRESH_INTERVAL = timedelta(minutes=5)
_RECOVERY_COOLDOWN = timedelta(minutes=10)
_inflight_recoveries: set[str] = set()
_recovery_lock = threading.Lock()


def _now_utc_naive() -> datetime:
    return datetime.now(tz=UTC).replace(tzinfo=None)


def _account_session_active(acc: BrokerAccount) -> bool:
    try:
        return bool(broker_session_svc.get_broker_session_status(acc).session_active)
    except Exception:
        return False


def _clear_stale_session_error_if_active(db: Session, acc: BrokerAccount) -> None:
    if not acc.is_active:
        return
    if not (acc.last_error or acc.session_status in {"pending", "action_required", "automation_ready"}):
        return
    if not _account_session_active(acc):
        return
    broker_session_svc.mark_session_healthy(db, acc, verified_at=acc.last_verified_at)
    db.add(acc)
    db.commit()
    db.refresh(acc)


def _get_preference(db: Session, user_id: str) -> UserBrokerDataPreference | None:
    return db.get(UserBrokerDataPreference, user_id)


def _default_preferred_account_id(accounts: list[BrokerAccount]) -> str | None:
    verified = [row for row in accounts if row.last_verified_at]
    ordered = verified or accounts
    return ordered[0].id if ordered else None


def _default_data_preferred_account_id(accounts: list[BrokerAccount]) -> str | None:
    verified = [row for row in accounts if row.last_verified_at]
    verified.sort(key=lambda row: (row.last_verified_at or row.created_at, row.created_at), reverse=True)
    ordered = verified or accounts
    return ordered[0].id if ordered else None


def _candidate_order(
    accounts: list[BrokerAccount],
    preferred_account_id: str | None,
) -> list[BrokerAccount]:
    account_map = {row.id: row for row in accounts}
    ordered: list[BrokerAccount] = []
    if preferred_account_id and preferred_account_id in account_map:
        ordered.append(account_map[preferred_account_id])
    remaining = [row for row in accounts if row.id != preferred_account_id]
    remaining.sort(key=lambda row: (0 if row.last_verified_at else 1, row.created_at, row.id))
    ordered.extend(remaining)
    return ordered


def _default_account_summaries(
    db: Session,
    user_id: str,
) -> tuple[list[BrokerDataDefaultAccountOut], str | None, str | None]:
    accounts = list(
        db.scalars(
            select(BrokerAccount)
            .where(BrokerAccount.user_id == user_id, BrokerAccount.is_active.is_(True))
            .order_by(BrokerAccount.created_at.asc(), BrokerAccount.id.asc())
        ).all()
    )
    pref = _get_preference(db, user_id)
    preferred_account_id = pref.preferred_default_account_id if pref else None
    if preferred_account_id and not any(row.id == preferred_account_id for row in accounts):
        preferred_account_id = None
    if preferred_account_id is None:
        preferred_account_id = _default_data_preferred_account_id(accounts)

    ordered = _candidate_order(accounts, preferred_account_id)
    session_active: dict[str, bool] = {}
    effective_account_id: str | None = None
    for acc in ordered:
        session_active[acc.id] = _account_session_active(acc)
        if acc.last_verified_at and session_active[acc.id]:
            effective_account_id = acc.id
            break

    summaries: list[BrokerDataDefaultAccountOut] = []
    for acc in ordered:
        active = session_active.get(acc.id)
        if active is None:
            active = _account_session_active(acc)
        summaries.append(
            BrokerDataDefaultAccountOut(
                account_id=acc.id,
                broker_code=acc.broker_code,
                label=acc.label,
                is_verified=bool(acc.last_verified_at),
                session_status=acc.session_status,
                session_active=active,
                is_preferred=acc.id == preferred_account_id,
                is_effective=acc.id == effective_account_id,
                last_verified_at=acc.last_verified_at,
                last_error=acc.last_error,
            )
        )
    return summaries, preferred_account_id, effective_account_id


def _search_account_summaries(
    db: Session,
    user_id: str,
) -> tuple[list[BrokerDataSearchAccountOut], str | None, str | None]:
    accounts = list(
        db.scalars(
            select(BrokerAccount)
            .where(BrokerAccount.user_id == user_id, BrokerAccount.is_active.is_(True))
            .order_by(BrokerAccount.created_at.asc(), BrokerAccount.id.asc())
        ).all()
    )
    pref = _get_preference(db, user_id)
    preferred_account_id = pref.preferred_search_account_id if pref else None
    if preferred_account_id and not any(row.id == preferred_account_id for row in accounts):
        preferred_account_id = None
    if preferred_account_id is None:
        preferred_account_id = _default_preferred_account_id(accounts)

    cache_counts: dict[str, int] = {}
    sync_runs = {}
    ordered = _candidate_order(accounts, preferred_account_id)

    effective_account_id: str | None = None
    for acc in ordered:
        if acc.broker_code not in cache_counts:
            cache_counts[acc.broker_code] = broker_data.cached_instrument_count(db, acc.broker_code)
        has_cache = cache_counts[acc.broker_code] > 0 or broker_data.instrument_cache_available(db, acc.broker_code)
        if has_cache:
            effective_account_id = acc.id
            break

    summaries: list[BrokerDataSearchAccountOut] = []
    for acc in ordered:
        if acc.broker_code not in cache_counts:
            cache_counts[acc.broker_code] = broker_data.cached_instrument_count(db, acc.broker_code)
        if acc.broker_code not in sync_runs:
            sync_runs[acc.broker_code] = latest_sync_run(db, acc.broker_code)
        cache_available = cache_counts[acc.broker_code] > 0 or broker_data.instrument_cache_available(db, acc.broker_code)
        snapshot = db.get(BrokerHoldingsSnapshot, acc.id)
        sync_run = sync_runs[acc.broker_code]
        summaries.append(
            BrokerDataSearchAccountOut(
                account_id=acc.id,
                broker_code=acc.broker_code,
                label=acc.label,
                is_verified=bool(acc.last_verified_at),
                session_status=acc.session_status,
                session_active=_account_session_active(acc),
                is_preferred=acc.id == preferred_account_id,
                is_effective=acc.id == effective_account_id,
                search_available=cache_available,
                holdings_status=snapshot.status if snapshot else None,
                holdings_count=snapshot.holdings_count if snapshot else 0,
                holdings_fetched_at=snapshot.fetched_at if snapshot else None,
                latest_instrument_sync_status=sync_run.status if sync_run else None,
                latest_instrument_sync_started_at=sync_run.started_at if sync_run else None,
                latest_instrument_sync_finished_at=sync_run.finished_at if sync_run else None,
                latest_instrument_sync_error=sync_run.error if sync_run else None,
                last_error=acc.last_error or (snapshot.error if snapshot else None),
            )
        )
    return summaries, preferred_account_id, effective_account_id


def list_broker_accounts_with_preferences(db: Session, user_id: str) -> list[BrokerAccountOut]:
    preferred = _get_preference(db, user_id)
    preferred_account_id = preferred.preferred_search_account_id if preferred else None
    accounts = list(
        db.scalars(
            select(BrokerAccount)
            .where(BrokerAccount.user_id == user_id)
            .order_by(BrokerAccount.created_at.asc(), BrokerAccount.id.asc())
        ).all()
    )
    default_preferred = preferred_account_id or _default_preferred_account_id(
        [row for row in accounts if row.is_active]
    )
    result: list[BrokerAccountOut] = []
    for row in accounts:
        _clear_stale_session_error_if_active(db, row)
        out = BrokerAccountOut.model_validate(row)
        out.is_preferred_instrument_search = row.id == default_preferred
        result.append(out)
    return result


def broker_account_with_preference(
    db: Session,
    acc: BrokerAccount,
) -> BrokerAccountOut:
    _clear_stale_session_error_if_active(db, acc)
    preferred = _get_preference(db, acc.user_id)
    preferred_account_id = preferred.preferred_search_account_id if preferred else None
    if preferred_account_id is None and acc.is_active:
        preferred_account_id = _default_preferred_account_id(
            list(
                db.scalars(
                    select(BrokerAccount)
                    .where(BrokerAccount.user_id == acc.user_id, BrokerAccount.is_active.is_(True))
                    .order_by(BrokerAccount.created_at.asc(), BrokerAccount.id.asc())
                ).all()
            )
        )
    out = BrokerAccountOut.model_validate(acc)
    out.is_preferred_instrument_search = acc.id == preferred_account_id
    return out


def get_broker_data_search_config(db: Session, user_id: str) -> BrokerDataSearchConfigOut:
    accounts, preferred_account_id, effective_account_id = _search_account_summaries(db, user_id)
    return BrokerDataSearchConfigOut(
        preferred_search_account_id=preferred_account_id,
        effective_search_account_id=effective_account_id,
        fallback_used=bool(
            preferred_account_id and effective_account_id and preferred_account_id != effective_account_id
        ),
        accounts=accounts,
    )


def update_broker_data_search_config(
    db: Session,
    user_id: str,
    payload: BrokerDataSearchConfigUpdateIn,
) -> BrokerDataSearchConfigOut:
    preferred_account_id = payload.preferred_search_account_id
    if preferred_account_id:
        acc = db.get(BrokerAccount, preferred_account_id)
        if not acc or acc.user_id != user_id or not acc.is_active:
            raise ValueError("preferred search broker account not found")
    pref = _get_preference(db, user_id)
    if pref is None:
        pref = UserBrokerDataPreference(
            user_id=user_id,
            preferred_search_account_id=preferred_account_id,
        )
    else:
        pref.preferred_search_account_id = preferred_account_id
    db.add(pref)
    db.commit()
    return get_broker_data_search_config(db, user_id)


def get_broker_data_default_config(db: Session, user_id: str) -> BrokerDataDefaultConfigOut:
    accounts, preferred_account_id, effective_account_id = _default_account_summaries(db, user_id)
    return BrokerDataDefaultConfigOut(
        preferred_default_account_id=preferred_account_id,
        effective_default_account_id=effective_account_id,
        fallback_used=bool(
            preferred_account_id and effective_account_id and preferred_account_id != effective_account_id
        ),
        accounts=accounts,
    )


def update_broker_data_default_config(
    db: Session,
    user_id: str,
    payload: BrokerDataDefaultConfigUpdateIn,
) -> BrokerDataDefaultConfigOut:
    preferred_account_id = payload.preferred_default_account_id
    if preferred_account_id:
        acc = db.get(BrokerAccount, preferred_account_id)
        if not acc or acc.user_id != user_id or not acc.is_active:
            raise ValueError("preferred default broker account not found")
    pref = _get_preference(db, user_id)
    if pref is None:
        pref = UserBrokerDataPreference(
            user_id=user_id,
            preferred_default_account_id=preferred_account_id,
        )
    else:
        pref.preferred_default_account_id = preferred_account_id
    db.add(pref)
    db.commit()
    return get_broker_data_default_config(db, user_id)


def get_effective_default_broker_account(
    db: Session,
    user_id: str,
    broker_code: str | None = None,
) -> BrokerAccount | None:
    stmt = (
        select(BrokerAccount)
        .where(BrokerAccount.user_id == user_id, BrokerAccount.is_active.is_(True))
        .order_by(BrokerAccount.created_at.asc(), BrokerAccount.id.asc())
    )
    if broker_code:
        stmt = stmt.where(BrokerAccount.broker_code == broker_code)
    accounts = list(db.scalars(stmt).all())
    if not accounts:
        return None

    pref = _get_preference(db, user_id)
    preferred_account_id = pref.preferred_default_account_id if pref else None
    if preferred_account_id is None and not broker_code:
        preferred_account_id = _default_data_preferred_account_id(accounts)
    ordered = _candidate_order(accounts, preferred_account_id)
    for account in ordered:
        if account.last_verified_at and _account_session_active(account):
            return account
    return None


def get_stream_default_broker_account(
    db: Session,
    user_id: str,
    broker_code: str | None = None,
) -> BrokerAccount | None:
    account = get_effective_default_broker_account(db, user_id, broker_code)
    if account is not None:
        return account

    stmt = (
        select(BrokerAccount)
        .where(BrokerAccount.user_id == user_id, BrokerAccount.is_active.is_(True))
        .order_by(BrokerAccount.created_at.asc(), BrokerAccount.id.asc())
    )
    if broker_code:
        stmt = stmt.where(BrokerAccount.broker_code == broker_code)
    accounts = list(db.scalars(stmt).all())
    if not accounts:
        return None

    pref = _get_preference(db, user_id)
    preferred_account_id = pref.preferred_default_account_id if pref else None
    if preferred_account_id is None and not broker_code:
        preferred_account_id = _default_data_preferred_account_id(accounts)
    ordered = _candidate_order(accounts, preferred_account_id)
    return ordered[0] if ordered else None


def maybe_schedule_instrument_recovery(db: Session, acc: BrokerAccount) -> bool:
    if not _account_session_active(acc):
        return False
    from broker.core.instrument_store import reconcile_stale_sync_run
    from app.services.instrument_sync_jobs import is_instrument_sync_inflight, schedule_instrument_sync

    reconcile_stale_sync_run(
        db,
        acc.broker_code,
        inflight=is_instrument_sync_inflight(acc.id),
    )
    last_run = latest_sync_run(db, acc.broker_code)
    now = _now_utc_naive()
    if last_run and last_run.status == "running" and is_instrument_sync_inflight(acc.id):
        return False
    if (
        last_run
        and last_run.started_at
        and now - last_run.started_at < _RECOVERY_COOLDOWN
        and last_run.status in {"completed", "preserved"}
    ):
        return False

    with _recovery_lock:
        if acc.id in _inflight_recoveries:
            return False
        _inflight_recoveries.add(acc.id)

    def _recovery_wrapper(account_id: str) -> None:
        try:
            schedule_instrument_sync(account_id)
        finally:
            with _recovery_lock:
                _inflight_recoveries.discard(account_id)

    thread = threading.Thread(
        target=_recovery_wrapper,
        args=(acc.id,),
        name=f"instrument-recovery-{acc.id}",
        daemon=True,
    )
    thread.start()
    return True


def search_instruments_for_user(
    db: Session,
    user_id: str,
    *,
    query: str = "",
    exchange: str | None = None,
    segment: str | None = None,
    limit: int = 50,
) -> list[InstrumentSearchRow]:
    accounts = list(
        db.scalars(
            select(BrokerAccount)
            .where(BrokerAccount.user_id == user_id, BrokerAccount.is_active.is_(True))
            .order_by(BrokerAccount.created_at.asc(), BrokerAccount.id.asc())
        ).all()
    )
    preferred = _get_preference(db, user_id)
    preferred_account_id = preferred.preferred_search_account_id if preferred else None
    if preferred_account_id is None:
        preferred_account_id = _default_preferred_account_id(accounts)
    ordered = _candidate_order(accounts, preferred_account_id)

    preferred_account = next((row for row in ordered if row.id == preferred_account_id), None)
    if preferred_account and not broker_data.instrument_cache_available(db, preferred_account.broker_code):
        maybe_schedule_instrument_recovery(db, preferred_account)

    for acc in ordered:
        if not broker_data.instrument_cache_available(db, acc.broker_code):
            continue
        rows = broker_data.search_instruments(
            db,
            acc,
            query=query,
            exchange=exchange,
            segment=segment,
            limit=limit,
        )
        if rows:
            return rows
    return []


def refresh_holdings_snapshot(db: Session, acc: BrokerAccount, *, force: bool = False) -> BrokerHoldingsSnapshot:
    snapshot = db.get(BrokerHoldingsSnapshot, acc.id)
    now = _now_utc_naive()
    if snapshot is None:
        snapshot = BrokerHoldingsSnapshot(
            account_id=acc.id,
            user_id=acc.user_id,
            broker_code=acc.broker_code,
        )
    if not force and snapshot.fetched_at and now - snapshot.fetched_at < _HOLDINGS_REFRESH_INTERVAL:
        return snapshot
    if not _account_session_active(acc):
        snapshot.status = "action_required"
        snapshot.error = acc.last_error or "Broker session is not active."
        snapshot.updated_at = now
        db.add(snapshot)
        db.commit()
        db.refresh(snapshot)
        return snapshot
    try:
        payload = broker_data.fetch_holdings(db, acc)
        snapshot.status = "completed"
        snapshot.payload_json = json.dumps(payload, default=str)
        snapshot.holdings_count = broker_data.count_holdings_rows(payload)
        snapshot.error = None
        snapshot.fetched_at = now
    except Exception as exc:
        snapshot.status = "failed"
        snapshot.error = str(exc)[:2000]
        snapshot.fetched_at = now
    snapshot.updated_at = now
    db.add(snapshot)
    db.commit()
    db.refresh(snapshot)
    return snapshot


def run_holdings_refresh_cycle(*, force: bool = False) -> None:
    db = SessionLocal()
    try:
        accounts = list(
            db.scalars(select(BrokerAccount).where(BrokerAccount.is_active.is_(True))).all()
        )
        for acc in accounts:
            try:
                refresh_holdings_snapshot(db, acc, force=force)
            except Exception:
                continue
    finally:
        db.close()
