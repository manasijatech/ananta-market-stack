from __future__ import annotations

from typing import Any

from app.config import get_settings
from broker.arrow import market_data, orders
from broker.arrow.http_api import ArrowHTTP
from broker.core.instruments import DefaultInstrumentResolver, InstrumentResolver


class ArrowClient:
    broker_code = "arrow"

    def __init__(
        self,
        *,
        app_id: str,
        app_secret: str,
        access_token: str,
        resolver: InstrumentResolver | None = None,
        market_stream_mode: str = "standard",
        hft_latency_ms: int = 1000,
    ) -> None:
        self.app_id = app_id
        self.app_secret = app_secret
        self.access_token = access_token
        self.resolver = resolver or DefaultInstrumentResolver()
        self.market_stream_mode = market_stream_mode if market_stream_mode in {"standard", "hft"} else "standard"
        self.hft_latency_ms = max(50, min(int(hft_latency_ms), 60_000))
        self._http = ArrowHTTP(app_id, access_token)

    def verify_connection(self) -> tuple[bool, str]:
        try:
            self.user_profile()
            return True, ""
        except Exception as exc:
            return False, str(exc)

    def _get(self, path: str, group: str) -> dict[str, Any]:
        payload = self._http.request("GET", path, group=group)
        return {"data": ArrowHTTP.data(payload), "raw": payload}

    def user_profile(self) -> dict[str, Any]:
        return self._get("/user/details", "funds")

    def order_book(self) -> dict[str, Any]:
        return self._get("/user/orders", "orders")

    def order_details(self, order_id: str) -> dict[str, Any]:
        return self._get(f"/order/{order_id}", "orders")

    def trade_book(self) -> dict[str, Any]:
        return self._get("/user/trades", "orders")

    def positions(self) -> dict[str, Any]:
        return self._get("/user/positions", "positions")

    def holdings(self) -> dict[str, Any]:
        return self._get("/user/holdings", "holdings")

    def funds(self) -> dict[str, Any]:
        return self._get("/user/limits", "funds")

    def place_order(self, data: dict[str, Any]) -> dict[str, Any]:
        return orders.place(self._http, data, self.resolver)

    def modify_order(self, data: dict[str, Any]) -> dict[str, Any]:
        return orders.modify(self._http, data, self.resolver)

    def cancel_order(self, order_id: str, **kwargs: Any) -> dict[str, Any]:
        _ = kwargs
        return orders.cancel(self._http, order_id)

    @staticmethod
    def _rows(payload: dict[str, Any], key: str) -> list[dict[str, Any]]:
        data = payload.get("data", payload)
        if isinstance(data, list):
            return [row for row in data if isinstance(row, dict)]
        if isinstance(data, dict):
            rows = data.get(key) or data.get("data")
            if isinstance(rows, list):
                return [row for row in rows if isinstance(row, dict)]
        return []

    def cancel_all_open_orders(self) -> dict[str, Any]:
        results = []
        for row in self._rows(self.order_book(), "orders"):
            status = str(row.get("status") or row.get("orderStatus") or "").upper()
            if status in {"PENDING", "OPEN", "NEW", "PENDINGNEW", "TRIGGER_PENDING"}:
                order_id = str(row.get("orderID") or row.get("orderId") or row.get("id") or "")
                if order_id:
                    results.append(self.cancel_order(order_id))
        return {"status": "success", "cancelled": len(results), "results": results}

    def smart_order(self, data: dict[str, Any]) -> dict[str, Any]:
        return self.place_order(data)

    def close_all_positions(self) -> dict[str, Any]:
        results = []
        for row in self._rows(self.positions(), "positions"):
            quantity = int(float(row.get("netQuantity") or row.get("netQty") or row.get("quantity") or 0))
            if quantity == 0:
                continue
            results.append(
                self.place_order(
                    {
                        "symbol": row.get("symbol") or row.get("tradingSymbol"),
                        "exchange": row.get("exchange"),
                        "action": "SELL" if quantity > 0 else "BUY",
                        "quantity": abs(quantity),
                        "product": row.get("product") or "I",
                        "pricetype": "MARKET",
                        "mpp": True,
                    }
                )
            )
        return {"status": "success", "closed": len(results), "results": results}

    def calculate_margin(self, positions: list[dict[str, Any]]) -> dict[str, Any]:
        include_positions = True
        if positions and "include_positions" in positions[0]:
            include_positions = bool(positions[0].get("include_positions"))
        return orders.margin(self._http, positions, self.resolver, include_positions=include_positions)

    def fetch_quotes(self, instruments: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return market_data.fetch_quotes(self._http, instruments, self.resolver)

    def search_instruments(self, query: str, limit: int = 50) -> list[dict[str, Any]]:
        _ = (query, limit)
        return []

    def sync_instruments(self) -> list[dict[str, Any]]:
        return market_data.sync_instruments(self._http)

    def fetch_ohlc(self, instruments: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return market_data.fetch_quotes(self._http, instruments, self.resolver, mode="ohlcv")

    def fetch_historical(self, request: dict[str, Any]) -> dict[str, Any]:
        return market_data.fetch_historical(self._http, request, self.resolver)

    def option_chain(self, request: dict[str, Any]) -> dict[str, Any]:
        return market_data.option_chain(self._http, request)

    def greeks(self, request: dict[str, Any]) -> dict[str, Any]:
        return market_data.greeks(self._http, request, enabled=get_settings().arrow_enable_greeks)

    def holidays(self) -> dict[str, Any]:
        return market_data.utility(self._http, "/info/holidays")

    def indices(self) -> dict[str, Any]:
        return market_data.utility(self._http, "/info/index-list")

    def option_chain_symbols(self) -> dict[str, Any]:
        return market_data.utility(self._http, "/info/option-chain-symbols/all")

    def stream_capabilities(self) -> dict[str, Any]:
        return {
            "websocket_enabled": True,
            "native": True,
            "market_stream_mode": self.market_stream_mode,
            "standard_modes": ["ltp", "ltpc", "quote", "full"],
            "hft_modes": ["ltpc", "full"],
            "order_updates": True,
            "hft_latency_ms": self.hft_latency_ms,
            "guidance": "Arrow standard streaming is enabled; HFT is opt-in and requires account entitlement.",
        }
