from __future__ import annotations

from typing import Any

from broker.core.data_features import unsupported_operation
from broker.core.instruments import DefaultInstrumentResolver, InstrumentResolver
from broker.indmoney import funds as ifunds
from broker.indmoney import market_data as imd
from broker.indmoney import orders as iorders
from broker.indmoney.http_api import IndmoneyHTTP


class IndmoneyClient:
    broker_code = "indmoney"

    def __init__(
        self, *, access_token: str, resolver: InstrumentResolver | None = None
    ) -> None:
        self.access_token = access_token
        self.resolver: InstrumentResolver = resolver or DefaultInstrumentResolver()
        self._http = IndmoneyHTTP(access_token)

    def verify_connection(self) -> tuple[bool, str]:
        r = ifunds.funds(self._http)
        return (True, "") if r and not r.get("status") == "error" else (False, str(r))

    def user_profile(self) -> dict[str, Any]:
        return ifunds.funds(self._http)

    def order_book(self) -> dict[str, Any]:
        return iorders.order_book(self._http)

    def trade_book(self) -> dict[str, Any]:
        return iorders.trade_book(self._http)

    def positions(self) -> dict[str, Any]:
        return iorders.positions(self._http)

    def holdings(self) -> dict[str, Any]:
        return iorders.holdings(self._http)

    def funds(self) -> dict[str, Any]:
        return ifunds.funds(self._http)

    def place_order(self, data: dict[str, Any]) -> dict[str, Any]:
        return iorders.place_order(self._http, data, self.resolver)

    def modify_order(self, data: dict[str, Any]) -> dict[str, Any]:
        return iorders.modify_order(self._http, data)

    def cancel_order(self, order_id: str, **kwargs: Any) -> dict[str, Any]:
        return iorders.cancel_order(self._http, order_id, **kwargs)

    def cancel_all_open_orders(self) -> dict[str, Any]:
        return iorders.cancel_all_open_orders(self._http)

    def smart_order(self, data: dict[str, Any]) -> dict[str, Any]:
        return iorders.smart_order(self._http, data, self.resolver)

    def close_all_positions(self) -> dict[str, Any]:
        return iorders.close_all_positions(self._http, self.resolver)

    def calculate_margin(self, positions: list[dict[str, Any]]) -> dict[str, Any]:
        _ = positions
        return {"status": "error", "message": "use indmoney native margin payload"}

    def fetch_quotes(self, instruments: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return imd.fetch_quotes(self._http, instruments)

    def search_instruments(self, query: str, limit: int = 50) -> list[dict[str, Any]]:
        _ = (query, limit)
        return []

    def sync_instruments(self) -> list[dict[str, Any]]:
        return imd.sync_instruments(self._http)

    def fetch_ohlc(self, instruments: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return imd.fetch_ohlc(self._http, instruments)

    def fetch_historical(self, request: dict[str, Any]) -> dict[str, Any]:
        return imd.fetch_historical(self._http, request, self.resolver)

    def option_chain(self, request: dict[str, Any]) -> dict[str, Any]:
        _ = request
        return unsupported_operation(self.broker_code, "option_chain")

    def greeks(self, request: dict[str, Any]) -> dict[str, Any]:
        _ = request
        return unsupported_operation(self.broker_code, "greeks")

    def stream_capabilities(self) -> dict[str, Any]:
        return imd.stream_capabilities()
