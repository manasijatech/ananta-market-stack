from datetime import datetime

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
