from __future__ import annotations

import logging
from typing import Any

from broker.angel.mapping import _map_order_type as mo
from broker.angel.mapping import _map_product as mp
from broker.core.instruments import InstrumentResolver

logger = logging.getLogger(__name__)


def transform_margin_positions(
    positions: list[dict[str, Any]], resolver: InstrumentResolver
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for position in positions:
        try:
            tok = position.get("symboltoken") or resolver.angel_token(
                position["symbol"], position["exchange"]
            )
            if not tok:
                continue
            tok_s = str(tok).strip()
            if not tok_s.isdigit():
                continue
            out.append(
                {
                    "exchange": position["exchange"],
                    "qty": int(position["quantity"]),
                    "price": float(position.get("price", 0)),
                    "productType": mp(position["product"]),
                    "token": tok_s,
                    "tradeType": position["action"].upper(),
                    "orderType": mo(position.get("pricetype", "MARKET")),
                }
            )
        except Exception as e:
            logger.warning("angel margin skip %s: %s", position, e)
    return out


def parse_margin_response(raw: dict[str, Any]) -> dict[str, Any]:
    if raw.get("status") is False or raw.get("errorcode"):
        return {"status": "error", "message": raw.get("message", "margin error")}
    return {"status": "success", "data": raw.get("data", raw)}
