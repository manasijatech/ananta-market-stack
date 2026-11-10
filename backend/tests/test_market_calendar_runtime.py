"""Market-calendar behaviour of the alert runtime and background workers.

These tests pin the guarantee that a holiday produces a visible skip instead of
a forced run, a retry storm, or a silently idle worker.
"""

from __future__ import annotations

import json
from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.schemas.alert import AlertWorkflowActivePeriod
from app.services import alert_runtime
from app.services import instrument_sync_jobs
from app.services.alerts_engine.active_period import evaluate_active_period
from app.schemas.alert import AlertWorkflowDsl
from db.models import AlertWorkflow, AlertWorkflowRun, User
from db.session import Base

IST = ZoneInfo("Asia/Kolkata")


def ist(year: int, month: int, day: int, hour: int = 11, minute: int = 0) -> datetime:
    return datetime(year, month, day, hour, minute, tzinfo=IST)


@pytest.fixture()
def db_session():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    session = Session()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


def _workflow(db, *, workflow_id: str = "wf-1", dsl: AlertWorkflowDsl | None = None) -> AlertWorkflow:
    db.add(User(id="u1", display_name=None))
    payload = (dsl or AlertWorkflowDsl()).model_dump(mode="json")
    row = AlertWorkflow(
        id=workflow_id,
        user_id="u1",
        name="Test workflow",
        status="active",
        workflow_dsl_json=json.dumps(payload),
        graph_dsl_json="{}",
    )
    db.add(row)
    db.commit()
    return row


# --- active period honours the calendar -------------------------------------


def test_active_period_is_inactive_on_a_verified_holiday():
    result = evaluate_active_period(
        AlertWorkflowActivePeriod(),
        {"exchange": "NSE", "segment": "cash", "instrument_type": "EQ"},
        now=ist(2026, 11, 10, 11, 0),
    )
    assert result.active is False
    assert result.reason == "market holiday"
    assert result.details["calendar"]["phase"] == "holiday"


def test_active_period_is_inactive_on_a_weekend():
    result = evaluate_active_period(
        AlertWorkflowActivePeriod(),
        {"exchange": "NSE", "segment": "cash"},
        now=ist(2026, 11, 14, 11, 0),
    )
    assert result.active is False
    assert result.reason == "market weekend"


def test_active_period_still_evaluates_normally_inside_the_session():
    result = evaluate_active_period(
        AlertWorkflowActivePeriod(),
        {"exchange": "NSE", "segment": "cash"},
        now=ist(2026, 11, 11, 11, 0),
    )
    assert result.active is True
    assert result.details["calendar"]["phase"] == "continuous"


def test_continuous_phase_mode_blocks_pre_open():
    config = AlertWorkflowActivePeriod(calendar_phase="continuous")
    result = evaluate_active_period(
        config,
        {"exchange": "NSE", "segment": "cash"},
        now=ist(2026, 11, 11, 9, 5),
    )
    assert result.active is False
    assert result.reason == "outside continuous trading"


def test_feed_path_ignores_the_market_calendar():
    """News is new information on a holiday, not a pointless poll."""
    result = evaluate_active_period(
        AlertWorkflowActivePeriod(),
        {},
        now=ist(2026, 11, 10, 11, 0),
        apply_market_calendar=False,
    )
    assert result.active is True
    assert "calendar" not in result.details


def test_calendar_can_be_disabled_per_workflow():
    config = AlertWorkflowActivePeriod(respect_market_calendar=False)
    result = evaluate_active_period(
        config,
        {"exchange": "NSE", "segment": "cash"},
        now=ist(2026, 11, 10, 11, 0),
    )
    assert result.active is True


# --- market-bound polling ---------------------------------------------------


def test_live_polling_is_closed_on_a_holiday():
    assert alert_runtime._market_polling_open(now=ist(2026, 11, 10, 11, 0)) is False
    assert alert_runtime.closed_market_skip_reason(now=ist(2026, 11, 10, 11, 0)).startswith("skipped: market holiday")
    assert alert_runtime.closed_market_skip_reason(now=ist(2026, 11, 14, 11, 0)) == "skipped: weekend"


def test_live_polling_is_open_during_the_session():
    assert alert_runtime._market_polling_open(now=ist(2026, 11, 11, 11, 0)) is True
    assert alert_runtime._market_polling_open(now=ist(2026, 11, 11, 18, 0)) is False


def test_backfill_publishes_nothing_when_the_market_is_closed(monkeypatch):
    calls: list[str] = []
    monkeypatch.setattr(alert_runtime, "_redis", lambda: calls.append("redis"))

    # The function reads the clock, so drive it through the session gate.
    monkeypatch.setattr(alert_runtime, "_market_polling_open", lambda now=None: False)
    assert alert_runtime.backfill_live_prices_for_user("u1") == 0
    assert calls == []


# --- visible skip entry -----------------------------------------------------


def test_closed_session_records_one_visible_skip_per_workflow(db_session):
    _workflow(db_session)
    created = alert_runtime.record_market_skip_for_closed_session(db_session, now=ist(2026, 11, 10, 11, 0))
    assert created == 1

    runs = db_session.query(AlertWorkflowRun).all()
    assert len(runs) == 1
    assert runs[0].matched is False
    # The contract names the holiday when one is known.
    assert runs[0].reason == "skipped: market holiday (Diwali-Balipratipada)"
    assert json.loads(runs[0].evaluation_payload_json)["market_calendar"]["phase"] == "holiday"


def test_skip_is_recorded_only_once_per_day(db_session):
    _workflow(db_session)
    assert alert_runtime.record_market_skip_for_closed_session(db_session, now=ist(2026, 11, 10, 9, 0)) == 1
    assert alert_runtime.record_market_skip_for_closed_session(db_session, now=ist(2026, 11, 10, 15, 0)) == 0
    # The next closed day gets its own entry.
    assert alert_runtime.record_market_skip_for_closed_session(db_session, now=ist(2026, 11, 14, 9, 0)) == 1


def test_skip_is_not_recorded_for_feed_only_workflows(db_session):
    dsl = AlertWorkflowDsl(broker_trigger={"enabled": False}, feed_trigger={"enabled": True})
    _workflow(db_session, dsl=dsl)
    assert alert_runtime.record_market_skip_for_closed_session(db_session, now=ist(2026, 11, 10, 11, 0)) == 0


def test_skip_is_not_recorded_when_the_workflow_ignores_the_calendar(db_session):
    dsl = AlertWorkflowDsl(active_period={"respect_market_calendar": False})
    _workflow(db_session, dsl=dsl)
    assert alert_runtime.record_market_skip_for_closed_session(db_session, now=ist(2026, 11, 10, 11, 0)) == 0


def test_no_skip_is_recorded_before_the_open_on_a_trading_day(db_session):
    """The quiet pre-market minutes are not a holiday; do not invent a skip row."""
    _workflow(db_session)
    assert alert_runtime.record_market_skip_for_closed_session(db_session, now=ist(2026, 11, 11, 8, 0)) == 0
    assert alert_runtime.record_market_skip_for_closed_session(db_session, now=ist(2026, 11, 11, 18, 0)) == 0


# --- instrument sync --------------------------------------------------------


class _Account:
    def __init__(self, broker_code: str = "zerodha") -> None:
        self.id = "acc-1"
        self.broker_code = broker_code
        self.is_active = True
        self.last_verified_at = datetime(2026, 11, 1, 6, 30)
        self.user_id = "u1"


def test_instrument_sync_is_not_scheduled_on_a_holiday(monkeypatch, db_session):
    scheduled: list[str] = []
    monkeypatch.setattr(instrument_sync_jobs, "schedule_instrument_sync", lambda account_id: scheduled.append(account_id) or True)
    monkeypatch.setattr(instrument_sync_jobs, "instrument_cache_ready", lambda db, acc: False)
    monkeypatch.setattr(instrument_sync_jobs, "latest_sync_run", lambda db, broker: None)
    monkeypatch.setattr(instrument_sync_jobs, "reconcile_stale_sync_run", lambda *args, **kwargs: None)

    assert instrument_sync_jobs.schedule_instrument_sync_if_needed(
        db_session, _Account(), now=ist(2026, 11, 10, 9, 0)
    ) is False
    assert scheduled == []


def test_instrument_sync_runs_on_a_trading_day(monkeypatch, db_session):
    scheduled: list[str] = []
    monkeypatch.setattr(instrument_sync_jobs, "schedule_instrument_sync", lambda account_id: scheduled.append(account_id) or True)
    monkeypatch.setattr(instrument_sync_jobs, "instrument_cache_ready", lambda db, acc: False)
    monkeypatch.setattr(instrument_sync_jobs, "latest_sync_run", lambda db, broker: None)
    monkeypatch.setattr(instrument_sync_jobs, "reconcile_stale_sync_run", lambda *args, **kwargs: None)

    assert instrument_sync_jobs.schedule_instrument_sync_if_needed(
        db_session, _Account(), now=ist(2026, 11, 11, 9, 0)
    ) is True
    assert scheduled == ["acc-1"]


def test_explicit_operator_request_still_syncs_on_a_holiday(monkeypatch, db_session):
    """Verify from the UI must not be swallowed by the market gate."""
    scheduled: list[str] = []
    monkeypatch.setattr(instrument_sync_jobs, "schedule_instrument_sync", lambda account_id: scheduled.append(account_id) or True)
    monkeypatch.setattr(instrument_sync_jobs, "instrument_cache_ready", lambda db, acc: False)
    monkeypatch.setattr(instrument_sync_jobs, "latest_sync_run", lambda db, broker: None)
    monkeypatch.setattr(instrument_sync_jobs, "reconcile_stale_sync_run", lambda *args, **kwargs: None)

    assert instrument_sync_jobs.schedule_instrument_sync_if_needed(
        db_session, _Account(), now=ist(2026, 11, 10, 9, 0), market_gate=False
    ) is True


def test_daily_instrument_sync_marks_a_holiday_done(monkeypatch):
    from app.services import broker_sessions

    monkeypatch.setattr(broker_sessions, "_last_instrument_sync_date", None)
    synced: list[str] = []
    monkeypatch.setattr(
        broker_sessions, "_today_ist", lambda: date(2026, 11, 10), raising=False
    )
    monkeypatch.setattr(broker_sessions, "datetime", _FrozenDatetime(ist(2026, 11, 10, 9, 0)))
    monkeypatch.setattr(
        "app.services.broker_data.sync_instruments_to_csv",
        lambda db, acc: synced.append(acc.id),
        raising=False,
    )

    broker_sessions.run_daily_instrument_sync_once()
    assert synced == []
    assert broker_sessions._last_instrument_sync_date == date(2026, 11, 10)


class _FrozenDatetime(datetime):
    """A datetime whose ``now(tz)`` is pinned, so a once-per-day guard is testable."""

    _pinned: datetime

    def __new__(cls, pinned: datetime):  # noqa: D401 - subclass construction
        cls._pinned = pinned
        return super().__new__(cls, *pinned.timetuple()[:6], tzinfo=pinned.tzinfo)

    @classmethod
    def now(cls, tz=None):  # noqa: D102 - mirrors datetime.now
        return cls._pinned.astimezone(tz) if tz else cls._pinned.replace(tzinfo=None)
