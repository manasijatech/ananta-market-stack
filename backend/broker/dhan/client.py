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
        r = dfunds.profile(self._http)
        if r.get("errorType") or r.get("status") in {"error", "failed"}:
            return False, str(
                r.get("errorMessage")
                or r.get("message")
                or r.get("errors")
                or r.get("errorType")
                or "Dhan verification failed"
            )
        data_plan = str(r.get("dataPlan") or "").strip().lower()
        if data_plan and data_plan != "active":
            return False, "Dhan connection is valid, but the Data API plan is not active."
        return True, ""

    def user_profile(self) -> dict[str, Any]:
        return dfunds.profile(self._http)

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

    def search_instruments(self, query: str, limit: int = 50) -> list[dict[str, Any]]:
        _ = (query, limit)
        return []

    def sync_instruments(self) -> list[dict[str, Any]]:
        return dmd.sync_instruments(self._http)

    def fetch_ohlc(self, instruments: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return dmd.fetch_ohlc(self._http, instruments)

    def fetch_historical(self, request: dict[str, Any]) -> dict[str, Any]:
        return dmd.fetch_historical(self._http, request, self.resolver)

    def option_chain(self, request: dict[str, Any]) -> dict[str, Any]:
        return dmd.fetch_option_chain(self._http, request)

    def greeks(self, request: dict[str, Any]) -> dict[str, Any]:
        return dmd.fetch_greeks(self._http, request)

    def stream_capabilities(self) -> dict[str, Any]:
        return dmd.stream_capabilities()

    def consume_consent_token(self, token_id: str) -> tuple[str | None, str | None]:
        payload, err = dauth.consume_consent(
            app_id=self.app_id, app_secret=self.app_secret, token_id=token_id
        )
        return (payload.get("access_token") if payload else None), err
