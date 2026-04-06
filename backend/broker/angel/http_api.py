from __future__ import annotations

import json
import time
from typing import Any

from broker.core.http import get_httpx_client

BASE = "https://apiconnect.angelone.in"


class AngelHTTP:
    def __init__(self, api_key: str, jwt_token: str) -> None:
        self.api_key = api_key
        self.jwt_token = jwt_token

    def headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.jwt_token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-UserType": "USER",
            "X-SourceID": "WEB",
            "X-ClientLocalIP": "127.0.0.1",
            "X-ClientPublicIP": "127.0.0.1",
            "X-MACAddress": "00:00:00:00:00:00",
            "X-PrivateKey": self.api_key,
        }

    def request(
        self, method: str, path: str, payload: str | None = None, retries: int = 2
    ) -> dict[str, Any]:
        url = f"{BASE}{path}"
        client = get_httpx_client()
        for attempt in range(retries + 1):
            try:
                if method == "GET":
                    r = client.get(url, headers=self.headers())
                else:
                    r = client.post(url, headers=self.headers(), content=payload or "")
                if not r.text:
                    time.sleep(1)
                    continue
                return json.loads(r.text)
            except json.JSONDecodeError:
                if "exceeding access rate" in r.text.lower() and attempt < retries:
                    time.sleep(1)
                    continue
                return {"status": False, "message": r.text[:300]}
            except Exception as e:
                return {"status": False, "message": str(e)}
        return {"status": False, "message": "max retries"}
