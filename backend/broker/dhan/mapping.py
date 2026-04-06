from __future__ import annotations

from typing import Any


def map_order_type(pricetype: str) -> str:
    return {
        "MARKET": "MARKET",
        "LIMIT": "LIMIT",
        "SL": "STOP_LOSS",
        "SL-M": "STOP_LOSS_MARKET",
    }.get(pricetype, "MARKET")


def map_exchange_type(exchange: str) -> str | None:
    return {
        "NSE": "NSE_EQ",
        "BSE": "BSE_EQ",
        "CDS": "NSE_CURRENCY",
        "NFO": "NSE_FNO",
        "BFO": "BSE_FNO",
        "BCD": "BSE_CURRENCY",
        "MCX": "MCX_COMM",
    }.get(exchange)


def map_product_type(product: str) -> str:
    return {"CNC": "CNC", "NRML": "MARGIN", "MIS": "INTRADAY"}.get(product, "INTRADAY")


def transform_order_payload(
    data: dict[str, Any], exchange_segment: str, security_id: str, dhan_client_id: str
) -> dict[str, Any]:
    transformed: dict[str, Any] = {
        "dhanClientId": data.get("dhan_client_id") or dhan_client_id,
        "transactionType": data["action"].upper(),
        "exchangeSegment": exchange_segment,
        "productType": map_product_type(data["product"]),
        "orderType": map_order_type(data["pricetype"]),
        "validity": data.get("validity") or "DAY",
        "securityId": security_id,
        "quantity": int(data["quantity"]),
    }
    if data["pricetype"] != "MARKET":
        transformed["price"] = float(data.get("price", 0))
    dq = int(data.get("disclosed_quantity", 0) or 0)
    if dq > 0:
        transformed["disclosedQuantity"] = dq
    if data["pricetype"] in ("SL", "SL-M"):
        tp = float(data.get("trigger_price", 0) or 0)
        if tp > 0:
            transformed["triggerPrice"] = tp
    return transformed


def transform_modify_order_data(data: dict[str, Any], dhan_client_id: str) -> dict[str, Any]:
    modified: dict[str, Any] = {
        "dhanClientId": data.get("dhan_client_id") or dhan_client_id,
        "orderId": data["orderid"],
        "orderType": map_order_type(data["pricetype"]),
        "legName": "ENTRY_LEG",
        "quantity": int(data["quantity"]),
        "validity": "DAY",
    }
    if data.get("pricetype") != "MARKET":
        modified["price"] = float(data["price"])
    dq = int(data.get("disclosed_quantity", 0) or 0)
    if dq > 0:
        modified["disclosedQuantity"] = dq
    if data["pricetype"] in ("SL", "SL-M"):
        tp = float(data.get("trigger_price", 0) or 0)
        if tp > 0:
            modified["triggerPrice"] = tp
    return modified
