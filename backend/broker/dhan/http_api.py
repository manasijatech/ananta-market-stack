from __future__ import annotations

import json
import time
from typing import Any

from broker.core.http import get_httpx_client
from broker.dhan.baseurl import get_url


class DhanHTTP:
    def __init__(self, access_token: str, client_id: str) -> None:
        self.access_token = access_token
        self.client_id = client_id

    def headers(self) -> dict[str, str]:
        return {
            "access-token": self.access_token,
            "client-id": self.client_id,
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    def request(self, method: str, endpoint: str, payload: str | None = None) -> dict[str, Any]:
        time.sleep(1.0)
        url = get_url(endpoint)
        c = get_httpx_client()
        h = self.headers()
        if method == "GET":
            r = c.get(url, headers=h)
        elif method == "POST":
            r = c.post(url, headers=h, content=payload or "")
        elif method == "PUT":
            r = c.put(url, headers=h, content=payload or "")
        elif method == "DELETE":
            r = c.delete(url, headers=h)
        else:
            return {"status": "failed", "message": f"bad method {method}"}
        try:
            return json.loads(r.text) if r.text else {}
        except json.JSONDecodeError:
            return {"status": "failed", "message": r.text[:500]}
