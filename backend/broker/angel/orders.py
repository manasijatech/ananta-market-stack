from __future__ import annotations

import json
from typing import Any

from broker.core.instruments import InstrumentResolver, merge_token_overrides
from broker.angel.http_api import AngelHTTP
from broker.angel.mapping import reverse_product, transform_modify, transform_place


def order_book(http: AngelHTTP) -> dict[str, Any]:
    return http.request("GET", "/rest/secure/angelbroking/order/v1/getOrderBook")


def trade_book(http: AngelHTTP) -> dict[str, Any]:
    return http.request("GET", "/rest/secure/angelbroking/order/v1/getTradeBook")


def positions(http: AngelHTTP) -> dict[str, Any]:
    return http.request("GET", "/rest/secure/angelbroking/order/v1/getPosition")


def holdings(http: AngelHTTP) -> dict[str, Any]:
    return http.request("GET", "/rest/secure/angelbroking/portfolio/v1/getAllHolding")


def _net_qty(http: AngelHTTP, symbol: str, exchange: str, producttype: str, resolver: InstrumentResolver) -> int:
    br = resolver.broker_symbol(symbol, exchange)
    pd = positions(http)
    if not pd.get("status") or not pd.get("data"):
        return 0
    for p in pd["data"]:
        if (
            p.get("tradingsymbol") == br
            and p.get("exchange") == exchange
            and p.get("producttype") == producttype
        ):
            return int(p.get("netqty", 0) or 0)
    return 0


def place_order(
    http: AngelHTTP, api_key: str, data: dict[str, Any], resolver: InstrumentResolver
) -> dict[str, Any]:
    d = merge_token_overrides(data, resolver)
    tok = d.get("symboltoken")
    if not tok:
        return {"ok": False, "message": "symboltoken / angel_token required"}
    body = transform_place(d, api_key, str(tok), resolver)
    raw = http.request(
        "POST", "/rest/secure/angelbroking/order/v1/placeOrder", json.dumps(body)
    )
    if raw.get("status") is True:
        oid = (raw.get("data") or {}).get("orderid")
        return {"ok": True, "order_id": oid, "raw": raw}
    return {"ok": False, "raw": raw}


def modify_order(
    http: AngelHTTP, api_key: str, data: dict[str, Any], resolver: InstrumentResolver
) -> dict[str, Any]:
    d = merge_token_overrides(data, resolver)
    tok = d.get("symboltoken")
    if not tok:
        return {"ok": False, "message": "symboltoken required"}
    body = transform_modify(d, str(tok), resolver)
    raw = http.request(
        "POST", "/rest/secure/angelbroking/order/v1/modifyOrder", json.dumps(body)
    )
    if raw.get("status") is True or raw.get("message") == "SUCCESS":
        return {"ok": True, "order_id": (raw.get("data") or {}).get("orderid"), "raw": raw}
    return {"ok": False, "raw": raw}


def cancel_order(http: AngelHTTP, order_id: str, **_kw: Any) -> dict[str, Any]:
    payload = json.dumps({"variety": "NORMAL", "orderid": order_id})
    raw = http.request(
        "POST", "/rest/secure/angelbroking/order/v1/cancelOrder", payload
    )
    if raw.get("status"):
        return {"ok": True, "order_id": order_id, "raw": raw}
    return {"ok": False, "raw": raw}


def cancel_all_open_orders(http: AngelHTTP) -> dict[str, Any]:
    ob = order_book(http)
    if ob.get("status") is not True:
        return {"ok": False, "raw": ob}
    canceled, failed = [], []
    for order in ob.get("data") or []:
        if order.get("status") in ("open", "trigger pending"):
            r = cancel_order(http, order["orderid"])
            (canceled if r.get("ok") else failed).append(order["orderid"])
    return {"ok": True, "canceled": canceled, "failed": failed}


def smart_order(
    http: AngelHTTP, api_key: str, data: dict[str, Any], resolver: InstrumentResolver
) -> dict[str, Any]:
    from broker.angel.mapping import _map_product as mp

    prod = mp(data["product"])
    cur = _net_qty(http, data["symbol"], data["exchange"], prod, resolver)
    target = int(data.get("position_size", 0))
    if target == cur and int(data.get("quantity", 0) or 0) == 0:
        return {"ok": True, "message": "no action"}
    if target == 0 and cur == 0 and int(data.get("quantity", 0) or 0) != 0:
        return place_order(http, api_key, data, resolver)
    if target > cur:
        act, qty = "BUY", target - cur
    else:
        act, qty = "SELL", cur - target
    od = {**data, "action": act, "quantity": str(qty)}
    return place_order(http, api_key, od, resolver)


def close_all_positions(http: AngelHTTP, api_key: str, resolver: InstrumentResolver) -> dict[str, Any]:
    pd = positions(http)
    if not pd.get("data"):
        return {"ok": True, "message": "empty"}
    out = []
    for p in pd["data"]:
        q = int(p.get("netqty", 0) or 0)
        if q == 0:
            continue
        # symbol from token unknown without resolver DB — caller should use resolver
        sym = resolver.oa_symbol(p.get("tradingsymbol", ""), p.get("exchange", ""))
        out.append(
            place_order(
                http,
                api_key,
                {
                    "symbol": sym,
                    "exchange": p["exchange"],
                    "action": "SELL" if q > 0 else "BUY",
                    "pricetype": "MARKET",
                    "product": reverse_product(p.get("producttype", "")) or "MIS",
                    "quantity": str(abs(q)),
                    "symboltoken": p.get("symboltoken"),
                },
                resolver,
            )
        )
    return {"ok": True, "results": out}
