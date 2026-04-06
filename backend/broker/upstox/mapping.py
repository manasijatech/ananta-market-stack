from __future__ import annotations

from typing import Any

from broker.core.logging_util import get_logger

logger = get_logger(__name__)


def transform_order(data: dict[str, Any], instrument_token: str) -> dict[str, Any]:
    return {
        "quantity": data["quantity"],
        "product": map_product_type(data["product"]),
        "validity": "DAY",
        "price": data.get("price", "0"),
        "tag": data.get("tag", "string"),
        "instrument_token": instrument_token,
        "order_type": map_order_type(data["pricetype"]),
        "transaction_type": data["action"].upper(),
        "disclosed_quantity": data.get("disclosed_quantity", "0"),
        "trigger_price": data.get("trigger_price", "0"),
        "is_amo": data.get("is_amo", False),
    }


def transform_modify_order_data(data: dict[str, Any]) -> dict[str, Any]:
    return {
        "quantity": data["quantity"],
        "validity": "DAY",
        "price": data["price"],
        "order_id": data["orderid"],
        "order_type": map_order_type(data["pricetype"]),
        "disclosed_quantity": data.get("disclosed_quantity", "0"),
        "trigger_price": data.get("trigger_price", "0"),
    }


def map_order_type(pricetype: str) -> str:
    m = {"MARKET": "MARKET", "LIMIT": "LIMIT", "SL": "SL", "SL-M": "SL-M"}
    return m.get(pricetype, "MARKET")


def map_product_type(product: str) -> str:
    m = {"CNC": "D", "NRML": "D", "MIS": "I"}
    return m.get(product, "I")


def reverse_map_product_type(exchange: str, product: str) -> str | None:
    if product == "I":
        return "MIS"
    if product == "D":
        return {"NSE": "CNC", "BSE": "CNC", "NFO": "NRML", "BFO": "NRML", "MCX": "NRML", "CDS": "NRML"}.get(
            exchange
        )
    return None
