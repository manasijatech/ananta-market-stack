from __future__ import annotations

import json
from typing import Any

import httpx

from broker.core.http import get_httpx_client
from broker.core.logging_util import get_logger

logger = get_logger(__name__)
BASE = "https://api.upstox.com"


class UpstoxHTTP:
    def __init__(self, access_token: str) -> None:
        self.access_token = access_token

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    def json_call(self, method: str, path: str, payload: str | None = None) -> dict[str, Any]:
        url = f"{BASE}{path}"
        client = get_httpx_client()
        try:
            if method == "GET":
                r = client.get(url, headers=self._headers())
            elif method == "POST":
                r = client.post(url, headers=self._headers(), content=payload or "")
            elif method == "PUT":
                r = client.put(url, headers=self._headers(), content=payload or "")
            elif method == "DELETE":
                r = client.delete(url, headers=self._headers())
            else:
                return {"status": "error", "message": f"bad method {method}"}
            return r.json()
        except httpx.HTTPStatusError as e:
            try:
                return e.response.json()
            except Exception:
                return {"status": "error", "message": e.response.text[:500]}
        except Exception as e:
            logger.exception("upstox %s", path)
            return {"status": "error", "message": str(e)}
