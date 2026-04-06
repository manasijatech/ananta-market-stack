from __future__ import annotations

from broker.kotak.http_api import KotakHTTP


def limits(http: KotakHTTP) -> dict:
    return http.trade_get("/quick/user/limits")
