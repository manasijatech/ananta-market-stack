from __future__ import annotations

import json
from typing import Any

import httpx

from broker.core.http import get_httpx_client
from broker.core.logging_util import get_logger

logger = get_logger(__name__)

BASE = "https://api.kite.trade"


class ZerodhaHTTP:
    def __init__(self, api_key: str, access_token: str) -> None:
        self.api_key = api_key
        self.access_token = access_token

    def _headers(self, content_json: bool = False) -> dict[str, str]:
        h = {
            "X-Kite-Version": "3",
            "Authorization": f"token {self.api_key}:{self.access_token}",
        }
        if content_json:
            h["Content-Type"] = "application/json"
        return h

    def request(
        self,
        method: str,
        endpoint: str,
        *,
        json_body: Any = None,
        content: str | None = None,
        params: dict | None = None,
    ) -> dict[str, Any]:
        url = f"{BASE}{endpoint}"
        client = get_httpx_client()
        headers = self._headers(content_json=json_body is not None and content is None)
        if content is not None:
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        try:
            r = client.request(
                method.upper(),
                url,
                headers=headers,
                json=json_body,
                content=content,
                params=params,
            )
            data = r.json()
        except json.JSONDecodeError:
            return {"status": "error", "message": "invalid json", "raw": r.text[:500]}
        except httpx.HTTPError as e:
            logger.exception("zerodha http %s", endpoint)
            return {"status": "error", "message": str(e)}
        if data.get("status") == "error":
            return data
        return data
