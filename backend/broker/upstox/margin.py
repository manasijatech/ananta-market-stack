from __future__ import annotations

import json
from typing import Any

from broker.core.http import get_httpx_client
from broker.core.instruments import InstrumentResolver
from broker.upstox.http_api import UpstoxHTTP
from broker.upstox.margin_map import parse_margin_response, transform_margin_positions


def calculate_margin(
    http: UpstoxHTTP, positions: list[dict[str, Any]], resolver: InstrumentResolver
) -> dict[str, Any]:
    transformed = transform_margin_positions(positions, resolver)
    if not transformed:
        return {"status": "error", "message": "no valid margin legs / instrument_key required"}
    if len(transformed) > 20:
        return {"status": "error", "message": "max 20 instruments"}
    client = get_httpx_client()
    r = client.post(
        "https://api.upstox.com/v2/charges/margin",
        headers={
            "Authorization": f"Bearer {http.access_token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        json={"instruments": transformed},
    )
    try:
        body = r.json()
    except json.JSONDecodeError:
        return {"status": "error", "message": r.text[:500]}
    return parse_margin_response(body)
