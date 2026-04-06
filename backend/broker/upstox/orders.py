from __future__ import annotations

import json
from typing import Any

from broker.core.instruments import InstrumentResolver, merge_token_overrides
from broker.upstox.http_api import UpstoxHTTP
from broker.upstox.mapping import (
    map_product_type,
    reverse_map_product_type,
    transform_modify_order_data,
    transform_order,
)


def order_book(http: UpstoxHTTP) -> dict[str, Any]:
    return http.json_call("GET", "/v2/order/retrieve-all")


def trade_book(http: UpstoxHTTP) -> dict[str, Any]:
    return http.json_call("GET", "/v2/order/trades/get-trades-for-day")


def positions(http: UpstoxHTTP) -> dict[str, Any]:
    return http.json_call("GET", "/v2/portfolio/short-term-positions")


def holdings(http: UpstoxHTTP) -> dict[str, Any]:
    return http.json_call("GET", "/v2/portfolio/long-term-holdings")


def _open_qty(
    http: UpstoxHTTP, symbol: str, exchange: str, product: str, resolver: InstrumentResolver
) -> int:
    br = resolver.broker_symbol(symbol, exchange)
    pd = positions(http)
    if pd.get("status") != "success" or not pd.get("data"):
        return 0
    for p in pd["data"]:
        if (
            p.get("tradingsymbol") == br
            and p.get("exchange") == exchange
            and p.get("product") == product
        ):
            return int(p.get("quantity", 0) or 0)
    return 0


def place_order(
    http: UpstoxHTTP, data: dict[str, Any], resolver: InstrumentResolver
) -> dict[str, Any]:
    d = merge_token_overrides(data, resolver)
    tok = d.get("instrument_token")
    if tok is None:
        uk = d.get("upstox_instrument_key")
        if uk:
            # v2 place uses instrument_token field with numeric string from key split — caller should pass instrument_token
            return {"ok": False, "message": "instrument_token required (or extend resolver)"}
        return {"ok": False, "message": "instrument_token required"}
    newd = transform_order(d, str(tok))
    payload = json.dumps(
        {
            "quantity": newd["quantity"],
            "product": newd["product"],
            "validity": newd["validity"],
            "price": newd["price"],
            "tag": newd["tag"],
            "instrument_token": newd["instrument_token"],
            "order_type": newd["order_type"],
            "transaction_type": newd["transaction_type"],
            "disclosed_quantity": newd["disclosed_quantity"],
            "trigger_price": newd["trigger_price"],
            "is_amo": newd["is_amo"],
        }
    )
    raw = http.json_call("POST", "/v2/order/place", payload)
    if raw.get("status") == "success":
        oid = (raw.get("data") or {}).get("order_id")
        return {"ok": True, "order_id": oid, "raw": raw}
    return {"ok": False, "raw": raw}


def modify_order(http: UpstoxHTTP, data: dict[str, Any]) -> dict[str, Any]:
    newd = transform_modify_order_data(data)
    payload = json.dumps(newd)
    raw = http.json_call("PUT", "/v2/order/modify", payload)
    if raw.get("status") == "success":
        return {"ok": True, "order_id": (raw.get("data") or {}).get("order_id"), "raw": raw}
    return {"ok": False, "raw": raw}


def cancel_order(http: UpstoxHTTP, order_id: str, **_kw: Any) -> dict[str, Any]:
    raw = http.json_call("DELETE", f"/v2/order/cancel?order_id={order_id}")
    if raw.get("status") == "success":
        return {"ok": True, "order_id": (raw.get("data") or {}).get("order_id"), "raw": raw}
    return {"ok": False, "raw": raw}


def cancel_all_open_orders(http: UpstoxHTTP) -> dict[str, Any]:
    ob = order_book(http)
    if ob.get("status") != "success":
        return {"ok": False, "raw": ob}
    canceled, failed = [], []
    for order in ob.get("data", {}).get("orders", ob.get("data", [])) if isinstance(ob.get("data"), dict) else ob.get("data", []) or []:
        if not isinstance(order, dict):
            continue
        if order.get("status") in ("open", "trigger pending", "OPEN", "TRIGGER PENDING"):
            oid = order.get("order_id")
            if oid:
                r = cancel_order(http, oid)
                (canceled if r.get("ok") else failed).append(oid)
    return {"ok": True, "canceled": canceled, "failed": failed}


def smart_order(http: UpstoxHTTP, data: dict[str, Any], resolver: InstrumentResolver) -> dict[str, Any]:
    cur = _open_qty(
        http,
        data["symbol"],
        data["exchange"],
        map_product_type(data["product"]),
        resolver,
    )
    target = int(data.get("position_size", 0))
    if target == cur:
        return {"ok": True, "message": "no action"}
    if target > cur:
        act, qty = "BUY", target - cur
    else:
        act, qty = "SELL", cur - target
    od = {**data, "action": act, "quantity": str(qty)}
    return place_order(http, od, resolver)


def close_all_positions(http: UpstoxHTTP, resolver: InstrumentResolver) -> dict[str, Any]:
    pd = positions(http)
    if pd.get("status") != "success" or not pd.get("data"):
        return {"ok": True, "message": "no positions"}
    out: list[dict[str, Any]] = []
    for p in pd["data"]:
        q = int(p.get("quantity", 0) or 0)
        if q == 0:
            continue
        sym = resolver.oa_symbol(p.get("tradingsymbol", ""), p.get("exchange", ""))
        out.append(
            place_order(
                http,
                {
                    "symbol": sym,
                    "exchange": p["exchange"],
                    "action": "SELL" if q > 0 else "BUY",
                    "pricetype": "MARKET",
                    "product": reverse_map_product_type(p["exchange"], p["product"]) or "MIS",
                    "quantity": str(abs(q)),
                    "instrument_token": p.get("instrument_token"),
                },
                resolver,
            )
        )
    return {"ok": True, "results": out}
