from __future__ import annotations

import json
from typing import Any

from broker.core.instruments import InstrumentResolver, merge_token_overrides
from broker.dhan.http_api import DhanHTTP
from broker.dhan.mapping import map_exchange_type, transform_modify_order_data, transform_order_payload


def order_book(http: DhanHTTP) -> dict[str, Any]:
    return http.request("GET", "/v2/orders")


def trade_book(http: DhanHTTP) -> dict[str, Any]:
    return http.request("GET", "/v2/trades")


def positions(http: DhanHTTP) -> dict[str, Any]:
    return http.request("GET", "/v2/positions")


def holdings(http: DhanHTTP) -> dict[str, Any]:
    return http.request("GET", "/v2/holdings")


def place_order(
    http: DhanHTTP, data: dict[str, Any], resolver: InstrumentResolver
) -> dict[str, Any]:
    d = merge_token_overrides(data, resolver)
    seg = d.get("dhan_exchange_segment") or resolver.dhan_security(
        d["symbol"], d["exchange"]
    )[0]
    sid = d.get("dhan_security_id") or resolver.dhan_security(d["symbol"], d["exchange"])[
        1
    ]
    if not seg:
        seg = map_exchange_type(d["exchange"])
    if not seg or not sid:
        return {"ok": False, "message": "dhan_security_id (+ segment/exchange) required"}
    body = transform_order_payload(d, str(seg), str(sid), http.client_id)
    raw = http.request("POST", "/v2/orders", json.dumps(body))
    if raw.get("orderId") or raw.get("status") == "success":
        return {"ok": True, "order_id": raw.get("orderId"), "raw": raw}
    return {"ok": False, "raw": raw}


def cancel_order(http: DhanHTTP, order_id: str, **kwargs: Any) -> dict[str, Any]:
    raw = http.request("DELETE", f"/v2/orders/{order_id}")
    return {"ok": not raw.get("errorType"), "raw": raw}


def modify_order(http: DhanHTTP, data: dict[str, Any], resolver: InstrumentResolver) -> dict[str, Any]:
    _ = resolver
    oid = data["orderid"]
    body = transform_modify_order_data(data, http.client_id)
    raw = http.request("PUT", f"/v2/orders/{oid}", json.dumps(body))
    return {"ok": bool(raw.get("orderId")), "raw": raw}


def cancel_all_open_orders(http: DhanHTTP) -> dict[str, Any]:
    return {"ok": False, "message": "iterate order book client-side for dhan"}


def smart_order(http: DhanHTTP, data: dict[str, Any], resolver: InstrumentResolver) -> dict[str, Any]:
    return place_order(http, data, resolver)


def close_all_positions(http: DhanHTTP, _resolver: InstrumentResolver) -> dict[str, Any]:
    return {"ok": False, "message": "implement with positions + place_order per leg"}
