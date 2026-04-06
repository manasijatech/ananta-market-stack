"""Margin basket / order payload mapping for Zerodha."""

from __future__ import annotations

import logging
from typing import Any

from broker.core.instruments import InstrumentResolver
from broker.zerodha.mapping import map_product_type as z_map_product

logger = logging.getLogger(__name__)


def _map_order_type(pricetype: str) -> str:
    return {"MARKET": "MARKET", "LIMIT": "LIMIT", "SL": "SL", "SL-M": "SL-M"}.get(
        pricetype, "MARKET"
    )


def transform_margin_positions(
    positions: list[dict[str, Any]], resolver: InstrumentResolver
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for position in positions:
        try:
            symbol = position["symbol"]
            exchange = position["exchange"]
            br = resolver.broker_symbol(symbol, exchange)
            if not br:
                continue
            out.append(
                {
                    "exchange": exchange,
                    "tradingsymbol": str(br).strip(),
                    "transaction_type": position["action"].upper(),
                    "variety": "regular",
                    "product": z_map_product(position["product"]),
                    "order_type": _map_order_type(position.get("pricetype", "MARKET")),
                    "quantity": int(position["quantity"]),
                    "price": float(position.get("price", 0)),
                    "trigger_price": float(position.get("trigger_price", 0)),
                }
            )
        except Exception as e:
            logger.warning("skip margin leg %s: %s", position, e)
    return out


def parse_margin_response(response_data: dict[str, Any]) -> dict[str, Any]:
    """Normalize margin API JSON to a compact summary."""
    if response_data.get("status") == "error":
        return {"status": "error", "message": response_data.get("message", "margin error")}
    return {"status": "success", "data": response_data.get("data", response_data)}
