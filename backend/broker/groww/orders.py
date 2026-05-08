from __future__ import annotations

import re
import uuid
from datetime import datetime
from typing import Any

from broker.core.instruments import InstrumentResolver
from broker.groww.http_api import GROWW_BASE, GrowwHTTP
from broker.groww.mapping import (
    map_exchange,
    map_order_type,
    map_product,
    map_segment,
    map_txn,
)

ORDER_LIST = f"{GROWW_BASE}/v1/order/list"
ORDER_SEGMENTS = ("CASH", "FNO", "COMMODITY")


def order_book(http: GrowwHTTP) -> dict[str, Any]:
    from broker.core.http import get_httpx_client

    all_o: list[dict[str, Any]] = []
    for segment in ORDER_SEGMENTS:
        page = 0
        while True:
            r = get_httpx_client().get(
                ORDER_LIST,
                headers=http.headers(),
                params={"segment": segment, "page": page, "page_size": 100},
            )
            j = r.json()
            if j.get("status") != "SUCCESS":
                break
            lst = (j.get("payload") or {}).get("order_list") or []
            all_o.extend(lst)
            if len(lst) < 100:
                break
            page += 1
    return {"status": "SUCCESS", "orders": all_o}


def trade_book(http: GrowwHTTP) -> dict[str, Any]:
    trade_list: list[dict[str, Any]] = []
    for order in order_book(http).get("orders", []):
        groww_order_id = str(order.get("groww_order_id") or "").strip()
        segment = str(order.get("segment") or "CASH").strip() or "CASH"
        if not groww_order_id:
            continue
        page = 0
        while True:
            response = http.get(
                f"/v1/order/trades/{groww_order_id}",
                {"segment": segment, "page": page, "page_size": 50},
            )
            if response.get("status") != "SUCCESS":
                break
            payload = response.get("payload") or {}
            rows = payload.get("trade_list") or []
            if not isinstance(rows, list):
                break
            trade_list.extend(rows)
            if len(rows) < 50:
                break
            page += 1
    return {"status": "SUCCESS", "trades": trade_list}


def positions(http: GrowwHTTP) -> dict[str, Any]:
    return http.get("/v1/positions/user", {})


def holdings(http: GrowwHTTP) -> dict[str, Any]:
    return http.get("/v1/holdings/user", {})


def _ref_id() -> str:
    raw = datetime.now().strftime("%Y%m%d") + "-" + uuid.uuid4().hex[:8]
    raw = re.sub(r"[^a-zA-Z0-9-]", "", raw)
    if len(raw) < 8:
        raw = raw.ljust(8, "0")
    return raw[:20]


def place_order(
    http: GrowwHTTP, data: dict[str, Any], resolver: InstrumentResolver
) -> dict[str, Any]:
    tsym = data.get("groww_trading_symbol") or resolver.broker_symbol(
        data["symbol"], data["exchange"]
    )
    ex = map_exchange(data["exchange"])
    seg = data.get("groww_segment") or map_segment(data["exchange"])
    payload = {
        "trading_symbol": tsym,
        "quantity": int(data["quantity"]),
        "validity": data.get("validity", "DAY"),
        "exchange": ex,
        "segment": seg,
        "product": map_product(data.get("product", "CNC")),
        "order_type": map_order_type(data.get("pricetype", "MARKET")),
        "transaction_type": map_txn(data["action"]),
        "order_reference_id": data.get("order_reference_id") or _ref_id(),
    }
    if data.get("pricetype", "").upper() == "LIMIT":
        payload["price"] = float(data.get("price", 0))
    if data.get("pricetype", "").upper() in ("SL", "SL-M"):
        payload["trigger_price"] = float(data.get("trigger_price", 0))
    raw = http.post("/v1/order/create", payload)
    if raw.get("status") == "SUCCESS" or raw.get("order_id"):
        return {"ok": True, "raw": raw}
    return {"ok": False, "raw": raw}


def modify_order(http: GrowwHTTP, data: dict[str, Any]) -> dict[str, Any]:
    body = data.get("groww_modify") or {}
    if not body:
        exchange = str(data.get("exchange") or "NSE")
        body = {
            "groww_order_id": data.get("groww_order_id") or data.get("orderid"),
            "segment": data.get("groww_segment") or map_segment(exchange),
        }
        if data.get("quantity") is not None:
            body["quantity"] = int(data["quantity"])
        order_type = data.get("pricetype")
        if order_type:
            body["order_type"] = map_order_type(str(order_type))
        if data.get("price") is not None:
            body["price"] = float(data["price"])
        if data.get("trigger_price") is not None:
            body["trigger_price"] = float(data["trigger_price"])
    return http.post("/v1/order/modify", body)


def cancel_order(
    http: GrowwHTTP, order_id: str, **kwargs: Any
) -> dict[str, Any]:
    segment = kwargs.get("segment")
    if not segment:
        for order in order_book(http).get("orders", []):
            groww_order_id = str(order.get("groww_order_id") or order.get("order_id") or "").strip()
            if groww_order_id == order_id:
                segment = order.get("segment")
                break
    body = {
        "groww_order_id": order_id,
        "segment": segment or "CASH",
    }
    return http.post("/v1/order/cancel", body)


def cancel_all_open_orders(http: GrowwHTTP) -> dict[str, Any]:
    ob = order_book(http)
    canceled, failed = [], []
    for o in ob.get("orders", []):
        st = str(o.get("order_status") or o.get("status") or "").lower()
        groww_order_id = str(o.get("groww_order_id") or o.get("order_id") or "").strip()
        if "open" in st or "pending" in st:
            r = cancel_order(
                http,
                groww_order_id,
                segment=o.get("segment"),
            )
            (canceled if r.get("status") == "SUCCESS" else failed).append(
                groww_order_id
            )
    return {"ok": True, "canceled": canceled, "failed": failed}


def smart_order(
    http: GrowwHTTP, data: dict[str, Any], resolver: InstrumentResolver
) -> dict[str, Any]:
    _ = resolver
    payload = data.get("groww_smart_order") or data
    return http.post("/v1/order-advance/create", payload)


def close_all_positions(http: GrowwHTTP, resolver: InstrumentResolver) -> dict[str, Any]:
    return {"ok": False, "message": "use positions + place_order per symbol"}
