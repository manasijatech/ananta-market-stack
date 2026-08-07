from datetime import datetime

from app.api.v1 import live_streams
from app.services import alert_runtime
from db.models import LiveSymbolSubscription


def _row(
    *,
    symbol: str,
    source_kind: str,
    source_type: str = "",
    exchange: str = "NSE",
    updated_at: datetime | None = None,
) -> LiveSymbolSubscription:
    return LiveSymbolSubscription(
        id=f"{source_kind}-{source_type}-{symbol}",
        user_id="u1",
        account_id="acc-1",
        broker_code="dhan",
        symbol=symbol,
        exchange=exchange,
        source_kind=source_kind,
        source_type=source_type,
        status="active",
        updated_at=updated_at or datetime(2026, 8, 6, 10, 0, 0),
    )


def test_ui_view_priority_beats_bulk_watchlist():
    ui = _row(symbol="CIPLA", source_kind="ui", source_type="watchlist_view")
    watchlist = _row(symbol="CIPLA", source_kind="watchlist", source_type="watchlist")

    assert alert_runtime._subscription_priority(ui)[0] < alert_runtime._subscription_priority(watchlist)[0]
    ordered = alert_runtime._order_duplicate_group([watchlist, ui])
    assert ordered[0].source_kind == "ui"


def test_select_live_capacity_pins_ui_and_rotates_overflow():
    pinned = [
        _row(symbol="A", source_kind="ui", source_type="watchlist_view"),
        _row(symbol="B", source_kind="ui", source_type="watchlist_view"),
    ]
    rotating = [
        _row(symbol=symbol, source_kind="watchlist", source_type="watchlist")
        for symbol in ("C", "D", "E", "F")
    ]
    ordered = [[row] for row in [*pinned, *rotating]]

    live_1, wait_1 = alert_runtime.select_live_capacity_groups(
        ordered,
        capacity=3,
        redis_client=None,
        user_id="u1",
        account_id="acc-1",
    )
    assert [group[0].symbol for group in live_1] == ["A", "B", "C"]
    assert [group[0].symbol for group in wait_1] == ["D", "E", "F"]

    class _FakeRedis:
        def __init__(self) -> None:
            self.values: dict[str, str] = {}

        def get(self, key: str):
            return self.values.get(key)

        def setex(self, key: str, _ttl: int, value: str):
            self.values[key] = str(value)

    redis_client = _FakeRedis()
    live_1, _wait_1 = alert_runtime.select_live_capacity_groups(
        ordered,
        capacity=3,
        redis_client=redis_client,
        user_id="u1",
        account_id="acc-1",
    )
    live_2, wait_2 = alert_runtime.select_live_capacity_groups(
        ordered,
        capacity=3,
        redis_client=redis_client,
        user_id="u1",
        account_id="acc-1",
    )
    assert [group[0].symbol for group in live_1] == ["A", "B", "C"]
    assert [group[0].symbol for group in live_2] == ["A", "B", "D"]
    assert "C" in [group[0].symbol for group in wait_2]


def test_merge_existing_quote_context_preserves_change_on_ltp_only_tick():
    existing = {
        "symbol": "CIPLA",
        "ltp": 1400.0,
        "detail": {
            "exchange": "NSE",
            "raw": {
                "last_price": 1400.0,
                "day_change_perc": 1.25,
                "ohlc": {"open": 1380.0, "high": 1410.0, "low": 1375.0, "close": 1382.0},
            },
        },
    }
    incoming = {
        "symbol": "CIPLA",
        "ltp": 1405.0,
        "detail": {
            "exchange": "NSE",
            "raw": {
                "last_price": 1405.0,
                "ohlc": {"open": None, "high": None, "low": None, "close": None},
            },
        },
    }
    merged = alert_runtime._merge_existing_quote_context(incoming, __import__("json").dumps(existing))
    raw = merged["detail"]["raw"]
    assert raw["day_change_perc"] == 1.25
    assert raw["ohlc"]["close"] == 1382.0
    assert merged["ltp"] == 1405.0


def test_stale_tick_from_quote_payload_exposes_change_pct():
    payload = {
        "symbol": "CIPLA",
        "ltp": 1405.0,
        "detail": {
            "exchange": "NSE",
            "raw": {
                "last_price": 1405.0,
                "day_change_perc": 1.66,
                "ohlc": {"open": 1380.0, "high": 1410.0, "low": 1375.0, "close": 1382.0},
            },
        },
    }
    tick = live_streams._stale_tick_from_quote_payload(
        user_id="u1",
        account_id="acc-1",
        broker_code="dhan",
        symbol="CIPLA",
        payload=payload,
        received_at="2026-08-06T10:00:00",
    )
    assert tick is not None
    assert tick["ltp"] == 1405.0
    assert tick["change_pct"] == 1.66
    assert tick["day_change_perc"] == 1.66
    assert tick["status"] == "stale"
    assert tick["stale"] is True
