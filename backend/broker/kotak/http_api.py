from __future__ import annotations

import json
from typing import Any

from broker.core.http import get_httpx_client


class KotakHTTP:
    def __init__(self, session_bundle: str | None, portal_access_token: str) -> None:
        self.portal_access_token = portal_access_token
        self.session_token = ""
        self.session_sid = ""
        self.base_url = ""
        if session_bundle and ":::" in session_bundle:
            parts = session_bundle.split(":::")
            if len(parts) == 4:
                self.session_token, self.session_sid, self.base_url, _ = parts
        self.base_url = (self.base_url or "").rstrip("/")

    def trade_headers(self) -> dict[str, str]:
        return {
            "accept": "application/json",
            "Sid": self.session_sid,
            "Auth": self.session_token,
            "neo-fin-key": "neotradeapi",
        }

    def trade_get(self, path: str) -> dict[str, Any]:
        if not self.base_url:
            return {"error": "kotak session not configured"}
        url = f"{self.base_url}{path}"
        r = get_httpx_client().get(url, headers=self.trade_headers())
        try:
            return r.json()
        except json.JSONDecodeError:
            return {"error": r.text[:500]}

    def quote_get(self, path: str) -> Any:
        if not self.base_url:
            return []
        url = f"{self.base_url}{path}"
        r = get_httpx_client().get(
            url,
            headers={
                "Authorization": self.portal_access_token,
                "Content-Type": "application/json",
            },
        )
        try:
            return r.json()
        except json.JSONDecodeError:
            return {"error": r.text[:500]}
