"""NSE/BSE trading calendar: session phases, holidays, coverage, refresh.

Reference data, not market data: holiday and special-session lists may be stored
and refreshed. Hot paths never touch the network.

Resolution order for a (exchange, segment, year) holiday list:

1. ``ANANTA_MARKET_CALENDAR_FILE`` operator override, when its provenance block
   passes the official-circular check. Always wins.
2. The latest accepted ``market_calendar_snapshots`` row for the scope. A newer
   rejected row never hides an older accepted one.
3. Verified in-tree seeds: NSE cash and NSE F&O, 2025 and 2026.

Anything else reports ``weekday_only_unverified_holidays``: weekdays are
sessions, weekends are not, and no holiday is invented.
"""
from __future__ import annotations

import json
import logging
import os
from dataclasses import asdict, dataclass
from datetime import date, datetime, time, timedelta
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import select

from common.datetime_compat import UTC

logger = logging.getLogger(__name__)

IST = ZoneInfo("Asia/Kolkata")

CAS_EFFECTIVE = date(2026, 8, 3)
PREOPEN_EFFECTIVE = date(2026, 9, 7)
RULES_VERSION = "sebi-cas-20260803-preopen-20260907"

SEBI_SOURCE = "https://www.sebi.gov.in/sebi_data/attachdocs/jan-2026/1768576287344.pdf"
NSE_CAS_SOURCE = "https://www.nseindia.com/static/products-services/closing-auction-session"
NSE_HOLIDAY_MASTER_URL = "https://www.nseindia.com/api/holiday-master"
BSE_HOLIDAY_URL = "https://api.bseindia.com/BseIndiaAPI/api/HolidayList/w"
NSE_HOME_URL = "https://www.nseindia.com/"
NSE_ARCHIVE_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
)
REFRESH_MAX_BYTES = 2 * 1024 * 1024

# Verified NSE cash-trading holidays. Both years are complete exchange lists,
# including the 2025-01-15 amendment.
NSE_2025_HOLIDAYS = frozenset(date.fromisoformat(s) for s in (
    "2025-02-26", "2025-03-14", "2025-03-31", "2025-04-10", "2025-04-14", "2025-04-18",
    "2025-05-01", "2025-08-15", "2025-08-27", "2025-10-02", "2025-10-21", "2025-10-22",
    "2025-11-05", "2025-12-25",
))
NSE_2026_HOLIDAYS = frozenset(date.fromisoformat(s) for s in (
    "2026-01-15", "2026-01-26", "2026-03-03", "2026-03-26", "2026-03-31",
    "2026-04-03", "2026-04-14", "2026-05-01", "2026-05-28", "2026-06-26",
    "2026-09-14", "2026-10-02", "2026-10-20", "2026-11-08", "2026-11-10",
    "2026-11-24", "2026-12-25",
))

# F&O has its own circulars. The verified dates currently match cash; a refresh
# may diverge them, which is why they are separate sets.
NSE_FO_2025_HOLIDAYS = NSE_2025_HOLIDAYS
NSE_FO_2026_HOLIDAYS = NSE_2026_HOLIDAYS

SEED_HOLIDAYS: dict[tuple[str, str, int], frozenset[date]] = {
    ("NSE", "cash", 2025): NSE_2025_HOLIDAYS,
    ("NSE", "cash", 2026): NSE_2026_HOLIDAYS,
    ("NSE", "equity_derivatives", 2025): NSE_FO_2025_HOLIDAYS,
    ("NSE", "equity_derivatives", 2026): NSE_FO_2026_HOLIDAYS,
}

_CIRCULAR_SOURCES: dict[tuple[str, str, int], tuple[str, ...]] = {
    ("NSE", "cash", 2025): ("CMTR65587", "CMTR65729", "CMTR70319"),
    ("NSE", "cash", 2026): ("CMTR71775", "CMTR72260", "CMTR72349"),
    ("NSE", "equity_derivatives", 2025): ("FAOP65588", "FAOP65730", "FAOP70320"),
    ("NSE", "equity_derivatives", 2026): ("FAOP71777", "FAOP72262", "FAOP72352"),
}
CALENDAR_SOURCES: dict[tuple[str, str, int], tuple[str, ...]] = {
    scope: tuple("https://nsearchives.nseindia.com/content/circulars/" + name + ".pdf" for name in names)
    for scope, names in _CIRCULAR_SOURCES.items()
}

# Seed names used when an operator has not declared a label of their own.
SEED_HOLIDAY_NAMES: dict[date, str] = {
    date(2026, 11, 8): "Diwali-Laxmi Puja",
    date(2026, 11, 10): "Diwali-Balipratipada",
}

SEGMENTS = ("cash", "equity_derivatives", "currency", "commodity")
SUPPORTED_EXCHANGES = ("NSE", "BSE")
LIST_KINDS = ("trading", "clearing")
# NSE holiday-master keys per segment.
MASTER_KEYS = {"cash": "CM", "equity_derivatives": "FO", "currency": "CD", "commodity": "COM"}
MAX_HOLIDAYS_PER_YEAR = 40
MIN_UNSEEDED_HOLIDAYS_PER_YEAR = 5
STORE_CACHE_SECONDS = 60

_SEGMENT_ALIASES = {
    "d": "equity_derivatives",
    "fo": "equity_derivatives",
    "fno": "equity_derivatives",
    "nfo": "equity_derivatives",
    "derivatives": "equity_derivatives",
    "e": "cash",
    "eq": "cash",
    "cm": "cash",
    "equity": "cash",
    "nse": "cash",
    "bse": "cash",
    "cq": "currency",
    "cd": "currency",
    "co": "commodity",
    "com": "commodity",
}

_OPEN_PHASES = {
    "continuous",
    "cas_reference_transition",
    "cas_limit_and_market_entry",
    "cas_limit_entry_random_close",
    "cas_matching",
}
_PREOPEN_PHASES = {
    "preopen_entry",
    "preopen_matching",
    "preopen_transition",
    "preopen_limit_and_market_entry",
    "preopen_limit_entry_random_close",
}
_CLOSED_PHASES = {
    "closed",
    "post_close",
    "pre_market",
    "holiday",
    "weekend",
    "special_session_closed",
    "special_session_times_unverified",
    "unsupported_calendar",
    "closing_eligibility_unverified",
}


@dataclass(frozen=True)
class MarketSessionState:
    exchange: str
    segment: str
    local_time: str
    trading_date: str
    phase: str
    continuous_trading: bool
    cas_eligible: bool | None
    calendar_coverage: str
    rules_version: str
    source: str
    calendar_sources: tuple[str, ...] = ()
    holiday_name: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class MarketStatus:
    exchange: str
    segment: str
    status: str
    phase: str
    holiday_name: str | None
    ist_now: str
    trading_date: str
    is_trading_day: bool
    last_completed_session: str
    next_open: str | None
    live_quotes_expected: bool
    calendar_coverage: str
    label: str

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


# --- scope normalisation ----------------------------------------------------


def normalize_scope(exchange: str = "NSE", segment: str = "cash") -> tuple[str, str]:
    """Map broker-style exchange/segment synonyms onto ``(NSE|BSE, segment)``."""
    normalized_exchange = str(exchange or "NSE").strip().upper()
    normalized_segment = str(segment or "cash").strip().lower()
    if normalized_exchange in {"NFO", "BFO"}:
        normalized_exchange = "NSE" if normalized_exchange == "NFO" else "BSE"
        normalized_segment = "equity_derivatives"
    return normalized_exchange, _SEGMENT_ALIASES.get(normalized_segment, normalized_segment)


def _local(now: datetime | None) -> datetime:
    current = now or datetime.now(tz=UTC)
    if current.tzinfo is None:
        current = current.replace(tzinfo=UTC)
    return current.astimezone(IST)


# --- operator override ------------------------------------------------------


@lru_cache(maxsize=4)
def _load_overrides_file(path: str, mtime_ns: int) -> dict[str, Any]:
    del mtime_ns
    data = json.loads(Path(path).read_text())
    if not isinstance(data, dict):
        raise ValueError("market calendar must be an object")
    return data


def calendar_overrides() -> dict[str, Any]:
    """Operator overrides, or ``{}`` when no override file is configured."""
    path = os.environ.get("ANANTA_MARKET_CALENDAR_FILE", "")
    if not path:
        return {}
    try:
        return _load_overrides_file(path, Path(path).stat().st_mtime_ns)
    except (OSError, ValueError, json.JSONDecodeError):
        logger.warning("market calendar override file %s could not be read", path, exc_info=True)
        return {}


def _official_host(host: str, exchange: str) -> bool:
    domain = {"NSE": "nseindia.com", "BSE": "bseindia.com"}.get(exchange)
    return bool(domain) and (host == domain or host.endswith("." + domain))


def _override_provenance(overrides: dict[str, Any], exchange: str, segment: str,
                         current: datetime) -> tuple[bool, str]:
    """Validate operator-declared review scope, dates and official provenance.

    A holiday list alone does not prove that it is complete or current. This is
    not a network verification: operators remain responsible for source review.
    """
    proof = overrides.get("provenance")
    if not isinstance(proof, dict):
        return False, ""
    source = str(proof.get("source_url") or "")
    try:
        parsed = urlparse(source)
        host = (parsed.hostname or "").lower()
        port = parsed.port
    except ValueError:
        return False, ""
    if (parsed.scheme != "https" or parsed.username or parsed.password
            or port not in {None, 443} or parsed.path in {"", "/"}
            or not _official_host(host, exchange)
            or proof.get("exchange") != exchange or proof.get("segment") != segment
            or proof.get("complete_holiday_list") is not True):
        return False, ""
    try:
        start = date.fromisoformat(proof["valid_from"])
        end = date.fromisoformat(proof["valid_until"])
        reviewed = datetime.fromisoformat(str(proof["reviewed_at"]).replace("Z", "+00:00"))
        if reviewed.tzinfo is None or reviewed > current:
            return False, ""
    except (KeyError, TypeError, ValueError, AttributeError):
        return False, ""
    return start <= current.date() <= end, source


# --- accepted refresh store -------------------------------------------------


@lru_cache(maxsize=64)
def _store_rows(cache_token: int) -> dict[tuple[str, str, int], tuple[frozenset[date], str, tuple[str, ...]]]:
    """Latest accepted trading list per scope, read once per cache window."""
    del cache_token
    out: dict[tuple[str, str, int], tuple[frozenset[date], str, tuple[str, ...]]] = {}
    try:
        from db.session import SessionLocal
        from db.models import MarketCalendarSnapshot

        db = SessionLocal()
        try:
            rows = db.scalars(
                select(MarketCalendarSnapshot)
                .where(MarketCalendarSnapshot.accepted.is_(True))
                .where(MarketCalendarSnapshot.list_kind == "trading")
                .order_by(
                    MarketCalendarSnapshot.exchange,
                    MarketCalendarSnapshot.segment,
                    MarketCalendarSnapshot.year,
                    MarketCalendarSnapshot.fetched_at.asc(),
                    MarketCalendarSnapshot.created_at.asc(),
                )
            ).all()
        finally:
            db.close()
    except Exception:
        # A missing table (fresh install before migrate) or a failed read falls
        # back to the seeds; the calendar must never break a request path.
        logger.debug("market calendar snapshot store unavailable; using seeds", exc_info=True)
        return out
    for row in rows:
        days: set[date] = set()
        try:
            parsed = json.loads(row.holidays_json or "[]")
        except json.JSONDecodeError:
            parsed = []
        if isinstance(parsed, list):
            for item in parsed:
                raw = item.get("date") if isinstance(item, dict) else item
                try:
                    days.add(date.fromisoformat(str(raw)))
                except (TypeError, ValueError):
                    continue
        if not days:
            continue
        sources = tuple(sorted({
            str(item.get("source_url"))
            for item in (parsed if isinstance(parsed, list) else [])
            if isinstance(item, dict) and str(item.get("source_url") or "").startswith("https://")
        })) or ((row.source_url,) if row.source_url else ())
        # Ordered ascending, so the last accepted row wins.
        out[(str(row.exchange).upper(), str(row.segment).lower(), int(row.year))] = (
            frozenset(days), str(row.source_url or ""), sources,
        )
    return out


def _store_token() -> int:
    """Coarse 60-second cache bucket, so a written row is visible promptly."""
    return int(datetime.now(tz=UTC).timestamp()) // STORE_CACHE_SECONDS


def clear_calendar_cache() -> None:
    """Drop memoised store/override reads after a write or a test override."""
    _store_rows.cache_clear()
    _load_overrides_file.cache_clear()


def _refreshed_holidays(exchange: str, segment: str, year: int) -> tuple[frozenset[date], tuple[str, ...]]:
    entry = _store_rows(_store_token()).get((exchange, segment, year))
    if not entry:
        return frozenset(), ()
    return entry[0], entry[2]


# --- holiday resolution -----------------------------------------------------


def _override_holidays(exchange: str, segment: str, current: datetime) -> tuple[frozenset[date], str, tuple[str, ...], str] | None:
    overrides = calendar_overrides().get(f"{exchange}:{segment}")
    if not isinstance(overrides, dict) or not isinstance(overrides.get("holidays"), list):
        return None
    parsed: set[date] = set()
    for raw in overrides["holidays"]:
        try:
            parsed.add(date.fromisoformat(str(raw)))
        except ValueError:
            continue
    if not parsed:
        # A truncated override file must not declare that the exchange never closes.
        return None
    verified, override_source = _override_provenance(overrides, exchange, segment, current)
    coverage = "operator_verified_override" if verified else "operator_override_unverified"
    return (frozenset(parsed), coverage, (override_source,) if verified else (),
            override_source if verified else SEBI_SOURCE)


def _calendar_for(exchange: str, segment: str, year: int,
                  holidays: set[date] | None, now: datetime | None = None) -> tuple[frozenset[date], str, tuple[str, ...], str]:
    """Resolve ``(holidays, coverage, sources, source)`` for one scope/year."""
    if holidays is not None:
        return frozenset(holidays), "caller_supplied", (), SEBI_SOURCE

    override = _override_holidays(exchange, segment, _local(now))
    if override is not None:
        return override

    refreshed_days, refreshed_sources = _refreshed_holidays(exchange, segment, year)
    if refreshed_days:
        return refreshed_days, f"verified_refresh_{year}", refreshed_sources, (
            refreshed_sources[0] if refreshed_sources else SEBI_SOURCE
        )

    seeded = SEED_HOLIDAYS.get((exchange, segment, year))
    if seeded:
        return (seeded, f"verified_seed_{year}", CALENDAR_SOURCES.get((exchange, segment, year), ()),
                SEBI_SOURCE)
    return frozenset(), "weekday_only_unverified_holidays", (), SEBI_SOURCE


def _seed_covered(exchange: str, segment: str, year: int) -> bool:
    return (exchange, segment, year) in SEED_HOLIDAYS or bool(_refreshed_holidays(exchange, segment, year)[0])


def _special_sessions(overrides: dict[str, Any], exchange: str, segment: str,
                      year: int, covered: bool) -> dict[str, list[dict[str, str]]]:
    sessions: dict[str, list[dict[str, str]]] = {}
    raw = overrides.get("special_sessions")
    if isinstance(raw, dict):
        sessions.update({str(key): value for key, value in raw.items() if isinstance(value, list)})
    if not covered or exchange != "NSE":
        return sessions
    # Explicit operator date windows take precedence over these sources.
    sessions.setdefault(f"{year}-02-01", [
        {"phase": "preopen_entry", "start": "09:00", "end": "09:08"},
        {"phase": "preopen_transition", "start": "09:08", "end": "09:15"},
        {"phase": "continuous", "start": "09:15", "end": "15:30"},
    ] if year == 2026 or segment == "cash" else [
        {"phase": "continuous", "start": "09:15", "end": "15:30"},
    ])
    if year == 2025:
        sessions.setdefault("2025-10-21", [
            *([
                {"phase": "preopen_entry", "start": "13:30", "end": "13:38"},
                {"phase": "preopen_transition", "start": "13:38", "end": "13:45"},
            ] if segment == "cash" else []),
            {"phase": "continuous", "start": "13:45", "end": "14:45"},
        ])
    return sessions


def _special_session_windows(exchange: str, segment: str, day: date) -> list[dict[str, str]]:
    overrides = calendar_overrides().get(f"{exchange}:{segment}")
    if not isinstance(overrides, dict):
        overrides = {}
    covered = _seed_covered(exchange, segment, day.year) or isinstance(overrides.get("special_sessions"), dict)
    sessions = _special_sessions(overrides, exchange, segment, day.year, covered)
    windows = sessions.get(day.isoformat())
    return windows if isinstance(windows, list) else []


def holiday_name(day: date, exchange: str = "NSE", segment: str = "cash") -> str | None:
    """Operator-declared or seeded label for a holiday."""
    exchange, segment = normalize_scope(exchange, segment)
    overrides = calendar_overrides().get(f"{exchange}:{segment}")
    if isinstance(overrides, dict):
        names = overrides.get("holiday_names")
        if isinstance(names, dict):
            value = names.get(day.isoformat())
            if value:
                return str(value)
    return SEED_HOLIDAY_NAMES.get(day)


def is_trading_day(day: date, exchange: str = "NSE", segment: str = "cash") -> bool:
    """True when the exchange trades on ``day``.

    Weekends and verified holidays are false; a declared special session is true
    even on a weekend. An unverified year still answers weekdays-only, and
    ``calendar_coverage`` is where that caveat stays visible.
    """
    exchange, segment = normalize_scope(exchange, segment)
    if _special_session_windows(exchange, segment, day):
        return True
    if day.weekday() >= 5:
        return False
    holiday_days, _coverage, _sources, _source = _calendar_for(exchange, segment, day.year, None, None)
    return day not in holiday_days


def session_windows(day: date, exchange: str = "NSE", segment: str = "cash") -> list[dict[str, str]]:
    """Continuous/pre-open windows for ``day``; empty when it does not trade."""
    exchange, segment = normalize_scope(exchange, segment)
    special = _special_session_windows(exchange, segment, day)
    if special:
        return special
    if day == date(2026, 11, 8):
        return []
    if day.weekday() >= 5:
        return []
    holiday_days, _coverage, _sources, _source = _calendar_for(exchange, segment, day.year, None, None)
    if day in holiday_days:
        return []
    end = "15:40" if segment == "equity_derivatives" and day >= CAS_EFFECTIVE else "15:30"
    return [{"phase": "continuous", "start": "09:15", "end": end}]


def previous_trading_day(day: date, exchange: str = "NSE", segment: str = "cash") -> date | None:
    """The trading day before ``day``; never ``day`` itself. ``None`` if unknown."""
    exchange, segment = normalize_scope(exchange, segment)
    cursor = day - timedelta(days=1)
    for _ in range(366):
        if is_trading_day(cursor, exchange, segment):
            return cursor
        cursor -= timedelta(days=1)
    return None


def next_trading_day(day: date, exchange: str = "NSE", segment: str = "cash") -> date | None:
    """The trading day after ``day``; never ``day`` itself. ``None`` if unknown."""
    exchange, segment = normalize_scope(exchange, segment)
    cursor = day + timedelta(days=1)
    for _ in range(366):
        if is_trading_day(cursor, exchange, segment):
            return cursor
        cursor += timedelta(days=1)
    return None


def shift_expiry_to_trading_day(day: date, exchange: str = "NSE",
                                segment: str = "equity_derivatives") -> date:
    """``day`` when it is a session, otherwise the previous trading day.

    A contract whose listed expiry falls on a holiday resolves to the earlier
    session, which is how the exchange settles it.
    """
    if is_trading_day(day, exchange, segment):
        return day
    return previous_trading_day(day, exchange, segment) or day


# --- session phases ---------------------------------------------------------


def market_session_state(*, exchange: str = "NSE", segment: str = "cash",
                         cas_eligible: bool | None = None, now: datetime | None = None,
                         holidays: set[date] | None = None,
                         special_sessions: dict[str, list[dict[str, str]]] | None = None) -> MarketSessionState:
    """Phase for the given instant. Never raises on an unverified year."""
    current = _local(now)
    day, clock = current.date(), current.time()
    exchange, segment = normalize_scope(exchange, segment)
    scope = f"{exchange}:{segment}"
    overrides = calendar_overrides().get(scope, {})
    if not isinstance(overrides, dict):
        overrides = {}
    holiday_days, coverage, calendar_sources, source = _calendar_for(
        exchange, segment, day.year, holidays, current)
    covered = coverage.startswith(("verified_seed_", "verified_refresh_", "operator_verified_override")) \
        or holidays is not None
    if special_sessions is None:
        special_sessions = _special_sessions(overrides, exchange, segment, day.year, covered)

    def state(phase: str, continuous: bool = False) -> MarketSessionState:
        return MarketSessionState(
            exchange, segment, current.isoformat(), day.isoformat(), phase, continuous,
            cas_eligible, coverage, RULES_VERSION, source, calendar_sources,
            holiday_name(day, exchange, segment),
        )

    if day.isoformat() in special_sessions:
        for window in special_sessions[day.isoformat()]:
            try:
                if time.fromisoformat(window["start"]) <= clock < time.fromisoformat(window["end"]):
                    return state(window["phase"], window["phase"] == "continuous")
            except (KeyError, TypeError, ValueError):
                continue
        return state("special_session_closed")
    if day == date(2026, 11, 8):
        return state("special_session_times_unverified")
    if day in holiday_days or day.weekday() >= 5:
        return state("holiday" if day in holiday_days else "weekend")
    if exchange not in SUPPORTED_EXCHANGES or segment not in SEGMENTS:
        return state("unsupported_calendar")
    if clock < time(9):
        return state("pre_market")
    if clock < time(9, 15):
        if day >= PREOPEN_EFFECTIVE:
            if clock < time(9, 5):
                return state("preopen_limit_and_market_entry")
            if clock < time(9, 10):
                return state("preopen_limit_entry_random_close")
            if clock < time(9, 12):
                return state("preopen_matching")
            return state("preopen_transition")
        if clock < time(9, 8):
            return state("preopen_entry")
        if clock < time(9, 12):
            return state("preopen_matching")
        return state("preopen_transition")
    if segment == "equity_derivatives":
        end = time(15, 40) if day >= CAS_EFFECTIVE else time(15, 30)
        return state("continuous", True) if clock < end else state("closed")
    if segment != "cash":
        # Currency and commodity sessions are not modelled; do not claim a close.
        return state("continuous", True) if clock < time(17) else state("closed")
    if day < CAS_EFFECTIVE or cas_eligible is False:
        if clock < time(15, 30):
            return state("continuous", True)
    elif clock < time(15, 15):
        return state("continuous", True)
    elif cas_eligible is None and clock < time(15, 35):
        return state("closing_eligibility_unverified")
    elif cas_eligible:
        if clock < time(15, 20):
            return state("cas_reference_transition")
        if clock < time(15, 25):
            return state("cas_limit_and_market_entry")
        if clock < time(15, 30):
            return state("cas_limit_entry_random_close")
        if clock < time(15, 35):
            return state("cas_matching")
    if day >= CAS_EFFECTIVE and time(15, 50) <= clock < time(16):
        return state("post_close")
    return state("closed")


def _is_open_phase(phase: str) -> bool:
    """Phases where the last traded price is a real tick, not an indicative one."""
    return phase in _OPEN_PHASES


def _is_polling_phase(phase: str) -> bool:
    """Phases worth polling quotes for.

    Pre-open quotes are indicative but still useful for watchlists and the
    heatmap. A closed market is not: polling then only burns broker rate limits
    and manufactures stale "moves".
    """
    return phase in _OPEN_PHASES or phase in _PREOPEN_PHASES


def live_quotes_expected(*, now: datetime | None = None, exchange: str = "NSE",
                         segment: str = "cash") -> bool:
    """True only while a live quote for this scope is genuinely live."""
    state = market_session_state(exchange=exchange, segment=segment, now=now)
    return _is_open_phase(state.phase)


def last_completed_session(now: datetime | None = None, exchange: str = "NSE",
                           segment: str = "cash") -> date | None:
    """Session whose closing prices are the most recent official data.

    During a live session this is the previous trading day; after the close it
    is today. That keeps "last close" honest on a holiday and after hours alike.
    """
    exchange, segment = normalize_scope(exchange, segment)
    state = market_session_state(exchange=exchange, segment=segment, now=now)
    day = date.fromisoformat(state.trading_date)
    if state.phase == "special_session_closed":
        # A special session already traded and closed; it outranks the previous day.
        return day
    if state.phase in {"closed", "post_close"} and is_trading_day(day, exchange, segment):
        return day
    return previous_trading_day(day, exchange, segment)


def _next_open_at(now: datetime, exchange: str, segment: str) -> datetime | None:
    """Next continuous-session open in IST, honouring special-session times."""
    current = _local(now)
    cursor = current.date()
    for _ in range(366):
        starts = sorted(
            time.fromisoformat(str(window.get("start")))
            for window in session_windows(cursor, exchange, segment)
            if window.get("phase") == "continuous" and window.get("start")
        )
        for start in starts:
            candidate = datetime.combine(cursor, start, tzinfo=IST)
            if candidate > current:
                return candidate
        cursor += timedelta(days=1)
    return None


def poll_backoff_seconds(now: datetime | None = None) -> float:
    """How long a quote poller should wait before trying again.

    ``0`` while NSE cash or F&O is continuously trading. Otherwise the seconds
    until the next open, clamped to 5..300 so a closed market costs at most a
    handful of wake-ups and never a tight loop.
    """
    current = _local(now)
    for segment in ("cash", "equity_derivatives"):
        if market_session_state(exchange="NSE", segment=segment, now=current).continuous_trading:
            return 0.0
    open_at = _next_open_at(current, "NSE", "cash")
    if open_at is None:
        return 300.0
    return float(min(300, max(5, int((open_at - current).total_seconds()))))


def session_closed_reason(exchange: str, segment: str, now: datetime) -> tuple[str, dict[str, Any]] | None:
    """``("skipped: market holiday (name)", details)`` when the scope is shut.

    ``None`` means the session is open (or pre-open) and the caller should run.
    """
    exchange, segment = normalize_scope(exchange, segment)
    state = market_session_state(exchange=exchange, segment=segment, now=now)
    if _is_polling_phase(state.phase):
        return None
    label = state.holiday_name
    if state.phase == "holiday":
        reason = f"skipped: market holiday ({label})" if label else "skipped: market holiday"
    elif state.phase == "weekend":
        reason = "skipped: weekend"
    elif state.phase in {"special_session_closed", "special_session_times_unverified"}:
        reason = "skipped: market holiday (special session)"
    else:
        reason = f"skipped: market closed ({state.phase})"
    return reason, state.as_dict()


def _format_ist(dt: datetime | None, *, year: bool = False) -> str:
    if dt is None:
        return ""
    return dt.strftime("%-d %b %Y %H:%M" if year else "%-d %b %H:%M")


def _format_day(day: date | None) -> str:
    return day.strftime("%-d %b %Y") if day else ""


def _status_label(exchange: str, status: str, state: MarketSessionState,
                  last_session: date | None, next_open: datetime | None) -> str:
    if status == "open":
        return "Open"
    if status == "pre_open":
        return "Pre-open"
    if status == "holiday":
        name = state.holiday_name or "holiday"
        opens = f" · opens {_format_ist(next_open)} IST" if next_open else ""
        return f"{exchange} closed · holiday: {name}{opens}"
    if last_session is None:
        return "Closed"
    return f"Closed · last session {_format_day(last_session)}"


def market_status_now(*, exchange: str = "NSE", segment: str = "cash",
                      now: datetime | None = None) -> MarketStatus:
    """Read-only phase snapshot for the API, the shell and chat."""
    current = _local(now)
    state = market_session_state(exchange=exchange, segment=segment, now=current)
    day = date.fromisoformat(state.trading_date)
    trading_day = is_trading_day(day, exchange, segment)
    if state.phase == "holiday":
        status = "holiday"
    elif state.phase == "weekend":
        status = "weekend"
    elif state.phase in _OPEN_PHASES:
        status = "open"
    elif state.phase in _PREOPEN_PHASES:
        status = "pre_open"
    else:
        status = "closed"
    last_session = last_completed_session(now=current, exchange=exchange, segment=segment)
    next_open = _next_open_at(current, exchange, segment) if status != "open" else None
    return MarketStatus(
        exchange=state.exchange,
        segment=state.segment,
        status=status,
        phase=state.phase,
        holiday_name=state.holiday_name,
        ist_now=current.isoformat(),
        trading_date=state.trading_date,
        is_trading_day=trading_day,
        last_completed_session=last_session.isoformat() if last_session else "",
        next_open=next_open.isoformat() if next_open else None,
        live_quotes_expected=_is_open_phase(state.phase),
        calendar_coverage=state.calendar_coverage,
        label=_status_label(state.exchange, status, state, last_session, next_open),
    )


def market_status(now: datetime | None = None, exchange: str = "NSE",
                  segment: str = "cash") -> dict[str, Any]:
    """``market_status_now`` as a plain dict, for callers that prefer JSON shapes."""
    return market_status_now(exchange=exchange, segment=segment, now=now).as_dict()


def market_session_context(*, now: datetime | None = None) -> str:
    """Volatile per-run calendar block for chat; never the static system prompt."""
    current = _local(now)
    cash = market_status_now(exchange="NSE", segment="cash", now=current)
    fno = market_status_now(exchange="NSE", segment="equity_derivatives", now=current)
    live = "Live quotes expected" if cash.live_quotes_expected else "Live quotes not expected"
    trading = "a trading day" if cash.is_trading_day else "not a trading day"
    name = f" ({cash.holiday_name})" if cash.holiday_name else ""
    next_open = cash.next_open or "unknown"
    return (
        f"[Market calendar] IST now {cash.ist_now}. NSE cash {cash.trading_date}: {cash.label}. "
        f"Phase {cash.phase}. Today is {trading}{name}. "
        f"NSE equity derivatives: {fno.label} (phase {fno.phase}). "
        f"Last completed cash session {cash.last_completed_session or 'unknown'}. "
        f"Next cash open {next_open}. {live}. Coverage {cash.calendar_coverage}. "
        "Pre-open prices are indicative, not continuous-session ticks. Outside trading hours, on "
        "weekends and on exchange holidays, do not refuse the question: say the market is closed, "
        "name the holiday when one is named here, and answer from the last completed session's "
        "data (last close, end-of-day candles, recent news), labelling those numbers with that "
        "session date. Call market_status for the exact phase or holiday on a later turn. "
        "Verify CAS instrument eligibility before claiming the market is open."
    )


# --- holiday master parsing and validation ----------------------------------


def _parse_day(value: Any) -> date | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    for pattern in ("%Y-%m-%d", "%d-%b-%Y", "%d-%m-%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(raw[:11], pattern).date()
        except ValueError:
            continue
    try:
        return date.fromisoformat(raw)
    except ValueError:
        return None


def parse_nse_holiday_master(payload: Any, *, list_kind: str) -> list[dict[str, str]]:
    """Normalise an NSE holiday-master payload into ``[{"date", "name"}]``.

    Accepts the ``{"CM": [...]}`` / ``{"FO": [...]}`` shape as well as a bare
    list. Weekends are dropped: they are already implied by the calendar.
    """
    if list_kind not in LIST_KINDS:
        return []
    rows: list[Any] = []
    if isinstance(payload, dict):
        for key in (*MASTER_KEYS.values(), "data", "holidays"):
            value = payload.get(key)
            if isinstance(value, list):
                rows.extend(value)
    elif isinstance(payload, list):
        rows = payload
    out: list[dict[str, str]] = []
    seen: set[date] = set()
    for row in rows:
        if not isinstance(row, dict):
            continue
        day = _parse_day(row.get("tradingDate") or row.get("dtDate") or row.get("date")
                         or row.get("holiday_date") or row.get("Date"))
        if day is None or day.weekday() >= 5 or day in seen:
            continue
        seen.add(day)
        name = str(row.get("description") or row.get("Desc") or row.get("name") or "").strip()
        out.append({"date": day.isoformat(), "name": name or "Holiday"})
    return out


def parse_bse_holidays(payload: Any) -> list[dict[str, str]] | None:
    """Normalise a BSE holiday payload, or ``None`` when the shape is unknown."""
    rows: Any = None
    if isinstance(payload, dict):
        for key in ("data", "Data", "holidays"):
            if isinstance(payload.get(key), list):
                rows = payload[key]
                break
    elif isinstance(payload, list):
        rows = payload
    if not isinstance(rows, list):
        return None
    out: list[dict[str, str]] = []
    seen: set[date] = set()
    for row in rows:
        if not isinstance(row, dict):
            continue
        day = _parse_day(row.get("dtDate") or row.get("tradingDate") or row.get("date")
                         or row.get("Date") or row.get("holiday"))
        if day is None or day.weekday() >= 5 or day in seen:
            continue
        seen.add(day)
        name = str(row.get("description") or row.get("Desc") or row.get("name") or "").strip()
        out.append({"date": day.isoformat(), "name": name or "Holiday"})
    return out


def validate_holiday_batch(*, exchange: str, segment: str, list_kind: str, year: int,
                           holidays: list[dict]) -> tuple[bool, str]:
    """Accept or reject one fetched holiday list. Returns ``(ok, reason)``.

    Rejection is deliberate and never destructive: the row is stored as rejected
    and the previous accepted list (or the seed) keeps serving.
    """
    exchange = str(exchange or "").strip().upper()
    segment = str(segment or "").strip().lower()
    list_kind = str(list_kind or "").strip().lower()
    if exchange not in SUPPORTED_EXCHANGES:
        return False, "wrong_exchange"
    if segment not in SEGMENTS:
        return False, "wrong_segment"
    if list_kind not in LIST_KINDS:
        return False, "wrong_list_kind"
    if not isinstance(holidays, list) or not holidays:
        return False, "date_insane"
    if len(holidays) > MAX_HOLIDAYS_PER_YEAR:
        return False, "date_insane"
    seen: set[date] = set()
    for item in holidays:
        raw = item.get("date") if isinstance(item, dict) else item
        day = _parse_day(raw)
        if day is None or day.year != int(year) or day in seen:
            return False, "date_insane"
        seen.add(day)
    if list_kind != "trading":
        # Clearing lists close settlement windows, not sessions; store them as-is.
        return True, "accepted"
    seed = SEED_HOLIDAYS.get((exchange, segment, int(year)))
    if seed:
        # A "complete" list that drops a verified circular date is not complete.
        missing = sorted(day.isoformat() for day in seed - seen)
        if missing:
            return False, f"missing_seed:{missing[0]}"
    elif len(seen) < MIN_UNSEEDED_HOLIDAYS_PER_YEAR:
        return False, "date_insane"
    return True, "accepted"


# --- refresh job ------------------------------------------------------------


def _store_refresh_row(*, exchange: str, segment: str, list_kind: str, year: int,
                       holidays: list[dict[str, str]], source_url: str,
                       accepted: bool, reason: str, now: datetime) -> None:
    import uuid

    from db.models import MarketCalendarSnapshot
    from db.session import SessionLocal

    db = SessionLocal()
    try:
        db.add(
            MarketCalendarSnapshot(
                id=str(uuid.uuid4()),
                exchange=exchange,
                segment=segment,
                list_kind=list_kind,
                year=year,
                holidays_json=json.dumps(holidays),
                source_url=source_url,
                provenance_json=json.dumps({
                    "fetched_at": now.isoformat(),
                    "parser": "nse" if exchange == "NSE" else "bse",
                    "row_count": len(holidays),
                    "accepted": accepted,
                    "rejection_reason": None if accepted else reason,
                }),
                fetched_at=now.astimezone(UTC).replace(tzinfo=None),
                accepted=accepted,
                rejection_reason=None if accepted else reason,
            )
        )
        db.commit()
    finally:
        db.close()


def _fetch_nse(client: httpx.Client, list_kind: str) -> Any:
    response = client.get(f"{NSE_HOLIDAY_MASTER_URL}?type={list_kind}")
    response.raise_for_status()
    return response.json()


def run_calendar_refresh(*, client: Any = None, db: Any = None, now: datetime | None = None) -> dict[str, Any]:
    """Fetch, validate and store the official holiday masters.

    A fetch failure leaves the seeds in place and never raises into a scheduler.
    Only accepted rows change the effective calendar.
    """
    del db  # Rows are written through their own session; kept for API symmetry.
    current = _local(now)
    summary: dict[str, Any] = {
        "status": "completed",
        "fetched_at": current.isoformat(),
        "accepted": 0,
        "rejected": 0,
        "problems": [],
    }
    owns_client = client is None
    try:
        if owns_client:
            client = httpx.Client(
                timeout=20.0,
                headers={
                    "User-Agent": NSE_ARCHIVE_USER_AGENT,
                    "Accept": "application/json,text/plain,*/*",
                    "Referer": NSE_HOME_URL,
                },
                follow_redirects=False,
            )
    except Exception as exc:
        summary["status"] = "skipped"
        summary["problems"].append(f"client: {type(exc).__name__}: {exc}")
        return summary

    try:
        if owns_client:
            try:
                # NSE serves the JSON endpoint only to a cookie-bearing session.
                client.get(NSE_HOME_URL)
            except Exception:
                logger.debug("NSE home request failed before holiday master fetch", exc_info=True)
        for list_kind in LIST_KINDS:
            try:
                payload = _fetch_nse(client, list_kind)
            except Exception as exc:
                summary["problems"].append(f"NSE {list_kind}: {type(exc).__name__}: {exc}")
                continue
            rows = parse_nse_holiday_master(payload, list_kind=list_kind)
            summary.update(_store_batch(
                exchange="NSE", segment="cash", list_kind=list_kind,
                holidays=rows, source_url=f"{NSE_HOLIDAY_MASTER_URL}?type={list_kind}",
                now=current, summary=summary,
            ))
            # F&O shares the same master today; store it under its own scope so a
            # later divergence is a data change, not a code change.
            summary.update(_store_batch(
                exchange="NSE", segment="equity_derivatives", list_kind=list_kind,
                holidays=rows, source_url=f"{NSE_HOLIDAY_MASTER_URL}?type={list_kind}",
                now=current, summary=summary,
            ))

        try:
            response = client.get(BSE_HOLIDAY_URL)
            response.raise_for_status()
            bse_rows = parse_bse_holidays(response.json())
        except Exception as exc:
            bse_rows = None
            summary["problems"].append(f"BSE: {type(exc).__name__}: {exc}")
        if bse_rows:
            summary.update(_store_batch(
                exchange="BSE", segment="cash", list_kind="trading",
                holidays=bse_rows, source_url=BSE_HOLIDAY_URL, now=current, summary=summary,
            ))
        else:
            summary["problems"].append("BSE: no usable holiday rows")
    finally:
        if owns_client and client is not None:
            try:
                client.close()
            except Exception:
                pass
        clear_calendar_cache()
    if summary["accepted"] == 0:
        summary["status"] = "skipped" if not summary["problems"] else "rejected"
    return summary


def _store_batch(*, exchange: str, segment: str, list_kind: str, holidays: list[dict[str, str]],
                 source_url: str, now: datetime, summary: dict[str, Any]) -> dict[str, Any]:
    """Validate and persist one fetched list, grouped by the years it covers."""
    if not holidays:
        summary["problems"].append(f"{exchange} {segment} {list_kind}: empty list")
        return summary
    by_year: dict[int, list[dict[str, str]]] = {}
    for item in holidays:
        day = _parse_day(item.get("date") if isinstance(item, dict) else item)
        if day is not None:
            by_year.setdefault(day.year, []).append(item)
    for year, rows in sorted(by_year.items()):
        if year < now.year - 1 or year > now.year + 2:
            summary["problems"].append(f"{exchange} {segment} {list_kind} {year}: year out of range")
            continue
        accepted, reason = validate_holiday_batch(
            exchange=exchange, segment=segment, list_kind=list_kind, year=year, holidays=rows,
        )
        try:
            _store_refresh_row(
                exchange=exchange, segment=segment, list_kind=list_kind, year=year,
                holidays=rows, source_url=source_url, accepted=accepted, reason=reason, now=now,
            )
        except Exception as exc:
            summary["problems"].append(
                f"{exchange} {segment} {list_kind} {year}: store failed ({type(exc).__name__}: {exc})"
            )
            continue
        if accepted:
            summary["accepted"] += 1
        else:
            summary["rejected"] += 1
            summary["problems"].append(f"{exchange} {segment} {list_kind} {year}: {reason}")
    return summary
