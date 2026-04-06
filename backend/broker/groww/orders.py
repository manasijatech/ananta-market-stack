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


def order_book(http: GrowwHTTP) -> dict[str, Any]:
    from broker.core.http import get_httpx_client

    all_o: list[dict[str, Any]] = []
    for segment in ("CASH", "FNO"):
        page = 0
        while True:
            r = get_httpx_client().get(
                ORDER_LIST,
                headers=http.headers(),
                params={"segment": segment, "page": page, "page_size": 25},
            )
            j = r.json()
            if j.get("status") != "SUCCESS":
                break
            lst = (j.get("payload") or {}).get("order_list") or []
            all_o.extend(lst)
            if len(lst) < 25:
                break
            page += 1
    return {"status": "SUCCESS", "orders": all_o}


def trade_book(http: GrowwHTTP) -> dict[str, Any]:
    return http.get("/v1/order/trades", {})


def positions(http: GrowwHTTP) -> dict[str, Any]:
    return http.get("/v1/positions/user", {})


def holdings(http: GrowwHTTP) -> dict[str, Any]:
    return http.get("/v1/portfolio/holdings", {})


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
    return http.post("/v1/order/modify", body)


def cancel_order(
    http: GrowwHTTP, order_id: str, **kwargs: Any
) -> dict[str, Any]:
    body = {
        "order_id": order_id,
        "segment": kwargs.get("segment", "CASH"),
        "trading_symbol": kwargs.get("trading_symbol", ""),
        "exchange": kwargs.get("exchange", "NSE"),
    }
    return http.post("/v1/order/cancel", body)


def cancel_all_open_orders(http: GrowwHTTP) -> dict[str, Any]:
    ob = order_book(http)
    canceled, failed = [], []
    for o in ob.get("orders", []):
        st = str(o.get("status", "")).lower()
        if "open" in st or "pending" in st:
            r = cancel_order(
                http,
                str(o.get("order_id", "")),
                segment=o.get("segment"),
                trading_symbol=o.get("trading_symbol"),
                exchange=o.get("exchange"),
            )
            (canceled if r.get("status") == "SUCCESS" else failed).append(
                o.get("order_id")
            )
    return {"ok": True, "canceled": canceled, "failed": failed}


def smart_order(
    http: GrowwHTTP, data: dict[str, Any], resolver: InstrumentResolver
) -> dict[str, Any]:
    return place_order(http, data, resolver)


def close_all_positions(http: GrowwHTTP, resolver: InstrumentResolver) -> dict[str, Any]:
    return {"ok": False, "message": "use positions + place_order per symbol"}
