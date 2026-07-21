from __future__ import annotations

import threading
import time
from collections import defaultdict, deque
from typing import Any

import httpx

from broker.core.http import get_httpx_client

ROOT_URL = "https://edge.arrow.trade"
HISTORICAL_URL = "https://historical-api.arrow.trade"
_LIMITERS: dict[tuple[str, str], "RollingLimiter"] = {}
_LIMITERS_LOCK = threading.Lock()


class ArrowAPIError(RuntimeError):
    def __init__(self, message: str, *, status_code: int | None = None, error_code: str | None = None) -> None:
        self.status_code = status_code
        self.error_code = error_code
        prefix = f"Arrow HTTP {status_code}: " if status_code else "Arrow: "
        super().__init__(prefix + message)


class RollingLimiter:
    def __init__(self, limit: int = 10, window_seconds: float = 1.0) -> None:
        self.limit = limit
        self.window = window_seconds
        self._calls: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def wait(self, group: str) -> None:
        while True:
            with self._lock:
                now = time.monotonic()
                calls = self._calls[group]
                while calls and now - calls[0] >= self.window:
                    calls.popleft()
                if len(calls) < self.limit:
                    calls.append(now)
                    return
                delay = max(0.001, self.window - (now - calls[0]))
            time.sleep(delay)


class ArrowHTTP:
    def __init__(self, app_id: str, access_token: str, *, client: httpx.Client | None = None) -> None:
        self.app_id = app_id
        self.access_token = access_token
        self.client = client or get_httpx_client()
        limiter_key = (app_id, access_token)
        with _LIMITERS_LOCK:
            self.limiter = _LIMITERS.setdefault(limiter_key, RollingLimiter())

    @property
    def headers(self) -> dict[str, str]:
        return {"appID": self.app_id, "token": self.access_token, "Accept": "application/json"}

    def request(
        self,
        method: str,
        path: str,
        *,
        group: str,
        json: Any = None,
        params: dict[str, Any] | None = None,
        historical: bool = False,
        raw_text: bool = False,
        retry_read: bool = True,
    ) -> Any:
        base = HISTORICAL_URL if historical else ROOT_URL
        # Call sites explicitly disable this for every execution-affecting
        # request. This also permits bounded retries for read-only POST routes
        # such as quotes, option chains, Greeks, and margin calculation.
        attempts = 2 if retry_read else 1
        last_error: ArrowAPIError | None = None
        for attempt in range(attempts):
            self.limiter.wait(group)
            try:
                response = self.client.request(
                    method,
                    f"{base}{path}",
                    headers=self.headers,
                    json=json,
                    params=params,
                )
            except httpx.HTTPError as exc:
                last_error = ArrowAPIError(str(exc))
                if attempt + 1 < attempts:
                    time.sleep(0.25)
                    continue
                raise last_error from exc
            if response.status_code == 429 and attempt + 1 < attempts:
                delay = min(float(response.headers.get("Retry-After") or 1), 3.0)
                time.sleep(max(delay, 0.05))
                continue
            if response.is_error:
                try:
                    body = response.json()
                except ValueError:
                    body = {}
                message = str(
                    body.get("message")
                    or body.get("error")
                    or body.get("errorMessage")
                    or response.text[:500]
                    or response.reason_phrase
                )
                raise ArrowAPIError(
                    message,
                    status_code=response.status_code,
                    error_code=str(body.get("errorCode") or "") or None,
                )
            if raw_text:
                return response.text
            try:
                payload = response.json()
            except ValueError as exc:
                raise ArrowAPIError("invalid JSON response", status_code=response.status_code) from exc
            if isinstance(payload, dict) and str(payload.get("status") or "").lower() in {
                "error", "failure", "failed"
            }:
                raise ArrowAPIError(
                    str(payload.get("message") or payload.get("error") or "request failed"),
                    status_code=response.status_code,
                    error_code=str(payload.get("errorCode") or "") or None,
                )
            return payload
        if last_error:
            raise last_error
        raise ArrowAPIError("request failed")

    @staticmethod
    def data(payload: Any) -> Any:
        return payload.get("data", payload) if isinstance(payload, dict) else payload
