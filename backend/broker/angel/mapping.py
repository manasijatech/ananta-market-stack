from __future__ import annotations

from typing import Any

from broker.core.instruments import InstrumentResolver


def transform_place(data: dict[str, Any], api_key: str, symboltoken: str, resolver: InstrumentResolver) -> dict[str, Any]:
    symbol = resolver.broker_symbol(data["symbol"], data["exchange"])
    return {
        "apikey": api_key,
        "variety": _map_variety(data["pricetype"]),
        "tradingsymbol": symbol,
        "symboltoken": symboltoken,
        "transactiontype": data["action"].upper(),
        "exchange": data["exchange"],
        "ordertype": _map_order_type(data["pricetype"]),
        "producttype": _map_product(data["product"]),
        "duration": "DAY",
        "price": data.get("price", "0"),
        "squareoff": "0",
        "stoploss": data.get("trigger_price", "0"),
        "disclosedquantity": data.get("disclosed_quantity", "0"),
        "triggerprice": data.get("trigger_price", "0"),
        "quantity": data["quantity"],
    }


def transform_modify(data: dict[str, Any], symboltoken: str, resolver: InstrumentResolver) -> dict[str, Any]:
    sym = resolver.broker_symbol(data["symbol"], data["exchange"])
    return {
        "variety": _map_variety(data["pricetype"]),
        "orderid": data["orderid"],
        "ordertype": _map_order_type(data["pricetype"]),
        "producttype": _map_product(data["product"]),
        "duration": "DAY",
        "price": data["price"],
        "quantity": data["quantity"],
        "tradingsymbol": sym,
        "symboltoken": symboltoken,
        "exchange": data["exchange"],
        "disclosedquantity": data.get("disclosed_quantity", "0"),
        "stoploss": data.get("trigger_price", "0"),
    }


def _map_order_type(pt: str) -> str:
    return {
        "MARKET": "MARKET",
        "LIMIT": "LIMIT",
        "SL": "STOPLOSS_LIMIT",
        "SL-M": "STOPLOSS_MARKET",
    }.get(pt, "MARKET")


def _map_product(p: str) -> str:
    return {"CNC": "DELIVERY", "NRML": "CARRYFORWARD", "MIS": "INTRADAY"}.get(p, "INTRADAY")


def _map_variety(pt: str) -> str:
    return {"MARKET": "NORMAL", "LIMIT": "NORMAL", "SL": "STOPLOSS", "SL-M": "STOPLOSS"}.get(
        pt, "NORMAL"
    )


def reverse_product(pt: str) -> str | None:
    return {"DELIVERY": "CNC", "CARRYFORWARD": "NRML", "INTRADAY": "MIS"}.get(pt)
