"""
Unified broker surface area used by the API layer.

Each broker package implements this contract on a client class. Methods return
broker-native JSON dicts/lists unless noted; errors are surfaced as dicts with
``status`` / ``message`` / ``error`` keys where the upstream API does so.
"""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable


@runtime_checkable
class UnifiedBrokerClient(Protocol):
    """All operational entry points for a single broker account."""

    broker_code: str

    def verify_connection(self) -> tuple[bool, str]: ...

    def user_profile(self) -> dict[str, Any]:
        """Account / profile if the broker exposes it."""

    def order_book(self) -> dict[str, Any]: ...
    def trade_book(self) -> dict[str, Any]: ...
    def positions(self) -> dict[str, Any]: ...
    def holdings(self) -> dict[str, Any]: ...
    def funds(self) -> dict[str, Any]:
        """Margins / fund limits / balances (broker-specific shape)."""

    def place_order(self, data: dict[str, Any]) -> dict[str, Any]:
        """Canonical-ish order dict; may include inline instrument overrides."""

    def modify_order(self, data: dict[str, Any]) -> dict[str, Any]: ...
    def cancel_order(self, order_id: str, **kwargs: Any) -> dict[str, Any]: ...
    def cancel_all_open_orders(self) -> dict[str, Any]: ...
    def smart_order(self, data: dict[str, Any]) -> dict[str, Any]: ...
    def close_all_positions(self) -> dict[str, Any]: ...
    def calculate_margin(self, positions: list[dict[str, Any]]) -> dict[str, Any]: ...
    def fetch_quotes(self, instruments: list[dict[str, Any]]) -> list[dict[str, Any]]: ...
