from __future__ import annotations

import logging
from typing import Any

from broker.core.instruments import InstrumentResolver
from broker.upstox.mapping import map_product_type

logger = logging.getLogger(__name__)


def transform_margin_positions(
    positions: list[dict[str, Any]], resolver: InstrumentResolver
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for position in positions:
        try:
            key = position.get("upstox_instrument_key") or resolver.upstox_instrument_key(
                position["symbol"], position["exchange"]
            )
            if not key or "|" not in str(key):
                logger.warning("skip margin %s: no instrument_key", position.get("symbol"))
                continue
            leg: dict[str, Any] = {
                "instrument_key": str(key).strip(),
                "quantity": int(position["quantity"]),
                "transaction_type": position["action"].upper(),
                "product": map_product_type(position["product"]),
            }
            if position.get("price") and float(position["price"]) > 0:
                leg["price"] = float(position["price"])
            out.append(leg)
        except Exception as e:
            logger.warning("margin leg error %s: %s", position, e)
    return out


def parse_margin_response(response_data: dict[str, Any]) -> dict[str, Any]:
    if not response_data or not isinstance(response_data, dict):
        return {"status": "error", "message": "Invalid response"}
    if response_data.get("status") != "success":
        msg = response_data.get("message", "margin error")
        errs = response_data.get("errors") or []
        if errs and isinstance(errs[0], dict):
            msg = errs[0].get("message", msg)
        return {"status": "error", "message": msg}
    data = response_data.get("data", {})
    return {
        "status": "success",
        "required_margin": data.get("required_margin", 0),
        "final_margin": data.get("final_margin", 0),
        "raw": data,
    }
