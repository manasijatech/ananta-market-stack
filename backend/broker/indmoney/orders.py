from __future__ import annotations

from typing import Any

from broker.core.instruments import InstrumentResolver
from broker.indmoney.http_api import IndmoneyHTTP


def order_book(http: IndmoneyHTTP) -> dict[str, Any]:
    return http.request("GET", "/order-book", None, None)


def trade_book(http: IndmoneyHTTP) -> dict[str, Any]:
    equity = http.request("GET", "/trade-book", {"segment": "EQUITY"}, None)
    derivative = http.request("GET", "/trade-book", {"segment": "DERIVATIVE"}, None)
    if equity.get("status") == "error":
        return equity
    if derivative.get("status") == "error":
        return derivative
    rows: list[dict[str, Any]] = []
    for payload in (equity, derivative):
        value = payload.get("data")
        if isinstance(value, list):
            rows.extend(item for item in value if isinstance(item, dict))
    return {"status": "success", "data": rows or None}


def positions(http: IndmoneyHTTP) -> dict[str, Any]:
    return http.request("GET", "/portfolio/positions", None, None)


def holdings(http: IndmoneyHTTP) -> dict[str, Any]:
    return http.request("GET", "/portfolio/holdings", None, None)


def place_order(
    http: IndmoneyHTTP, data: dict[str, Any], resolver: InstrumentResolver
) -> dict[str, Any]:
    _ = resolver
    body = data.get("indmoney_native_order") or data
    return http.request("POST", "/order", None, body)


def modify_order(http: IndmoneyHTTP, data: dict[str, Any]) -> dict[str, Any]:
    return http.request("POST", "/order/modify", None, data.get("indmoney_modify", data))


def cancel_order(http: IndmoneyHTTP, order_id: str, **kwargs: Any) -> dict[str, Any]:
    return http.request(
        "POST", "/order/cancel", None, {"order_id": order_id, **kwargs}
    )


def cancel_all_open_orders(http: IndmoneyHTTP) -> dict[str, Any]:
    return {"ok": False, "message": "filter order book client-side"}


def smart_order(
    http: IndmoneyHTTP, data: dict[str, Any], resolver: InstrumentResolver
) -> dict[str, Any]:
    return place_order(http, data, resolver)


def close_all_positions(
    http: IndmoneyHTTP, _resolver: InstrumentResolver
) -> dict[str, Any]:
    _ = http
    return {"ok": False, "message": "not implemented"}
