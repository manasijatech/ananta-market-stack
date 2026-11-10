"""Refresh job, ORM store, API surface and maintenance wiring."""

from __future__ import annotations

import json
from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.services import market_calendar as mc
from app.services import system_maintenance
from db.models import MarketCalendarSnapshot
from db.session import Base

IST = ZoneInfo("Asia/Kolkata")


def ist(year: int, month: int, day: int, hour: int = 11, minute: int = 0) -> datetime:
    return datetime(year, month, day, hour, minute, tzinfo=IST)


@pytest.fixture()
def store(monkeypatch):
    """Point the calendar's store reads at an in-memory database."""
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    monkeypatch.setattr("db.session.SessionLocal", Session)
    mc.clear_calendar_cache()
    mc._store_rows.cache_clear()
    yield Session
    mc.clear_calendar_cache()
    engine.dispose()


@pytest.fixture(autouse=True)
def _no_override(monkeypatch):
    monkeypatch.delenv("ANANTA_MARKET_CALENDAR_FILE", raising=False)
    monkeypatch.setattr(system_maintenance, "_last_calendar_refresh_date", None)
    mc.clear_calendar_cache()
    yield
    mc.clear_calendar_cache()


class _FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self):
        return self._payload


class _FakeClient:
    def __init__(self, payloads, **_kwargs):
        self._payloads = payloads
        self.requests: list[str] = []

    def get(self, url):
        self.requests.append(url)
        if url not in self._payloads:
            raise RuntimeError("blocked")
        return _FakeResponse(self._payloads[url])

    def close(self):
        return None


def _nse_master(days: list[str]) -> dict:
    return {"CM": [{"tradingDate": day, "description": "Holiday"} for day in days]}


NSE_2027 = ["26-Jan-2027", "02-Mar-2027", "22-Mar-2027", "14-Apr-2027", "30-Apr-2027"]


def test_refresh_stores_an_accepted_list(store, monkeypatch):
    client = _FakeClient({
        f"{mc.NSE_HOLIDAY_MASTER_URL}?type=trading": _nse_master(NSE_2027),
        f"{mc.NSE_HOLIDAY_MASTER_URL}?type=clearing": _nse_master(NSE_2027),
    })
    result = mc.run_calendar_refresh(client=client, now=ist(2026, 11, 10))
    assert result["status"] == "completed"
    assert result["accepted"] >= 1
    assert result["rejected"] == 0

    db = store()
    try:
        rows = db.query(MarketCalendarSnapshot).filter_by(accepted=True).all()
    finally:
        db.close()
    assert rows
    assert all(row.list_kind in {"trading", "clearing"} for row in rows)

    # The accepted trading list becomes authoritative for the year.
    state = mc.market_session_state(now=ist(2027, 3, 2, 11, 0))
    assert state.phase == "holiday"
    assert state.calendar_coverage == "verified_refresh_2027"


def test_refresh_rejects_a_list_that_drops_a_seed_date(store):
    partial = _nse_master(["26-Jan-2026", "02-Mar-2026"])
    client = _FakeClient({
        f"{mc.NSE_HOLIDAY_MASTER_URL}?type=trading": partial,
        f"{mc.NSE_HOLIDAY_MASTER_URL}?type=clearing": partial,
    })
    result = mc.run_calendar_refresh(client=client, now=ist(2026, 11, 11))
    assert result["rejected"] >= 1
    assert any("missing_seed" in problem for problem in result["problems"])
    # The seed still serves, and 2026-11-10 stays a holiday.
    assert mc.is_trading_day(date(2026, 11, 10)) is False
    assert mc.market_session_state(now=ist(2026, 11, 10, 11, 0)).calendar_coverage == "verified_seed_2026"


def test_a_rejected_row_never_hides_an_accepted_one(store):
    db = store()
    try:
        db.add(MarketCalendarSnapshot(
            id="accepted-1", exchange="NSE", segment="cash", list_kind="trading", year=2027,
            holidays_json=json.dumps([{"date": day, "name": "Holiday"} for day in
                                      ["2027-01-26", "2027-03-02", "2027-03-22", "2027-04-14", "2027-04-30"]]),
            source_url="https://www.nseindia.com/x", fetched_at=datetime(2026, 11, 1),
            accepted=True, created_at=datetime(2026, 11, 1),
        ))
        db.add(MarketCalendarSnapshot(
            id="rejected-2", exchange="NSE", segment="cash", list_kind="trading", year=2027,
            holidays_json="[]", source_url="https://www.nseindia.com/y",
            fetched_at=datetime(2026, 11, 2), accepted=False, rejection_reason="date_insane",
            created_at=datetime(2026, 11, 2),
        ))
        db.commit()
    finally:
        db.close()
    mc.clear_calendar_cache()
    assert mc.is_trading_day(date(2027, 1, 26)) is False


def test_refresh_survives_a_blocked_upstream(store):
    client = _FakeClient({})
    result = mc.run_calendar_refresh(client=client, now=ist(2026, 11, 10))
    assert result["status"] in {"skipped", "rejected"}
    assert result["accepted"] == 0
    # The seeds still answer.
    assert mc.is_trading_day(date(2026, 11, 10)) is False


def test_refresh_keeps_nse_when_bse_is_blocked(store):
    client = _FakeClient({
        f"{mc.NSE_HOLIDAY_MASTER_URL}?type=trading": _nse_master(NSE_2027),
        f"{mc.NSE_HOLIDAY_MASTER_URL}?type=clearing": _nse_master(NSE_2027),
    })
    result = mc.run_calendar_refresh(client=client, now=ist(2026, 11, 10))
    assert result["status"] == "completed"
    assert any("BSE" in problem for problem in result["problems"])
    assert not mc._store_rows(mc._store_token()).get(("BSE", "cash", 2027))


def test_missing_store_table_falls_back_to_seeds(monkeypatch):
    """A fresh install before `alembic upgrade` must not break the calendar."""
    monkeypatch.setattr(
        "db.session.SessionLocal",
        lambda: (_ for _ in ()).throw(RuntimeError("no such table")),
    )
    mc.clear_calendar_cache()
    assert mc.market_session_state(now=ist(2026, 11, 10, 11, 0)).calendar_coverage == "verified_seed_2026"


def test_refresh_writes_only_the_configured_year(store):
    client = _FakeClient({
        f"{mc.NSE_HOLIDAY_MASTER_URL}?type=trading": _nse_master(NSE_2027),
        f"{mc.NSE_HOLIDAY_MASTER_URL}?type=clearing": _nse_master(NSE_2027),
    })
    mc.run_calendar_refresh(client=client, now=ist(2026, 11, 10))
    db = store()
    try:
        years = {row.year for row in db.query(MarketCalendarSnapshot).all()}
    finally:
        db.close()
    assert years == {2027}


# --- maintenance wiring -----------------------------------------------------


def test_daily_refresh_guard_runs_at_most_once_per_day(monkeypatch):
    calls: list[int] = []
    monkeypatch.setattr(
        system_maintenance, "run_calendar_refresh",
        lambda: calls.append(1) or {"status": "completed", "accepted": 2, "rejected": 0},
    )
    assert system_maintenance.refresh_holiday_calendar_once()["status"] == "completed"
    assert system_maintenance.refresh_holiday_calendar_once()["status"] == "cached"
    assert len(calls) == 1
    system_maintenance.refresh_holiday_calendar_once(force=True)
    assert len(calls) == 2


def test_daily_refresh_reports_a_failure_instead_of_raising(monkeypatch):
    def _boom():
        raise RuntimeError("upstream down")

    monkeypatch.setattr(system_maintenance, "run_calendar_refresh", _boom)
    result = system_maintenance.refresh_holiday_calendar_once()
    assert result["status"] == "failed"
    assert "upstream down" in result["error"]


def test_maintenance_cycle_records_the_calendar_result(monkeypatch):
    recorded: dict = {}
    monkeypatch.setattr(
        system_maintenance, "refresh_holiday_calendar_once",
        lambda: {"status": "completed", "accepted": 2},
    )
    monkeypatch.setattr(system_maintenance, "_finish_maintenance_log", lambda **kw: recorded.update(kw))
    monkeypatch.setattr(system_maintenance, "_create_maintenance_log", lambda **kw: "log-1")
    monkeypatch.setattr(system_maintenance, "_cleanup_sqlite_tables", lambda **kw: {"deleted_rows_total": 0})
    monkeypatch.setattr(system_maintenance, "_cleanup_audio_assets", lambda: {"deleted_rows": 0})
    monkeypatch.setattr(system_maintenance, "_cleanup_redis",
                        lambda **kw: {"deleted_keys_total": 0, "rebuilt_keys_total": 0})
    monkeypatch.setattr(system_maintenance, "_maybe_vacuum_sqlite", lambda **kw: {"performed": False})
    monkeypatch.setattr(system_maintenance, "_prune_old_maintenance_logs", lambda **kw: None)

    system_maintenance.run_system_maintenance(trigger="interval", full_redis_rebuild=False, force_vacuum=False)

    assert recorded["details"]["market_calendar"]["status"] == "completed"
    assert "market calendar refreshed" in recorded["summary"]


# --- HTTP surface -----------------------------------------------------------


def test_market_status_endpoint_matches_the_service():
    with TestClient(app) as client:
        response = client.get("/api/v1/market/status")
        assert response.status_code == 200
        body = response.json()
        expected = mc.market_status_now().as_dict()
        assert set(body) == set(expected)
        assert body["exchange"] == "NSE"
        assert body["segment"] == "cash"


def test_market_status_endpoint_accepts_an_exchange_and_scope():
    with TestClient(app) as client:
        response = client.get("/api/v1/market/status", params={"exchange": "NFO", "segment": "cash"})
        assert response.status_code == 200
        body = response.json()
        assert body["exchange"] == "NSE"
        assert body["segment"] == "equity_derivatives"


def test_market_status_endpoint_exposes_the_label_contract():
    with TestClient(app) as client:
        body = client.get("/api/v1/market/status").json()
        assert body["label"] in {"Open", "Pre-open"} or body["label"].startswith(("NSE closed", "Closed"))
