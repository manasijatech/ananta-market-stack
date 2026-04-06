from __future__ import annotations

from broker.core.http import get_httpx_client
from broker.zerodha.http_api import ZerodhaHTTP


def get_margins(http: ZerodhaHTTP) -> dict:
    client = get_httpx_client()
    headers = {
        "X-Kite-Version": "3",
        "Authorization": f"token {http.api_key}:{http.access_token}",
    }
    r = client.get("https://api.kite.trade/user/margins", headers=headers)
    try:
        return r.json()
    except Exception:
        return {"status": "error", "message": r.text[:500]}
