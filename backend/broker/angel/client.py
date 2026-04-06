from __future__ import annotations

from typing import Any

from broker.core.instruments import DefaultInstrumentResolver, InstrumentResolver
from broker.angel import auth as aauth
from broker.angel import funds as afunds
from broker.angel import margin as amargin
from broker.angel import market_data as amd
from broker.angel import orders as aorders
from broker.angel.http_api import AngelHTTP


class AngelClient:
    broker_code = "angel"

    def __init__(
        self,
        *,
        api_key: str,
        client_code: str,
        pin: str,
        jwt_token: str,
        feed_token: str | None = None,
        resolver: InstrumentResolver | None = None,
    ) -> None:
        self.api_key = api_key
        self.client_code = client_code
        self.pin = pin
        self.jwt_token = jwt_token
        self.feed_token = feed_token
        self.resolver: InstrumentResolver = resolver or DefaultInstrumentResolver()
        self._http = AngelHTTP(api_key, jwt_token)

    def verify_connection(self) -> tuple[bool, str]:
        r = afunds.get_rms(self._http)
        if r.get("data") is not None:
            return True, ""
        return False, str(r.get("message", "verify failed"))

    def user_profile(self) -> dict[str, Any]:
        return afunds.get_rms(self._http)

    def order_book(self) -> dict[str, Any]:
        return aorders.order_book(self._http)

    def trade_book(self) -> dict[str, Any]:
        return aorders.trade_book(self._http)

    def positions(self) -> dict[str, Any]:
        return aorders.positions(self._http)

    def holdings(self) -> dict[str, Any]:
        return aorders.holdings(self._http)

    def funds(self) -> dict[str, Any]:
        return afunds.get_rms(self._http)

    def place_order(self, data: dict[str, Any]) -> dict[str, Any]:
        return aorders.place_order(self._http, self.api_key, data, self.resolver)

    def modify_order(self, data: dict[str, Any]) -> dict[str, Any]:
        return aorders.modify_order(self._http, self.api_key, data, self.resolver)

    def cancel_order(self, order_id: str, **kwargs: Any) -> dict[str, Any]:
        return aorders.cancel_order(self._http, order_id)

    def cancel_all_open_orders(self) -> dict[str, Any]:
        return aorders.cancel_all_open_orders(self._http)

    def smart_order(self, data: dict[str, Any]) -> dict[str, Any]:
        return aorders.smart_order(self._http, self.api_key, data, self.resolver)

    def close_all_positions(self) -> dict[str, Any]:
        return aorders.close_all_positions(self._http, self.api_key, self.resolver)

    def calculate_margin(self, positions: list[dict[str, Any]]) -> dict[str, Any]:
        return amargin.calculate_margin(self._http, positions, self.resolver)

    def fetch_quotes(self, instruments: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return amd.fetch_quotes(self._http, instruments)

    def login_refresh(self, client_code: str, pin: str, totp: str) -> tuple[str | None, str | None, str | None]:
        return aauth.login(api_key=self.api_key, client_code=client_code, pin=pin, totp=totp)
