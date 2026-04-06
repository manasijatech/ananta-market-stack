"""Canonical order payload → Zerodha Kite fields."""

from __future__ import annotations

from typing import Any

from broker.core.instruments import InstrumentResolver


def transform_order(data: dict[str, Any], api_key: str, resolver: InstrumentResolver) -> dict[str, Any]:
    symbol = resolver.broker_symbol(data["symbol"], data["exchange"])
    return {
        "tradingsymbol": symbol,
        "exchange": data["exchange"],
        "transaction_type": data["action"].upper(),
        "order_type": data["pricetype"],
        "quantity": data["quantity"],
        "product": data["product"],
        "price": data.get("price", "0"),
        "trigger_price": data.get("trigger_price", "0"),
        "disclosed_quantity": data.get("disclosed_quantity", "0"),
        "validity": "DAY",
        "market_protection": "-1",
        "tag": data.get("tag", "os-core"),
        "apikey": api_key,
    }


def transform_modify_order_data(data: dict[str, Any]) -> dict[str, Any]:
    return {
        "order_type": _map_order_type(data["pricetype"]),
        "quantity": data["quantity"],
        "price": data["price"],
        "trigger_price": data.get("trigger_price", "0"),
        "disclosed_quantity": data.get("disclosed_quantity", "0"),
        "validity": "DAY",
    }


def _map_order_type(pricetype: str) -> str:
    return {"MARKET": "MARKET", "LIMIT": "LIMIT", "SL": "SL", "SL-M": "SL-M"}.get(
        pricetype, "MARKET"
    )


def map_product_type(product: str) -> str:
    return {"CNC": "CNC", "NRML": "NRML", "MIS": "MIS"}.get(product, "MIS")


def reverse_map_product_type(_exchange: str, product: str) -> str | None:
    return { "CNC": "CNC", "NRML": "NRML", "MIS": "MIS"}.get(product)
