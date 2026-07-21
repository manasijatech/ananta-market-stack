from __future__ import annotations

from typing import Any

from broker.arrow.http_api import ArrowHTTP

PRODUCTS = {"MIS": "I", "INTRADAY": "I", "CNC": "C", "DELIVERY": "C", "NRML": "M", "MARGIN": "M", "I": "I", "C": "C", "M": "M"}
ORDER_TYPES = {"LIMIT": "LMT", "LMT": "LMT", "MARKET": "MKT", "MKT": "MKT", "SL": "SL-LMT", "SL-L": "SL-LMT", "SL-LMT": "SL-LMT", "SL-M": "SL-MKT", "SL-MKT": "SL-MKT"}


def order_payload(data: dict[str, Any], resolver: Any) -> dict[str, Any]:
    exchange = str(data.get("exchange") or "NSE").upper()
    symbol = str(data.get("trading_symbol") or data.get("symbol") or "")
    if symbol and resolver:
        symbol = resolver.broker_symbol(symbol, exchange)
    order_type = ORDER_TYPES.get(
        str(data.get("pricetype") or data.get("order_type") or data.get("orderType") or data.get("order") or "MARKET").upper()
    )
    if not order_type:
        raise ValueError("unsupported Arrow order type")
    action = str(data.get("action") or data.get("transaction_type") or data.get("transactionType") or "BUY").upper()
    transaction_type = {"BUY": "B", "B": "B", "SELL": "S", "S": "S"}.get(action)
    if transaction_type is None:
        raise ValueError("Arrow transaction type must be BUY/B or SELL/S")
    quantity = int(data.get("quantity") or 0)
    if not symbol or quantity <= 0:
        raise ValueError("Arrow orders require a symbol and positive quantity")
    payload: dict[str, Any] = {
        "symbol": symbol,
        "exchange": exchange,
        "transactionType": transaction_type,
        "quantity": str(quantity),
        "product": PRODUCTS.get(str(data.get("product") or "MIS").upper(), str(data.get("product") or "I")),
        "order": order_type,
        "price": str(data.get("price") or 0),
        "validity": str(data.get("validity") or "DAY").upper(),
        "disclosedQty": str(data.get("disclosed_quantity") or data.get("disclosedQuantity") or data.get("disclosedQty") or 0),
    }
    trigger_price = data.get("trigger_price") or data.get("triggerPrice")
    if trigger_price is not None:
        payload["triggerPrice"] = str(trigger_price)
    if data.get("remarks") is not None:
        payload["remarks"] = str(data["remarks"])[:16]
    if order_type == "MKT":
        payload["mpp"] = bool(data.get("mpp", True))
    if data.get("amo") is not None:
        payload["amo"] = bool(data["amo"])
    return payload


def place(http: ArrowHTTP, data: dict[str, Any], resolver: Any) -> dict[str, Any]:
    payload = order_payload(data, resolver)
    response = http.request("POST", "/order/regular", group="orders", json=payload, retry_read=False)
    result = {"data": ArrowHTTP.data(response), "request": payload, "raw": response}
    if payload.get("mpp"):
        result["execution_semantics"] = "Arrow MPP submits a limit order at the upper limit or DPR; it may remain open."
    return result


def modify(http: ArrowHTTP, data: dict[str, Any], resolver: Any) -> dict[str, Any]:
    order_id = str(data.get("orderid") or data.get("order_id") or "")
    if not order_id:
        raise ValueError("Arrow order modification requires orderid")
    payload = order_payload(data, resolver)
    response = http.request("PATCH", f"/order/regular/{order_id}", group="orders", json=payload, retry_read=False)
    result = {"data": ArrowHTTP.data(response), "request": payload, "raw": response}
    if payload.get("mpp"):
        result["execution_semantics"] = "Arrow MPP submits a limit order at the upper limit or DPR; it may remain open."
    return result


def cancel(http: ArrowHTTP, order_id: str) -> dict[str, Any]:
    response = http.request("DELETE", f"/order/regular/{order_id}", group="orders", retry_read=False)
    return {"data": ArrowHTTP.data(response), "raw": response}


def margin(http: ArrowHTTP, positions: list[dict[str, Any]], resolver: Any, *, include_positions: bool = True) -> dict[str, Any]:
    orders = []
    for position in positions:
        order = order_payload(position, resolver)
        margin_order = {
            key: order[key]
            for key in ("exchange", "symbol", "quantity", "product", "price", "transactionType", "order", "triggerPrice")
            if key in order
        }
        token = position.get("instrument_token") or position.get("arrow_token")
        if token:
            margin_order["token"] = str(token)
        orders.append(margin_order)
    if len(orders) == 1:
        payload: Any = orders[0]
        path = "/margin/order"
    else:
        payload = {"orders": orders, "includePositions": include_positions}
        path = "/margin/basket"
    response = http.request("POST", path, group="orders", json=payload)
    return {"data": ArrowHTTP.data(response), "request": payload, "raw": response}
