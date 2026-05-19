from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.schemas.alert import AlertMarketCapFilterConfig
from app.services import alpha_symbols


def normalize_market_cap(value: Any) -> float | None:
    if value in (None, "", "null"):
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if parsed < 0:
        return None
    return parsed


def market_cap_filter_enabled(config: AlertMarketCapFilterConfig | None) -> bool:
    if config is None or config.mode != "custom":
        return False
    return config.min_value is not None or config.max_value is not None


def market_cap_in_range(value: float | None, config: AlertMarketCapFilterConfig | None) -> bool:
    if not market_cap_filter_enabled(config):
        return True
    if value is None:
        return False
    if config and config.min_value is not None and value < config.min_value:
        return False
    if config and config.max_value is not None and value > config.max_value:
        return False
    return True


def load_symbol_market_cap(
    db: Session,
    user_id: str,
    symbol: str,
    *,
    tick_market_cap: Any = None,
    cache: dict[str, tuple[float | None, str, str | None]] | None = None,
) -> tuple[float | None, str, str | None]:
    normalized_symbol = str(symbol or "").strip().upper()
    if not normalized_symbol:
        return None, "missing_symbol", "No symbol was available for market cap filtering."

    if cache is not None and normalized_symbol in cache:
        return cache[normalized_symbol]

    tick_value = normalize_market_cap(tick_market_cap)
    if tick_value is not None:
        result = (tick_value, "tick", None)
        if cache is not None:
            cache[normalized_symbol] = result
        return result

    try:
        rows = alpha_symbols.get_symbol_metadata(db, user_id, [normalized_symbol])
    except Exception as exc:
        result = (None, "fetch_error", str(exc))
        if cache is not None:
            cache[normalized_symbol] = result
        return result

    if not rows:
        result = (None, "missing", None)
        if cache is not None:
            cache[normalized_symbol] = result
        return result

    result = (normalize_market_cap(rows[0].market_cap), "metadata_cache", None)
    if cache is not None:
        cache[normalized_symbol] = result
    return result
