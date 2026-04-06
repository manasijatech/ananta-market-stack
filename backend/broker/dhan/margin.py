from __future__ import annotations

import json
from typing import Any

from broker.dhan.http_api import DhanHTTP


def calculate_margin(http: DhanHTTP, order_payload: dict[str, Any]) -> dict[str, Any]:
    """Single-order margin calculator (Dhan batch API shape may differ)."""
    return http.request("POST", "/v2/margincalculator", json.dumps(order_payload))
