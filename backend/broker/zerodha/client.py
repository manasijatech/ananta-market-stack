from __future__ import annotations

from typing import Any

from broker.core.data_features import unsupported_operation
from broker.core.instruments import DefaultInstrumentResolver, InstrumentResolver
from broker.zerodha import auth as zauth
from broker.zerodha import funds as zfunds
from broker.zerodha import margin as zmargin
from broker.zerodha import market_data as zmd
from broker.zerodha import orders as zorders
from broker.zerodha.http_api import ZerodhaHTTP


class ZerodhaClient:
    broker_code = "zerodha"

    def __init__(
        self,
        *,
        api_key: str,
        api_secret: str,
        access_token: str,
        resolver: InstrumentResolver | None = None,
    ) -> None:
        self.api_key = api_key
        self.api_secret = api_secret
        self.access_token = access_token
        self.resolver: InstrumentResolver = resolver or DefaultInstrumentResolver()
        self._http = ZerodhaHTTP(api_key, access_token)

    def verify_connection(self) -> tuple[bool, str]:
        p = self.user_profile()
        if p.get("status") == "error":
            return False, str(p.get("message", "error"))
        return True, ""

    def user_profile(self) -> dict[str, Any]:
        return self._http.request("GET", "/user/profile")

    def order_book(self) -> dict[str, Any]:
        return zorders.order_book(self._http)

    def trade_book(self) -> dict[str, Any]:
        return zorders.trade_book(self._http)

    def positions(self) -> dict[str, Any]:
        return zorders.positions(self._http)

    def holdings(self) -> dict[str, Any]:
        return zorders.holdings(self._http)

    def funds(self) -> dict[str, Any]:
        return zfunds.get_margins(self._http)

    def place_order(self, data: dict[str, Any]) -> dict[str, Any]:
        return zorders.place_order(self._http, self.api_key, data, self.resolver)

    def modify_order(self, data: dict[str, Any]) -> dict[str, Any]:
        return zorders.modify_order(self._http, data, self.resolver)

    def cancel_order(self, order_id: str, **kwargs: Any) -> dict[str, Any]:
        return zorders.cancel_order(self._http, order_id)

    def cancel_all_open_orders(self) -> dict[str, Any]:
        return zorders.cancel_all_open_orders(self._http)

    def smart_order(self, data: dict[str, Any]) -> dict[str, Any]:
        return zorders.smart_order(self._http, self.api_key, data, self.resolver)

    def close_all_positions(self) -> dict[str, Any]:
        return zorders.close_all_positions(self._http, self.api_key, self.resolver)

    def calculate_margin(self, positions: list[dict[str, Any]]) -> dict[str, Any]:
        return zmargin.calculate_margin(self._http, positions, self.resolver)

    def fetch_quotes(self, instruments: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return zmd.fetch_quotes(self._http, instruments)

    def search_instruments(self, query: str, limit: int = 50) -> list[dict[str, Any]]:
        _ = (query, limit)
        return []

    def sync_instruments(self) -> list[dict[str, Any]]:
        return zmd.sync_instruments(self._http)

    def fetch_ohlc(self, instruments: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return zmd.fetch_ohlc(self._http, instruments)

    def fetch_historical(self, request: dict[str, Any]) -> dict[str, Any]:
        return zmd.fetch_historical(self._http, request, self.resolver)

    def option_chain(self, request: dict[str, Any]) -> dict[str, Any]:
        _ = request
        return unsupported_operation(self.broker_code, "option_chain")

    def greeks(self, request: dict[str, Any]) -> dict[str, Any]:
        _ = request
        return unsupported_operation(self.broker_code, "greeks")

    def stream_capabilities(self) -> dict[str, Any]:
        return zmd.stream_capabilities()

    def exchange_request_token(self, request_token: str) -> tuple[str | None, str | None]:
        return zauth.exchange_request_token(
            api_key=self.api_key,
            api_secret=self.api_secret,
            request_token=request_token,
        )
