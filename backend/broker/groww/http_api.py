from __future__ import annotations

import json
from typing import Any

from broker.core.http import get_httpx_client

GROWW_BASE = "https://api.groww.in"


class GrowwHTTP:
    def __init__(self, access_token: str) -> None:
        self.access_token = access_token

    def headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.access_token}",
            "Accept": "application/json",
            "Content-Type": "application/json",
            "X-API-VERSION": "1.0",
        }

    def get(self, path: str, params: dict | None = None) -> dict[str, Any]:
        r = get_httpx_client().get(f"{GROWW_BASE}{path}", headers=self.headers(), params=params)
        try:
            return r.json()
        except json.JSONDecodeError:
            return {"error": r.text[:500]}

    def post(self, path: str, body: dict) -> dict[str, Any]:
        r = get_httpx_client().post(
            f"{GROWW_BASE}{path}", headers=self.headers(), json=body
        )
        try:
            return r.json()
        except json.JSONDecodeError:
            return {"error": r.text[:500]}
