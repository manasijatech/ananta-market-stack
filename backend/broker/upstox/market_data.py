from __future__ import annotations

import urllib.parse
from typing import Any

from broker.core.http import get_httpx_client
from broker.upstox.http_api import UpstoxHTTP


def fetch_quotes(_http: UpstoxHTTP, instruments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    keys: list[str] = []
    for inst in instruments:
        k = inst.get("upstox_instrument_key")
        if k:
            keys.append(k)
    if not keys:
        return []
    parts = "&".join(
        f"instrument_key={urllib.parse.quote(k, safe='|')}" for k in keys
    )
    client = get_httpx_client()
    r = client.get(
        f"https://api.upstox.com/v2/market-quote/quotes?{parts}",
        headers={
            "Authorization": f"Bearer {_http.access_token}",
            "Accept": "application/json",
        },
    )
    j = r.json()
    if r.status_code != 200:
        raise RuntimeError(str(j))
    data = j.get("data") or {}
    out: list[dict[str, Any]] = []
    for k in keys:
        row = data.get(k) or {}
        out.append(
            {
                "symbol": k,
                "upstox_instrument_key": k,
                "ltp": float(row.get("last_price") or 0),
                "raw": row,
            }
        )
    return out
