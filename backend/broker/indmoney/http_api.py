from __future__ import annotations

import json
from typing import Any

from broker.core.http import get_httpx_client

BASE = "https://api.indstocks.com"


class IndmoneyHTTP:
    def __init__(self, access_token: str) -> None:
        self.access_token = access_token

    def request(
        self, method: str, path: str, params: dict | None = None, json_body: Any = None
    ) -> dict[str, Any]:
        url = f"{BASE}{path}"
        h = {
            "Authorization": self.access_token,
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        c = get_httpx_client()
        if method == "GET":
            r = c.get(url, headers=h, params=params)
        elif method == "POST":
            r = c.post(url, headers=h, json=json_body, params=params)
        else:
            r = c.request(method, url, headers=h, json=json_body, params=params)
        try:
            return r.json()
        except json.JSONDecodeError:
            return {"status": "error", "message": r.text[:500]}
