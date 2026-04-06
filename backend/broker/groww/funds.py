from __future__ import annotations

from broker.groww.http_api import GrowwHTTP


def margins_user(http: GrowwHTTP) -> dict:
    return http.get("/v1/margins/detail/user", {})
