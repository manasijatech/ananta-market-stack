"""Shared httpx client factory (connection reuse)."""

from __future__ import annotations

import httpx

_DEFAULT_TIMEOUT = httpx.Timeout(60.0, connect=15.0)

_client: httpx.Client | None = None


def get_httpx_client() -> httpx.Client:
    global _client
    if _client is None:
        _client = httpx.Client(timeout=_DEFAULT_TIMEOUT)
    return _client
