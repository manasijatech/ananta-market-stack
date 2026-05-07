from __future__ import annotations

from typing import Any

from broker.core.instruments import DefaultInstrumentResolver, InstrumentResolver
from broker.groww import auth as gauth
from broker.groww import funds as gfunds
from broker.groww import market_data as gmd
from broker.groww import orders as gorders
from broker.groww.http_api import GrowwHTTP


class GrowwClient:
    broker_code = "groww"

    def __init__(
        self,
        *,
        api_key: str,
        api_secret: str,
        access_token: str = "",
        resolver: InstrumentResolver | None = None,
    ) -> None:
        self.api_key = api_key
        self.api_secret = api_secret
        self._access_token = access_token or ""
        self.resolver: InstrumentResolver = resolver or DefaultInstrumentResolver()
        self._http = GrowwHTTP(self._ensure_token())

    def _ensure_token(self) -> str:
        if self._access_token:
            return self._access_token
        tok, err = gauth.refresh_access_token(
            api_key=self.api_key, api_secret=self.api_secret
        )
        if err or not tok:
            raise RuntimeError(err or "groww token")
        self._access_token = tok
        return tok

    def verify_connection(self) -> tuple[bool, str]:
        try:
            r = gfunds.margins_user(self._http)
        except Exception as e:
            return False, str(e)
        if r.get("error"):
            return False, str(r.get("error"))
        return True, ""

    def user_profile(self) -> dict[str, Any]:
        return self._http.get("/v1/user/detail", {})

    def order_book(self) -> dict[str, Any]:
        return gorders.order_book(self._http)

    def trade_book(self) -> dict[str, Any]:
        return gorders.trade_book(self._http)

    def positions(self) -> dict[str, Any]:
        return gorders.positions(self._http)

    def holdings(self) -> dict[str, Any]:
        return gorders.holdings(self._http)

    def funds(self) -> dict[str, Any]:
        return gfunds.margins_user(self._http)

    def place_order(self, data: dict[str, Any]) -> dict[str, Any]:
        return gorders.place_order(self._http, data, self.resolver)

    def modify_order(self, data: dict[str, Any]) -> dict[str, Any]:
        return gorders.modify_order(self._http, data)

    def cancel_order(self, order_id: str, **kwargs: Any) -> dict[str, Any]:
        return gorders.cancel_order(self._http, order_id, **kwargs)

    def cancel_all_open_orders(self) -> dict[str, Any]:
        return gorders.cancel_all_open_orders(self._http)

    def smart_order(self, data: dict[str, Any]) -> dict[str, Any]:
        return gorders.smart_order(self._http, data, self.resolver)

    def close_all_positions(self) -> dict[str, Any]:
        return gorders.close_all_positions(self._http, self.resolver)

    def calculate_margin(self, positions: list[dict[str, Any]]) -> dict[str, Any]:
        _ = positions
        return {"status": "error", "message": "use Groww margins API with native payload"}

    def fetch_quotes(self, instruments: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return gmd.fetch_quotes(self._http, instruments, self.resolver)

    def refresh_access_token(self) -> tuple[str | None, str | None]:
        return gauth.refresh_access_token(api_key=self.api_key, api_secret=self.api_secret)
