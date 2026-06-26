from __future__ import annotations

import json
from typing import Any

from broker.core.http import get_httpx_client

BASE = "https://api.indstocks.com"


class IndmoneyHTTP:
    def __init__(self, access_token: str) -> None:
        self.access_token = access_token

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": self.access_token,
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    def request(
        self, method: str, path: str, params: dict | None = None, json_body: Any = None
    ) -> dict[str, Any]:
        url = f"{BASE}{path}"
        h = self._headers()
        c = get_httpx_client()
        normalized_method = method.upper()
        if normalized_method == "GET" and json_body is None:
            r = c.get(url, headers=h, params=params)
        elif normalized_method == "POST":
            r = c.post(url, headers=h, json=json_body, params=params)
        else:
            r = c.request(normalized_method, url, headers=h, json=json_body, params=params)
        try:
            return r.json()
        except json.JSONDecodeError:
            return {"status": "error", "message": r.text[:500], "http_status": r.status_code}

    def request_text(self, path: str, params: dict | None = None) -> str:
        url = f"{BASE}{path}"
        c = get_httpx_client()
        response = c.get(url, headers=self._headers(), params=params)
        if response.status_code >= 400:
            raise RuntimeError(
                f"INDmoney {path} failed with {response.status_code}: {response.text[:500]}"
            )
        return response.text
