from __future__ import annotations

from broker.core.http import get_httpx_client
from broker.upstox.http_api import UpstoxHTTP


def get_funds_and_margin(http: UpstoxHTTP) -> dict:
    client = get_httpx_client()
    r = client.get(
        "https://api.upstox.com/v2/user/get-funds-and-margin",
        headers={
            "Authorization": f"Bearer {http.access_token}",
            "Accept": "application/json",
        },
    )
    try:
        return r.json()
    except Exception:
        return {"status": "error", "message": r.text[:500]}
