from __future__ import annotations

from typing import Any

from broker.core.instruments import InstrumentResolver
from broker.kotak.http_api import KotakHTTP


def order_book(http: KotakHTTP) -> dict[str, Any]:
    return http.trade_get("/quick/user/orders")


def trade_book(http: KotakHTTP) -> dict[str, Any]:
    return http.trade_get("/quick/user/trades")


def positions(http: KotakHTTP) -> dict[str, Any]:
    return http.trade_get("/quick/user/positions")


def holdings(http: KotakHTTP) -> dict[str, Any]:
    return http.trade_get("/portfolio/v1/holdings")


def place_order(
    http: KotakHTTP, data: dict[str, Any], resolver: InstrumentResolver
) -> dict[str, Any]:
    _ = resolver
    body = data.get("kotak_native_order") or data
    if not http.base_url:
        return {"ok": False, "message": "session required"}
    import json
    from broker.core.http import get_httpx_client

    url = f"{http.base_url}/quick/order/place"
    r = get_httpx_client().post(
        url, headers=http.trade_headers(), content=json.dumps(body)
    )
    try:
        return {"ok": True, "raw": r.json()}
    except Exception:
        return {"ok": False, "message": r.text[:500]}


def modify_order(http: KotakHTTP, data: dict[str, Any]) -> dict[str, Any]:
    body = data.get("kotak_modify") or data
    import json
    from broker.core.http import get_httpx_client

    url = f"{http.base_url}/quick/order/modify"
    r = get_httpx_client().post(
        url, headers=http.trade_headers(), content=json.dumps(body)
    )
    return {"ok": True, "raw": r.json() if r.text else {}}


def cancel_order(http: KotakHTTP, order_id: str, **kwargs: Any) -> dict[str, Any]:
    _ = kwargs
    body = {"orderId": order_id}
    import json
    from broker.core.http import get_httpx_client

    url = f"{http.base_url}/quick/order/cancel"
    r = get_httpx_client().post(
        url, headers=http.trade_headers(), content=json.dumps(body)
    )
    return {"ok": True, "raw": r.json() if r.text else {}}


def cancel_all_open_orders(http: KotakHTTP) -> dict[str, Any]:
    return {"ok": False, "message": "iterate orders client-side"}


def smart_order(
    http: KotakHTTP, data: dict[str, Any], resolver: InstrumentResolver
) -> dict[str, Any]:
    return place_order(http, data, resolver)


def close_all_positions(
    http: KotakHTTP, _resolver: InstrumentResolver
) -> dict[str, Any]:
    _ = http, _resolver
    return {"ok": False, "message": "use native square-off flow"}
