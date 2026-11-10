"""Focused tests for the market calendar helpers, phases and coverage."""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from app.services import market_calendar as mc

IST = ZoneInfo("Asia/Kolkata")


def ist(year: int, month: int, day: int, hour: int = 11, minute: int = 0) -> datetime:
    return datetime(year, month, day, hour, minute, tzinfo=IST)


@pytest.fixture(autouse=True)
def _isolated_calendar(monkeypatch, tmp_path):
    monkeypatch.delenv("ANANTA_MARKET_CALENDAR_FILE", raising=False)
    mc.clear_calendar_cache()
    yield
    mc.clear_calendar_cache()


# --- holiday and weekend detection -------------------------------------------


def test_verified_holiday_is_not_a_trading_day():
    assert mc.is_trading_day(date(2026, 11, 10)) is False
    assert mc.is_trading_day(date(2026, 1, 26)) is False
    assert mc.is_trading_day(date(2025, 10, 2)) is False


def test_regular_weekday_is_a_trading_day():
    assert mc.is_trading_day(date(2026, 11, 11)) is True
    assert mc.is_trading_day(date(2026, 11, 9)) is True


def test_weekend_is_never_a_trading_day():
    assert mc.is_trading_day(date(2026, 11, 14)) is False  # Saturday
    assert mc.is_trading_day(date(2026, 11, 15)) is False  # Sunday
    state = mc.market_session_state(now=ist(2026, 11, 14))
    assert state.phase == "weekend"
    assert state.continuous_trading is False
    assert mc.market_status_now(now=ist(2026, 11, 14)).status == "weekend"


def test_holiday_phase_reports_the_name_and_no_live_quotes():
    state = mc.market_session_state(now=ist(2026, 11, 10))
    assert state.phase == "holiday"
    assert state.holiday_name == "Diwali-Balipratipada"
    assert state.calendar_coverage == "verified_seed_2026"
    assert mc.market_status_now(now=ist(2026, 11, 10)).live_quotes_expected is False


# --- special sessions --------------------------------------------------------


def test_special_session_trades_on_a_weekend():
    """The 2026-02-01 Budget session trades on a Sunday."""
    state = mc.market_session_state(now=ist(2026, 2, 1, 10, 0))
    assert state.phase == "continuous"
    assert state.continuous_trading is True
    assert mc.is_trading_day(date(2026, 2, 1)) is True
    assert mc.session_windows(date(2026, 2, 1))[0]["start"] == "09:00"


def test_special_session_closed_outside_its_windows():
    state = mc.market_session_state(now=ist(2026, 2, 1, 16, 30))
    assert state.phase == "special_session_closed"
    assert state.continuous_trading is False
    # A special session that already ran is the last completed session.
    assert mc.last_completed_session(now=ist(2026, 2, 1, 16, 30)) == date(2026, 2, 1)


def test_muhurat_session_uses_its_evening_window():
    assert mc.is_trading_day(date(2025, 10, 21)) is True
    assert mc.session_windows(date(2025, 10, 21))[0]["start"] == "13:30"
    assert mc.market_session_state(now=ist(2025, 10, 21, 14, 0)).phase == "continuous"
    assert mc.market_session_state(now=ist(2025, 10, 21, 20, 0)).phase == "special_session_closed"


def test_unverified_special_session_times_are_flagged():
    assert mc.market_session_state(now=ist(2026, 11, 8, 10, 0)).phase == "special_session_times_unverified"


def test_a_regular_holiday_has_no_session_windows():
    assert mc.session_windows(date(2026, 11, 10)) == []
    assert mc.session_windows(date(2026, 11, 14)) == []


# --- phase clock -------------------------------------------------------------


def test_preopen_phases_are_effective_dated():
    """Pre-open phases changed on 2026-09-07; both sides of the boundary are tested."""
    # Before the change, 09:06 is still the entry window.
    assert mc.market_session_state(now=ist(2026, 8, 11, 9, 6)).phase == "preopen_entry"
    # After the change the same minute is a limit-entry random-close window.
    assert mc.market_session_state(now=ist(2026, 9, 11, 9, 6)).phase == "preopen_limit_entry_random_close"
    # 09:11 is matching on both sides of the boundary.
    assert mc.market_session_state(now=ist(2026, 8, 11, 9, 11)).phase == "preopen_matching"
    assert mc.market_session_state(now=ist(2026, 9, 11, 9, 11)).phase == "preopen_matching"


def test_continuous_session_and_closing_auction():
    assert mc.market_session_state(now=ist(2026, 11, 11, 11, 0)).continuous_trading is True
    closing = mc.market_session_state(now=ist(2026, 11, 11, 15, 20))
    assert closing.phase == "closing_eligibility_unverified"
    assert closing.continuous_trading is False
    assert mc.market_session_state(now=ist(2026, 11, 11, 15, 55)).phase == "post_close"
    assert mc.market_session_state(now=ist(2026, 11, 11, 17, 0)).phase == "closed"


def test_derivatives_session_runs_to_1540_after_cas():
    state = mc.market_session_state(exchange="NFO", segment="cash", now=ist(2026, 11, 11, 15, 35))
    assert state.segment == "equity_derivatives"
    assert state.phase == "continuous"


def test_pre_market_is_not_a_continuous_session():
    state = mc.market_session_state(now=ist(2026, 11, 11, 8, 0))
    assert state.phase == "pre_market"
    assert state.continuous_trading is False


def test_live_quotes_are_not_expected_after_the_close():
    assert mc.live_quotes_expected(now=ist(2026, 11, 11, 11, 0)) is True
    assert mc.live_quotes_expected(now=ist(2026, 11, 11, 17, 0)) is False
    assert mc.live_quotes_expected(now=ist(2026, 11, 10, 11, 0)) is False


# --- poll backoff ------------------------------------------------------------


def test_poll_backoff_is_zero_only_while_trading():
    assert mc.poll_backoff_seconds(ist(2026, 11, 11, 11, 0)) == 0.0
    assert mc.poll_backoff_seconds(ist(2026, 11, 11, 15, 35)) == 0.0  # derivatives still open


def test_poll_backoff_waits_until_the_next_open_when_closed():
    backoff = mc.poll_backoff_seconds(ist(2026, 11, 11, 15, 45))
    assert 5 <= backoff <= 300
    # A holiday at 11:00 is far from the next open, so the cap applies.
    assert mc.poll_backoff_seconds(ist(2026, 11, 10, 11, 0)) == 300.0


# --- previous / next / last completed ---------------------------------------


def test_previous_and_next_trading_day_skip_the_holiday():
    assert mc.previous_trading_day(date(2026, 11, 11)) == date(2026, 11, 9)
    assert mc.next_trading_day(date(2026, 11, 9)) == date(2026, 11, 11)
    # 2026-11-08 is a Sunday and also the Muhurat day, so the next session is the 9th.
    assert mc.next_trading_day(date(2026, 11, 8)) == date(2026, 11, 9)


def test_previous_and_next_never_include_the_day_itself():
    assert mc.previous_trading_day(date(2026, 11, 11)) != date(2026, 11, 11)
    assert mc.next_trading_day(date(2026, 11, 11)) != date(2026, 11, 11)


def test_last_completed_session_during_and_after_the_session():
    assert mc.last_completed_session(now=ist(2026, 11, 11, 11, 0)) == date(2026, 11, 9)
    assert mc.last_completed_session(now=ist(2026, 11, 11, 18, 0)) == date(2026, 11, 11)


def test_last_completed_session_on_a_holiday_is_the_previous_session():
    assert mc.last_completed_session(now=ist(2026, 11, 10, 11, 0)) == date(2026, 11, 9)
    assert mc.last_completed_session(now=ist(2026, 11, 15, 11, 0)) == date(2026, 11, 13)


# --- expiry shifting ---------------------------------------------------------


def test_expiry_shifts_back_to_the_previous_session():
    # 2026-11-10 is a holiday, so a contract listed for that expiry settles on the 9th.
    assert mc.shift_expiry_to_trading_day(date(2026, 11, 10)) == date(2026, 11, 9)
    assert mc.shift_expiry_to_trading_day(date(2026, 11, 14)) == date(2026, 11, 13)
    # A normal session day is its own expiry.
    assert mc.shift_expiry_to_trading_day(date(2026, 11, 11)) == date(2026, 11, 11)


# --- year boundary and honest coverage --------------------------------------


def test_year_boundary_uses_each_years_own_verified_list():
    assert mc.is_trading_day(date(2025, 12, 31)) is True
    assert mc.is_trading_day(date(2026, 1, 1)) is True
    assert mc.is_trading_day(date(2026, 1, 15)) is False
    assert mc.market_session_state(now=ist(2025, 12, 31, 11, 0)).calendar_coverage == "verified_seed_2025"
    assert mc.market_session_state(now=ist(2026, 1, 2, 11, 0)).calendar_coverage == "verified_seed_2026"


def test_unverified_year_is_weekday_only_and_says_so():
    state = mc.market_session_state(now=ist(2027, 1, 26, 11, 0))
    assert state.calendar_coverage == "weekday_only_unverified_holidays"
    # A weekday in an unverified year is assumed open; the coverage string is the caveat.
    assert mc.is_trading_day(date(2027, 1, 26)) is True
    assert mc.is_trading_day(date(2027, 1, 23)) is False  # Saturday still excluded
    status = mc.market_status_now(now=ist(2027, 1, 26, 11, 0))
    assert status.calendar_coverage == "weekday_only_unverified_holidays"
    assert status.is_trading_day is True


def test_bse_has_no_verified_seed_and_reports_honest_coverage():
    state = mc.market_session_state(exchange="BSE", now=ist(2026, 11, 10, 11, 0))
    assert state.calendar_coverage == "weekday_only_unverified_holidays"
    assert state.phase == "continuous"


def test_unsupported_segment_reports_unsupported_calendar():
    state = mc.market_session_state(exchange="NSE", segment="bonds", now=ist(2026, 11, 11, 11, 0))
    assert state.phase == "unsupported_calendar"


# --- operator override and provenance ---------------------------------------


def _override_payload(**overrides):
    payload = {
        "NSE:cash": {
            "holidays": ["2026-11-11"],
            "provenance": {
                "source_url": "https://www.nseindia.com/static/products-services/holidays",
                "exchange": "NSE",
                "segment": "cash",
                "complete_holiday_list": True,
                "valid_from": "2026-01-01",
                "valid_until": "2026-12-31",
                "reviewed_at": "2026-01-05T10:00:00+05:30",
            },
        }
    }
    payload["NSE:cash"].update(overrides)
    return payload


def _write_override(tmp_path, monkeypatch, payload):
    path = tmp_path / "calendar.json"
    path.write_text(json.dumps(payload))
    monkeypatch.setenv("ANANTA_MARKET_CALENDAR_FILE", str(path))
    mc.clear_calendar_cache()


def test_verified_operator_override_wins(tmp_path, monkeypatch):
    _write_override(tmp_path, monkeypatch, _override_payload())
    assert mc.is_trading_day(date(2026, 11, 11)) is False
    state = mc.market_session_state(now=ist(2026, 11, 11, 11, 0))
    assert state.phase == "holiday"
    assert state.calendar_coverage == "operator_verified_override"


def test_override_from_a_non_official_host_is_not_trusted(tmp_path, monkeypatch):
    payload = _override_payload()
    payload["NSE:cash"]["provenance"]["source_url"] = "https://example.com/nse-holidays.pdf"
    _write_override(tmp_path, monkeypatch, payload)
    state = mc.market_session_state(now=ist(2026, 11, 11, 11, 0))
    assert state.calendar_coverage == "operator_override_unverified"
    assert state.calendar_sources == ()
    assert state.source == mc.SEBI_SOURCE


def test_override_missing_complete_list_flag_is_not_trusted(tmp_path, monkeypatch):
    payload = _override_payload()
    payload["NSE:cash"]["provenance"]["complete_holiday_list"] = False
    _write_override(tmp_path, monkeypatch, payload)
    assert mc.market_session_state(now=ist(2026, 11, 11, 11, 0)).calendar_coverage == "operator_override_unverified"


def test_override_outside_its_valid_window_is_not_trusted(tmp_path, monkeypatch):
    payload = _override_payload()
    payload["NSE:cash"]["provenance"]["valid_until"] = "2026-06-30"
    _write_override(tmp_path, monkeypatch, payload)
    assert mc.market_session_state(now=ist(2026, 11, 11, 11, 0)).calendar_coverage == "operator_override_unverified"


def test_override_with_future_review_time_is_not_trusted(tmp_path, monkeypatch):
    payload = _override_payload()
    payload["NSE:cash"]["provenance"]["reviewed_at"] = "2027-01-05T10:00:00+05:30"
    _write_override(tmp_path, monkeypatch, payload)
    assert mc.market_session_state(now=ist(2026, 11, 11, 11, 0)).calendar_coverage == "operator_override_unverified"


def test_unreadable_override_file_falls_back_to_seeds(tmp_path, monkeypatch):
    path = tmp_path / "broken.json"
    path.write_text("{not json")
    monkeypatch.setenv("ANANTA_MARKET_CALENDAR_FILE", str(path))
    mc.clear_calendar_cache()
    assert mc.market_session_state(now=ist(2026, 11, 10, 11, 0)).calendar_coverage == "verified_seed_2026"


def test_an_empty_override_list_falls_back_to_the_seeds(tmp_path, monkeypatch):
    """A truncated override file must not erase every holiday."""
    payload = {"NSE:cash": {"holidays": [], "provenance": _override_payload()["NSE:cash"]["provenance"]}}
    _write_override(tmp_path, monkeypatch, payload)
    assert mc.is_trading_day(date(2026, 11, 10)) is False
    assert mc.market_session_state(now=ist(2026, 11, 10, 11, 0)).calendar_coverage == "verified_seed_2026"


def test_holiday_name_override_is_reported(tmp_path, monkeypatch):
    payload = _override_payload(holiday_names={"2026-11-11": "Festival closure"})
    _write_override(tmp_path, monkeypatch, payload)
    assert mc.market_status_now(now=ist(2026, 11, 11, 11, 0)).holiday_name == "Festival closure"


# --- batch validation --------------------------------------------------------


def _days(start: date, count: int) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    cursor = start
    while len(out) < count:
        if cursor.weekday() < 5 and cursor not in mc.NSE_2026_HOLIDAYS:
            out.append({"date": cursor.isoformat(), "name": "Holiday"})
        cursor += timedelta(days=1)
    return out


def test_validate_accepts_a_list_that_keeps_the_seed_dates():
    rows = [{"date": day.isoformat(), "name": "Holiday"} for day in sorted(mc.NSE_2026_HOLIDAYS)]
    ok, reason = mc.validate_holiday_batch(
        exchange="NSE", segment="cash", list_kind="trading", year=2026, holidays=rows,
    )
    assert ok is True
    assert reason == "accepted"


def test_validate_rejects_a_seeded_year_that_drops_a_seed_date():
    rows = [{"date": day.isoformat()} for day in sorted(mc.NSE_2026_HOLIDAYS)[:5]]
    ok, reason = mc.validate_holiday_batch(
        exchange="NSE", segment="cash", list_kind="trading", year=2026, holidays=rows,
    )
    assert ok is False
    assert reason.startswith("missing_seed:")


def test_validate_rejects_an_unseeded_year_with_too_few_dates():
    rows = _days(date(2027, 1, 4), 3)
    ok, reason = mc.validate_holiday_batch(
        exchange="NSE", segment="cash", list_kind="trading", year=2027, holidays=rows,
    )
    assert ok is False
    assert reason == "date_insane"


def test_validate_rejects_an_unknown_exchange_or_segment():
    rows = _days(date(2027, 1, 4), 6)
    assert mc.validate_holiday_batch(
        exchange="NYSE", segment="cash", list_kind="trading", year=2027, holidays=rows,
    ) == (False, "wrong_exchange")
    assert mc.validate_holiday_batch(
        exchange="NSE", segment="bonds", list_kind="trading", year=2027, holidays=rows,
    ) == (False, "wrong_segment")
    assert mc.validate_holiday_batch(
        exchange="NSE", segment="cash", list_kind="settlement", year=2027, holidays=rows,
    ) == (False, "wrong_list_kind")


def test_validate_rejects_a_date_outside_the_year_and_duplicates():
    rows = [{"date": "2027-01-04"}, {"date": "2027-01-04"}, {"date": "2027-01-05"},
            {"date": "2027-01-06"}, {"date": "2027-01-07"}, {"date": "2028-01-10"}]
    assert mc.validate_holiday_batch(
        exchange="NSE", segment="cash", list_kind="trading", year=2027, holidays=rows,
    ) == (False, "date_insane")


def test_validate_rejects_an_empty_or_oversized_list():
    assert mc.validate_holiday_batch(
        exchange="NSE", segment="cash", list_kind="trading", year=2027, holidays=[],
    ) == (False, "date_insane")
    rows = _days(date(2027, 1, 4), mc.MAX_HOLIDAYS_PER_YEAR + 1)
    assert mc.validate_holiday_batch(
        exchange="NSE", segment="cash", list_kind="trading", year=2027, holidays=rows,
    ) == (False, "date_insane")


def test_validate_accepts_a_clearing_list_for_an_unseeded_year():
    """Clearing lists close settlement, not sessions, so the count rule does not apply."""
    ok, _reason = mc.validate_holiday_batch(
        exchange="NSE", segment="cash", list_kind="clearing", year=2027,
        holidays=[{"date": "2027-01-04"}],
    )
    assert ok is True


def test_parse_nse_holiday_master_reads_the_master_keys():
    payload = {"CM": [{"tradingDate": "26-Jan-2026", "description": "Republic Day"}],
               "FO": [{"tradingDate": "26-Jan-2026", "description": "Republic Day"}]}
    rows = mc.parse_nse_holiday_master(payload, list_kind="trading")
    assert rows == [{"date": "2026-01-26", "name": "Republic Day"}]


def test_parse_nse_holiday_master_drops_weekends_and_junk():
    payload = {"CM": [{"tradingDate": "14-Nov-2026"}, {"tradingDate": "not-a-date"},
                      {"tradingDate": "26-Jan-2026", "description": "Republic Day"}]}
    assert mc.parse_nse_holiday_master(payload, list_kind="trading") == [
        {"date": "2026-01-26", "name": "Republic Day"}
    ]


def test_parse_bse_holidays_returns_none_for_an_unknown_shape():
    assert mc.parse_bse_holidays({"unexpected": "html"}) is None
    assert mc.parse_bse_holidays({"data": [{"dtDate": "2026-01-26"}]}) == [
        {"date": "2026-01-26", "name": "Holiday"}
    ]


# --- context string ---------------------------------------------------------


def test_context_names_the_holiday_and_the_last_completed_session():
    text = mc.market_session_context(now=ist(2026, 11, 10, 11, 0))
    assert "IST now 2026-11-10T11:00:00+05:30" in text
    assert "holiday: Diwali-Balipratipada" in text
    assert "Last completed cash session 2026-11-09" in text
    assert "Next cash open 2026-11-11T09:15:00+05:30" in text
    assert "Live quotes not expected" in text
    assert "verified_seed_2026" in text
    assert "do not refuse" in text.lower()


def test_context_after_hours_points_at_todays_close():
    text = mc.market_session_context(now=ist(2026, 11, 11, 18, 0))
    assert "Last completed cash session 2026-11-11" in text


def test_context_includes_the_derivatives_line():
    """Cash closes at 15:30 but derivatives keep trading to 15:40."""
    text = mc.market_session_context(now=ist(2026, 11, 11, 15, 35))
    assert "NSE cash 2026-11-11: Closed" in text
    assert "NSE equity derivatives: Open" in text


def test_status_shape_and_label_contract():
    status = mc.market_status_now(now=ist(2026, 11, 10, 11, 0))
    assert status.label.startswith("NSE closed · holiday: Diwali-Balipratipada · opens 11 Nov 09:15 IST")
    assert status.status == "holiday"
    assert status.next_open and status.next_open.startswith("2026-11-11T09:15")
    assert mc.market_status_now(now=ist(2026, 11, 11, 11, 0)).label == "Open"
    assert mc.market_status_now(now=ist(2026, 11, 11, 9, 5)).label == "Pre-open"
    after_close = mc.market_status_now(now=ist(2026, 11, 11, 18, 0))
    assert after_close.label == "Closed · last session 11 Nov 2026"
    assert after_close.next_open and after_close.next_open.startswith("2026-11-12T09:15")


def test_next_open_honours_a_special_session_time():
    assert mc.market_status_now(now=ist(2025, 10, 21, 9, 0)).next_open.startswith("2025-10-21T13:45")
    assert mc.market_status_now(now=ist(2026, 2, 1, 8, 0)).next_open.startswith("2026-02-01T09:15")
