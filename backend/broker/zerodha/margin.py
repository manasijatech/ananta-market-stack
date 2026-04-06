from __future__ import annotations

import json
from typing import Any

from broker.core.http import get_httpx_client
from broker.core.instruments import InstrumentResolver
from broker.zerodha.http_api import ZerodhaHTTP
from broker.zerodha.margin_map import parse_margin_response, transform_margin_positions


def calculate_margin(
    http: ZerodhaHTTP, positions: list[dict[str, Any]], resolver: InstrumentResolver
) -> dict[str, Any]:
    transformed = transform_margin_positions(positions, resolver)
    if not transformed:
        return {"status": "error", "message": "no valid margin legs"}
    headers = {
        "X-Kite-Version": "3",
        "Authorization": f"token {http.api_key}:{http.access_token}",
        "Content-Type": "application/json",
    }
    client = get_httpx_client()
    if len(transformed) > 1:
        url = "https://api.kite.trade/margins/basket?consider_positions=true"
    else:
        url = "https://api.kite.trade/margins/orders"
    r = client.post(url, headers=headers, json=transformed)
    try:
        body = r.json()
    except json.JSONDecodeError:
        return {"status": "error", "message": r.text[:500]}
    return parse_margin_response(body)
