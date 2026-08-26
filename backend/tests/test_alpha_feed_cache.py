from datetime import datetime

from app.services import alpha_feed_cache
from app.services.alpha_event_prices import _snapshot_from_quote_payload
from app.services.alpha_feed_cache import _item_key, _published_at
from app.services.alpha_websocket import _default_config, ensure_watchlist_aware_scope
from db.models import UserAlphaWebSocketConfig


def test_default_alpha_ws_scope_includes_watchlists():
    config = _default_config("u1")
    assert config.scope_mode == "alerts_and_watchlists"
    assert config.include_all_watchlists is True


def test_ensure_watchlist_aware_scope_upgrades_legacy_alert_only():
    config = UserAlphaWebSocketConfig(
        user_id="u1",
        scope_mode="alert_subscriptions",
        include_all_watchlists=False,
    )

    class _FakeDb:
        def add(self, _row):
            return None

    ensure_watchlist_aware_scope(_FakeDb(), config)
    assert config.scope_mode == "alerts_and_watchlists"
    assert config.include_all_watchlists is True


def test_feed_item_key_and_published_at():
    payload = {
        "id": "news-123",
        "symbol": "CIPLA",
        "headline": "Test",
        "published_at": "2026-08-01T10:15:00Z",
    }
    assert _item_key("news", payload) == "news:news-123"
    published = _published_at(payload)
    assert published is not None
    assert published.year == 2026
    assert published.month == 8


def test_payload_symbol_rejects_na_and_uses_fallback():
    from app.services.alpha_feed_cache import _payload_symbol

    assert _payload_symbol({"symbol": "N/A"}, "CIPLA") == "CIPLA"
    assert _payload_symbol({"symbol": "n/a"}, None) is None
    assert _payload_symbol({"symbol": "INFY"}, None) == "INFY"


def test_should_include_market_wide_feed_threshold():
    assert alpha_feed_cache._should_include_market_wide_feed(["CIPLA"]) is False
    assert alpha_feed_cache._should_include_market_wide_feed([f"S{i}" for i in range(20)]) is False
    assert alpha_feed_cache._should_include_market_wide_feed([f"S{i}" for i in range(50)]) is True


def test_symbol_match_clauses_supports_colon_separated_symbols():
    clause = alpha_feed_cache._symbol_match_clauses(["CIPLA"])
    assert clause is not False


def test_list_cached_feed_items_reads_db_before_refresh(monkeypatch):
    from types import SimpleNamespace

    calls: list[str] = []

    def _fake_query(*_args, **_kwargs):
        calls.append("query")
        return {
            "data": [{"id": "news-1", "symbol": "CIPLA"}],
            "page": 1,
            "limit": 20,
            "has_next": True,
            "total": 2,
            "from_cache": True,
        }

    def _fake_refresh(*_args, **_kwargs):
        calls.append("refresh")
        return {"refreshed_symbols": 0, "upserted": 0, "pending_remaining": 3}

    monkeypatch.setattr(alpha_feed_cache, "_query_cached_feed_page", _fake_query)
    monkeypatch.setattr(alpha_feed_cache, "refresh_feed_cache_for_symbols", _fake_refresh)

    result = alpha_feed_cache.list_cached_feed_items(
        SimpleNamespace(),
        "u1",
        "news",
        ["CIPLA"],
        page=1,
        limit=20,
    )
    assert calls == ["query", "refresh"]
    assert result["has_next"] is True
    assert result["pending_symbols"] == 3


def test_list_cached_feed_items_refresh_failure_still_returns_cache(monkeypatch):
    from types import SimpleNamespace

    def _fake_query(*_args, **_kwargs):
        return {
            "data": [{"id": "news-1", "symbol": "CIPLA"}],
            "page": 1,
            "limit": 20,
            "has_next": False,
            "total": 1,
            "from_cache": True,
        }

    def _fake_refresh(*_args, **_kwargs):
        raise RuntimeError("refresh failed")

    monkeypatch.setattr(alpha_feed_cache, "_query_cached_feed_page", _fake_query)
    monkeypatch.setattr(alpha_feed_cache, "refresh_feed_cache_for_symbols", _fake_refresh)

    result = alpha_feed_cache.list_cached_feed_items(
        SimpleNamespace(),
        "u1",
        "news",
        ["CIPLA"],
        page=1,
        limit=20,
    )
    assert result["data"][0]["symbol"] == "CIPLA"
    assert result["total"] == 1


def test_price_snapshot_from_quote_payload():
    snapshot = _snapshot_from_quote_payload(
        {
            "ltp": 1405.5,
            "broker_code": "dhan",
            "change_pct": 1.25,
        },
        source="live_redis",
        broker_code="dhan",
    )
    assert snapshot is not None
    assert snapshot["price_ltp"] == 1405.5
    assert snapshot["price_change_pct"] == 1.25
    assert snapshot["price_source"] == "live_redis"
    assert isinstance(snapshot["price_as_of"], datetime)


def test_symbols_needing_sync_prioritizes_never_synced_then_oldest_stale():
    from types import SimpleNamespace

    from app.services.alpha_feed_cache import _utc_now

    class _FakeResult:
        def __init__(self, rows):
            self._rows = rows

        def all(self):
            return self._rows

    class _FakeDb:
        def __init__(self, rows):
            self._rows = rows

        def scalars(self, _stmt):
            return _FakeResult(self._rows)

    fresh = _utc_now()
    rows = [
        SimpleNamespace(symbol="A", last_synced_at=fresh, last_error=None),
        SimpleNamespace(symbol="B", last_synced_at=datetime(2026, 7, 1), last_error=None),
    ]
    pending = alpha_feed_cache._symbols_needing_sync(
        _FakeDb(rows),
        user_id="u1",
        product="news",
        symbols=["C", "A", "B", "D"],
        force_refresh=False,
    )
    # Never-synced first, then oldest stale — fresh A is skipped; no subset cap.
    assert pending == ["C", "D", "B"]


def test_symbols_needing_sync_force_refresh_includes_full_watchlist():
    class _FakeDb:
        def scalars(self, _stmt):
            raise AssertionError("should not query when force_refresh")

    symbols = [f"S{i}" for i in range(250)]
    pending = alpha_feed_cache._symbols_needing_sync(
        _FakeDb(),
        user_id="u1",
        product="news",
        symbols=symbols,
        force_refresh=True,
    )
    assert pending == symbols


def test_historical_backfill_uses_requested_start_date():
    class _FakeDb:
        def scalars(self, _stmt):
            raise AssertionError("historical requests should not need the sync-gap query")

    start = alpha_feed_cache._refresh_from_date_for_batch(
        _FakeDb(),
        user_id="u1",
        product="earnings",
        batch=["CIPLA"],
        from_date="2024-01-15T00:00:00Z",
        historical=True,
        force_refresh=False,
    )
    assert start == "2024-01-15"


def test_list_cached_feed_items_page_two_skips_refresh(monkeypatch):
    from types import SimpleNamespace

    refresh_called = {"value": False}

    def _fake_query(*_args, **_kwargs):
        return {
            "data": [{"id": "news-2", "symbol": "CIPLA"}],
            "page": 2,
            "limit": 20,
            "has_next": False,
            "total": 2,
            "from_cache": True,
        }

    def _fake_refresh(*_args, **_kwargs):
        refresh_called["value"] = True
        return {"refreshed_symbols": 0, "upserted": 0, "pending_remaining": 0}

    monkeypatch.setattr(alpha_feed_cache, "_query_cached_feed_page", _fake_query)
    monkeypatch.setattr(alpha_feed_cache, "refresh_feed_cache_for_symbols", _fake_refresh)
    monkeypatch.setattr(alpha_feed_cache, "_symbols_needing_sync", lambda *_a, **_k: ["CIPLA", "RELIANCE"])

    result = alpha_feed_cache.list_cached_feed_items(
        SimpleNamespace(),
        "u1",
        "news",
        ["CIPLA", "RELIANCE"],
        page=2,
        limit=20,
    )
    assert refresh_called["value"] is False
    assert result["pending_symbols"] == 2
