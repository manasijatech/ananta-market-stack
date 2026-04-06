from __future__ import annotations

import json
from typing import Any

from broker.angel.http_api import AngelHTTP
from broker.angel.margin_map import parse_margin_response, transform_margin_positions
from broker.core.instruments import InstrumentResolver


def calculate_margin(
    http: AngelHTTP, positions: list[dict[str, Any]], resolver: InstrumentResolver
) -> dict[str, Any]:
    legs = transform_margin_positions(positions, resolver)
    if not legs:
        return {"status": "error", "message": "no valid angel margin legs"}
    raw = http.request(
        "POST",
        "/rest/secure/angelbroking/margin/v1/batch",
        json.dumps({"positions": legs}),
    )
    return parse_margin_response(raw)
