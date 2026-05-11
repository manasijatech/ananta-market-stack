from __future__ import annotations

from typing import Any

from broker.core.data_features import unsupported_operation
from broker.core.instruments import DefaultInstrumentResolver, InstrumentResolver
from broker.kotak import auth as kauth
from broker.kotak import funds as kfunds
from broker.kotak import margin as kmrg
from broker.kotak import market_data as kmd
from broker.kotak import orders as korders
from broker.kotak.http_api import KotakHTTP


class KotakClient:
    broker_code = "kotak"

    def __init__(
        self,
        *,
        ucc: str,
        portal_access_token: str,
        session_bundle: str | None = None,
        resolver: InstrumentResolver | None = None,
    ) -> None:
        self.ucc = ucc
        self.portal_access_token = portal_access_token
        self.session_bundle = session_bundle
        self.resolver: InstrumentResolver = resolver or DefaultInstrumentResolver()
        self._http = KotakHTTP(session_bundle, portal_access_token)

    def verify_connection(self) -> tuple[bool, str]:
        if not self.session_bundle:
            return False, "configure session_bundle (TOTP+MPIN)"
        p = korders.positions(self._http)
        if isinstance(p, dict) and p.get("error"):
            return False, str(p.get("error"))
        return True, ""

    def user_profile(self) -> dict[str, Any]:
        return kfunds.limits(self._http)

    def order_book(self) -> dict[str, Any]:
        return korders.order_book(self._http)

    def trade_book(self) -> dict[str, Any]:
        return korders.trade_book(self._http)

    def positions(self) -> dict[str, Any]:
        return korders.positions(self._http)

    def holdings(self) -> dict[str, Any]:
        return korders.holdings(self._http)

    def funds(self) -> dict[str, Any]:
        return kfunds.limits(self._http)

    def place_order(self, data: dict[str, Any]) -> dict[str, Any]:
        return korders.place_order(self._http, data, self.resolver)

    def modify_order(self, data: dict[str, Any]) -> dict[str, Any]:
        return korders.modify_order(self._http, data)

    def cancel_order(self, order_id: str, **kwargs: Any) -> dict[str, Any]:
        return korders.cancel_order(self._http, order_id, **kwargs)

    def cancel_all_open_orders(self) -> dict[str, Any]:
        return korders.cancel_all_open_orders(self._http)

    def smart_order(self, data: dict[str, Any]) -> dict[str, Any]:
        return korders.smart_order(self._http, data, self.resolver)

    def close_all_positions(self) -> dict[str, Any]:
        return korders.close_all_positions(self._http, self.resolver)

    def calculate_margin(self, positions: list[dict[str, Any]]) -> dict[str, Any]:
        return kmrg.calculate_margin(positions)

    def fetch_quotes(self, instruments: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return kmd.fetch_quotes(self._http, instruments)

    def search_instruments(self, query: str, limit: int = 50) -> list[dict[str, Any]]:
        _ = (query, limit)
        return []

    def sync_instruments(self) -> list[dict[str, Any]]:
        return kmd.sync_instruments(self._http)

    def fetch_ohlc(self, instruments: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return kmd.fetch_ohlc(self._http, instruments)

    def fetch_historical(self, request: dict[str, Any]) -> dict[str, Any]:
        _ = request
        return unsupported_operation(self.broker_code, "historical")

    def option_chain(self, request: dict[str, Any]) -> dict[str, Any]:
        _ = request
        return unsupported_operation(self.broker_code, "option_chain")

    def greeks(self, request: dict[str, Any]) -> dict[str, Any]:
        _ = request
        return unsupported_operation(self.broker_code, "greeks")

    def stream_capabilities(self) -> dict[str, Any]:
        return kmd.stream_capabilities()

    def refresh_session(
        self, mobile_number: str, totp: str, mpin: str
    ) -> tuple[str | None, str | None]:
        return kauth.totp_mpin_session(
            ucc=self.ucc,
            portal_access_token=self.portal_access_token,
            mobile_number=mobile_number,
            totp=totp,
            mpin=mpin,
        )
