from __future__ import annotations

import importlib
import logging
import re

from broker.core.live_prices import LivePriceAdapter

logger = logging.getLogger(__name__)
_ADAPTER_CACHE: dict[str, LivePriceAdapter | None] = {}
_BROKER_CODE_PATTERN = re.compile(r"^[a-z][a-z0-9_]*$")


def get_live_price_adapter(broker_code: str) -> LivePriceAdapter | None:
    normalized = str(broker_code or "").strip().lower()
    if not normalized or not _BROKER_CODE_PATTERN.fullmatch(normalized):
        return None
    if normalized in _ADAPTER_CACHE:
        return _ADAPTER_CACHE[normalized]
    try:
        module = importlib.import_module(f"broker.{normalized}.live_price_adapter")
    except ModuleNotFoundError as exc:
        if exc.name == f"broker.{normalized}.live_price_adapter":
            _ADAPTER_CACHE[normalized] = None
            return None
        raise
    factory = getattr(module, "get_adapter", None)
    if not callable(factory):
        logger.warning("broker %s live_price_adapter module has no get_adapter()", normalized)
        _ADAPTER_CACHE[normalized] = None
        return None
    adapter = factory()
    _ADAPTER_CACHE[normalized] = adapter
    return adapter


async def close_live_price_adapters() -> None:
    for broker_code, adapter in list(_ADAPTER_CACHE.items()):
        if adapter is None:
            continue
        close_all = getattr(adapter, "close_all_sessions", None)
        if not callable(close_all):
            continue
        try:
            await close_all()
        except Exception:
            logger.exception("broker %s live price adapter cleanup failed", broker_code)
