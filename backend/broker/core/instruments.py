"""
Pluggable symbol / token resolution.

Default implementation is identity (broker symbol == your symbol). For full automation,
provide a resolver backed by your instrument master DB (see future `instruments` feature).
"""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable


@runtime_checkable
class InstrumentResolver(Protocol):
    """Maps canonical symbol/exchange to broker-native identifiers."""

    def broker_symbol(self, symbol: str, exchange: str) -> str:
        """Trading symbol as the broker expects (e.g. Zerodha tradingsymbol)."""

    def oa_symbol(self, broker_symbol: str, exchange: str) -> str:
        """Inverse mapping for responses / square-off flows."""

    def instrument_token(self, symbol: str, exchange: str) -> int | None:
        """Numeric token (Zerodha, Upstox) if known."""

    def angel_token(self, symbol: str, exchange: str) -> str | None:
        """Angel One symbol token string if known."""

    def dhan_security(self, symbol: str, exchange: str) -> tuple[str | None, str | None]:
        """Return (exchange_segment, security_id) for Dhan if known."""

    def upstox_instrument_key(self, symbol: str, exchange: str) -> str | None:
        """Upstox instrument_key if known."""

    def kotak_psymbol(self, symbol: str, exchange: str) -> tuple[str | None, str | None]:
        """Return (kotak_segment e.g. nse_cm, pSymbol) if known."""


class DefaultInstrumentResolver:
    """Identity mapping; token methods return None — pass tokens in API payloads."""

    def broker_symbol(self, symbol: str, exchange: str) -> str:
        return symbol

    def oa_symbol(self, broker_symbol: str, exchange: str) -> str:
        return broker_symbol

    def instrument_token(self, symbol: str, exchange: str) -> int | None:
        return None

    def angel_token(self, symbol: str, exchange: str) -> str | None:
        return None

    def dhan_security(self, symbol: str, exchange: str) -> tuple[str | None, str | None]:
        return None, None

    def upstox_instrument_key(self, symbol: str, exchange: str) -> str | None:
        return None

    def kotak_psymbol(self, symbol: str, exchange: str) -> tuple[str | None, str | None]:
        return None, None


def merge_token_overrides(data: dict[str, Any], resolver: InstrumentResolver) -> dict[str, Any]:
    """Fill resolver fields from order/quote dict when caller inlined tokens."""
    out = dict(data)
    sym = out.get("symbol") or ""
    ex = out.get("exchange") or ""
    if out.get("instrument_token") is None:
        t = resolver.instrument_token(sym, ex)
        if t is not None:
            out["instrument_token"] = t
    if out.get("symboltoken") is None:
        at = out.get("angel_token") or resolver.angel_token(sym, ex)
        if at is not None:
            out["symboltoken"] = str(at)
    if out.get("upstox_instrument_key") is None:
        uk = resolver.upstox_instrument_key(sym, ex)
        if uk is not None:
            out["upstox_instrument_key"] = uk
    return out
