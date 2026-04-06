from __future__ import annotations

import urllib.parse
from typing import Any

from broker.core.http import get_httpx_client
from broker.core.instruments import InstrumentResolver
from broker.core.logging_util import get_logger
from broker.zerodha.http_api import ZerodhaHTTP
from broker.zerodha.mapping import (
    map_product_type,
    reverse_map_product_type,
    transform_modify_order_data,
    transform_order,
)

logger = get_logger(__name__)


def order_book(http: ZerodhaHTTP) -> dict[str, Any]:
    return http.request("GET", "/orders")


def trade_book(http: ZerodhaHTTP) -> dict[str, Any]:
    return http.request("GET", "/trades")


def positions(http: ZerodhaHTTP) -> dict[str, Any]:
    return http.request("GET", "/portfolio/positions")


def holdings(http: ZerodhaHTTP) -> dict[str, Any]:
    return http.request("GET", "/portfolio/holdings")


def _open_position_qty(
    http: ZerodhaHTTP, symbol: str, exchange: str, product: str, resolver: InstrumentResolver
) -> int:
    br = resolver.broker_symbol(symbol, exchange)
    pd = positions(http)
    if not pd.get("status") == "success" or not pd.get("data"):
        return 0
    for p in pd["data"].get("net", []):
        if (
            p.get("tradingsymbol") == br
            and p.get("exchange") == exchange
            and p.get("product") == product
        ):
            return int(p.get("quantity", 0) or 0)
    return 0


def place_order(
    http: ZerodhaHTTP, api_key: str, data: dict[str, Any], resolver: InstrumentResolver
) -> dict[str, Any]:
    newdata = transform_order(data, api_key, resolver)
    payload = {
        "tradingsymbol": newdata["tradingsymbol"],
        "exchange": newdata["exchange"],
        "transaction_type": newdata["transaction_type"],
        "order_type": newdata["order_type"],
        "quantity": newdata["quantity"],
        "product": map_product_type(newdata["product"]),
        "price": newdata["price"],
        "trigger_price": newdata["trigger_price"],
        "disclosed_quantity": newdata["disclosed_quantity"],
        "validity": newdata["validity"],
        "market_protection": newdata["market_protection"],
        "tag": newdata["tag"],
    }
    enc = urllib.parse.urlencode(payload)
    raw = http.request("POST", "/orders/regular", content=enc)
    if raw.get("status") == "success":
        oid = (raw.get("data") or {}).get("order_id")
        return {"ok": True, "order_id": oid, "raw": raw}
    return {"ok": False, "raw": raw}


def modify_order(
    http: ZerodhaHTTP, data: dict[str, Any], _resolver: InstrumentResolver
) -> dict[str, Any]:
    newdata = transform_modify_order_data(data)
    payload = {
        "order_type": newdata["order_type"],
        "quantity": str(newdata["quantity"]),
        "price": str(newdata["price"]) if newdata["price"] else "0",
        "disclosed_quantity": str(newdata["disclosed_quantity"] or "0"),
        "validity": newdata["validity"],
    }
    if newdata.get("trigger_price"):
        payload["trigger_price"] = str(newdata["trigger_price"])
    enc = urllib.parse.urlencode(payload)
    oid = data["orderid"]
    raw = http.request("PUT", f"/orders/regular/{oid}", content=enc)
    if raw.get("status") == "success" or raw.get("message") == "SUCCESS":
        return {
            "ok": True,
            "order_id": (raw.get("data") or {}).get("order_id"),
            "raw": raw,
        }
    return {"ok": False, "raw": raw}


def cancel_order(http: ZerodhaHTTP, order_id: str) -> dict[str, Any]:
    client = get_httpx_client()
    headers = {
        "X-Kite-Version": "3",
        "Authorization": f"token {http.api_key}:{http.access_token}",
    }
    r = client.delete(f"https://api.kite.trade/orders/regular/{order_id}", headers=headers)
    try:
        data = r.json()
    except Exception:
        return {"ok": False, "message": r.text[:500]}
    if data.get("status"):
        return {"ok": True, "order_id": (data.get("data") or {}).get("order_id"), "raw": data}
    return {"ok": False, "raw": data}


def cancel_all_open_orders(http: ZerodhaHTTP) -> dict[str, Any]:
    ob = order_book(http)
    if ob.get("status") != "success":
        return {"ok": False, "message": "order book", "raw": ob}
    canceled: list[str] = []
    failed: list[str] = []
    for order in ob.get("data") or []:
        if order.get("status") in ("OPEN", "TRIGGER PENDING"):
            res = cancel_order(http, order["order_id"])
            if res.get("ok"):
                canceled.append(order["order_id"])
            else:
                failed.append(order["order_id"])
    return {"ok": True, "canceled": canceled, "failed": failed}


def smart_order(
    http: ZerodhaHTTP, api_key: str, data: dict[str, Any], resolver: InstrumentResolver
) -> dict[str, Any]:
    symbol = data.get("symbol")
    exchange = data.get("exchange")
    product = data.get("product")
    if not all([symbol, exchange, product]):
        return {"ok": False, "message": "missing symbol/exchange/product"}
    pos_size = int(data.get("position_size", 0))
    current = _open_position_qty(http, symbol, exchange, map_product_type(product), resolver)
    if pos_size == 0 and current == 0 and int(data.get("quantity", 0) or 0) != 0:
        return place_order(http, api_key, data, resolver)
    if pos_size == current:
        return {"ok": True, "message": "no action", "raw": {}}
    if pos_size > current:
        action, qty = "BUY", pos_size - current
    else:
        action, qty = "SELL", current - pos_size
    od = {**data, "action": action, "quantity": str(qty)}
    return place_order(http, api_key, od, resolver)


def close_all_positions(http: ZerodhaHTTP, api_key: str, resolver: InstrumentResolver) -> dict[str, Any]:
    pd = positions(http)
    if not pd.get("data"):
        return {"ok": True, "message": "no positions"}
    results: list[dict[str, Any]] = []
    for position in pd["data"].get("net", []):
        if int(position.get("quantity", 0) or 0) == 0:
            continue
        qty = abs(int(position["quantity"]))
        action = "SELL" if int(position["quantity"]) > 0 else "BUY"
        oa_sym = resolver.oa_symbol(position["tradingsymbol"], position["exchange"])
        payload = {
            "symbol": oa_sym,
            "exchange": position["exchange"],
            "action": action,
            "pricetype": "MARKET",
            "product": reverse_map_product_type(position["exchange"], position["product"])
            or "MIS",
            "quantity": str(qty),
            "tag": "squareoff",
        }
        results.append(place_order(http, api_key, payload, resolver))
    return {"ok": True, "results": results}
