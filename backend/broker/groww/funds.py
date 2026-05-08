from __future__ import annotations

from typing import Any

from broker.core.instruments import InstrumentResolver
from broker.groww.http_api import GrowwHTTP
from broker.groww.mapping import map_exchange, map_order_type, map_product, map_segment, map_txn


def margins_user(http: GrowwHTTP) -> dict:
    return http.get("/v1/margins/detail/user", {})


def order_margin_details(
    http: GrowwHTTP,
    positions: list[dict[str, Any]],
    resolver: InstrumentResolver,
) -> dict:
    if not positions:
        return {"status": "SUCCESS", "payload": {}}

    segments = {
        pos.get("groww_segment") or map_segment(str(pos.get("exchange") or "NSE"))
        for pos in positions
    }
    if len(segments) != 1:
        raise ValueError("Groww margin calculation requires all legs to belong to one segment")
    segment = next(iter(segments))

    payload: list[dict[str, Any]] = []
    for pos in positions:
        exchange = str(pos.get("exchange") or "NSE")
        order_type = map_order_type(str(pos.get("pricetype") or "MARKET"))
        row: dict[str, Any] = {
            "trading_symbol": pos.get("groww_trading_symbol")
            or resolver.broker_symbol(str(pos.get("symbol") or ""), exchange),
            "transaction_type": map_txn(str(pos.get("action") or "BUY")),
            "quantity": int(pos.get("quantity") or 0),
            "order_type": order_type,
            "product": map_product(str(pos.get("product") or "CNC")),
            "exchange": pos.get("groww_exchange") or map_exchange(exchange),
        }
        if order_type in ("LIMIT", "SL", "SL-M") and pos.get("price") is not None:
            row["price"] = float(pos.get("price") or 0)
        payload.append(row)

    return http.post(f"/v1/margins/detail/orders?segment={segment}", payload)
