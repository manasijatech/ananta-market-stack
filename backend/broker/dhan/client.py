from __future__ import annotations

from typing import Any

from broker.core.instruments import DefaultInstrumentResolver, InstrumentResolver
from broker.dhan import auth as dauth
from broker.dhan import funds as dfunds
from broker.dhan import margin as dmrg
from broker.dhan import market_data as dmd
from broker.dhan import orders as dorders
from broker.dhan.http_api import DhanHTTP


class DhanClient:
    broker_code = "dhan"

    def __init__(
        self,
        *,
        app_id: str,
        app_secret: str,
        client_id: str,
        access_token: str,
        resolver: InstrumentResolver | None = None,
    ) -> None:
        self.app_id = app_id
        self.app_secret = app_secret
        self.client_id = client_id
        self.access_token = access_token
        self.resolver: InstrumentResolver = resolver or DefaultInstrumentResolver()
        self._http = DhanHTTP(access_token, client_id)

    def verify_connection(self) -> tuple[bool, str]:
        r = dfunds.fund_limits(self._http)
        if r.get("errorType") == "Invalid_Authentication":
            return False, str(r.get("errorMessage", "auth"))
        if r.get("status") == "error":
            return False, str(r.get("errors", "err"))
        return True, ""

    def user_profile(self) -> dict[str, Any]:
        return dfunds.fund_limits(self._http)

    def order_book(self) -> dict[str, Any]:
        return dorders.order_book(self._http)

    def trade_book(self) -> dict[str, Any]:
        return dorders.trade_book(self._http)

    def positions(self) -> dict[str, Any]:
        return dorders.positions(self._http)

    def holdings(self) -> dict[str, Any]:
        return dorders.holdings(self._http)

    def funds(self) -> dict[str, Any]:
        return dfunds.fund_limits(self._http)

    def place_order(self, data: dict[str, Any]) -> dict[str, Any]:
        return dorders.place_order(self._http, data, self.resolver)

    def modify_order(self, data: dict[str, Any]) -> dict[str, Any]:
        return dorders.modify_order(self._http, data, self.resolver)

    def cancel_order(self, order_id: str, **kwargs: Any) -> dict[str, Any]:
        return dorders.cancel_order(self._http, order_id)

    def cancel_all_open_orders(self) -> dict[str, Any]:
        return dorders.cancel_all_open_orders(self._http)

    def smart_order(self, data: dict[str, Any]) -> dict[str, Any]:
        return dorders.smart_order(self._http, data, self.resolver)

    def close_all_positions(self) -> dict[str, Any]:
        return dorders.close_all_positions(self._http, self.resolver)

    def calculate_margin(self, positions: list[dict[str, Any]]) -> dict[str, Any]:
        if not positions:
            return {"status": "error", "message": "empty"}
        return dmrg.calculate_margin(self._http, positions[0])

    def fetch_quotes(self, instruments: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return dmd.fetch_quotes(self._http, instruments)

    def consume_consent_token(self, token_id: str) -> tuple[str | None, str | None]:
        return dauth.consume_consent(
            app_id=self.app_id, app_secret=self.app_secret, token_id=token_id
        )
