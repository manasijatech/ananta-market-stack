from __future__ import annotations

from typing import Any

from broker.core.data_features import unsupported_operation
from broker.core.instruments import DefaultInstrumentResolver, InstrumentResolver
from broker.upstox import auth as uauth
from broker.upstox import funds as ufunds
from broker.upstox import margin as umargin
from broker.upstox import market_data as umd
from broker.upstox import orders as uorders
from broker.upstox.http_api import UpstoxHTTP


class UpstoxClient:
    broker_code = "upstox"

    def __init__(
        self,
        *,
        api_key: str,
        api_secret: str,
        redirect_uri: str,
        access_token: str,
        resolver: InstrumentResolver | None = None,
    ) -> None:
        self.api_key = api_key
        self.api_secret = api_secret
        self.redirect_uri = redirect_uri
        self.access_token = access_token
        self.resolver: InstrumentResolver = resolver or DefaultInstrumentResolver()
        self._http = UpstoxHTTP(access_token)

    def verify_connection(self) -> tuple[bool, str]:
        p = self.user_profile()
        if p.get("status") == "error" or p.get("errors"):
            return False, str(p.get("message", p.get("errors", "error")))
        return True, ""

    def user_profile(self) -> dict[str, Any]:
        return self._http.json_call("GET", "/v2/user/profile")

    def order_book(self) -> dict[str, Any]:
        return uorders.order_book(self._http)

    def trade_book(self) -> dict[str, Any]:
        return uorders.trade_book(self._http)

    def positions(self) -> dict[str, Any]:
        return uorders.positions(self._http)

    def holdings(self) -> dict[str, Any]:
        return uorders.holdings(self._http)

    def funds(self) -> dict[str, Any]:
        return ufunds.get_funds_and_margin(self._http)

    def place_order(self, data: dict[str, Any]) -> dict[str, Any]:
        return uorders.place_order(self._http, data, self.resolver)

    def modify_order(self, data: dict[str, Any]) -> dict[str, Any]:
        return uorders.modify_order(self._http, data)

    def cancel_order(self, order_id: str, **kwargs: Any) -> dict[str, Any]:
        return uorders.cancel_order(self._http, order_id)

    def cancel_all_open_orders(self) -> dict[str, Any]:
        return uorders.cancel_all_open_orders(self._http)

    def smart_order(self, data: dict[str, Any]) -> dict[str, Any]:
        return uorders.smart_order(self._http, data, self.resolver)

    def close_all_positions(self) -> dict[str, Any]:
        return uorders.close_all_positions(self._http, self.resolver)

    def calculate_margin(self, positions: list[dict[str, Any]]) -> dict[str, Any]:
        return umargin.calculate_margin(self._http, positions, self.resolver)

    def fetch_quotes(self, instruments: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return umd.fetch_quotes(self._http, instruments)

    def search_instruments(self, query: str, limit: int = 50) -> list[dict[str, Any]]:
        _ = (query, limit)
        return []

    def sync_instruments(self) -> list[dict[str, Any]]:
        return umd.sync_instruments(self._http)

    def fetch_ohlc(self, instruments: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return umd.fetch_ohlc(self._http, instruments)

    def fetch_historical(self, request: dict[str, Any]) -> dict[str, Any]:
        return umd.fetch_historical(self._http, request, self.resolver)

    def option_chain(self, request: dict[str, Any]) -> dict[str, Any]:
        _ = request
        return unsupported_operation(self.broker_code, "option_chain")

    def greeks(self, request: dict[str, Any]) -> dict[str, Any]:
        _ = request
        return unsupported_operation(self.broker_code, "greeks")

    def stream_capabilities(self) -> dict[str, Any]:
        return umd.stream_capabilities()

    def exchange_authorization_code(self, code: str) -> tuple[str | None, str | None]:
        return uauth.exchange_authorization_code(
            api_key=self.api_key,
            api_secret=self.api_secret,
            redirect_uri=self.redirect_uri,
            code=code,
        )
