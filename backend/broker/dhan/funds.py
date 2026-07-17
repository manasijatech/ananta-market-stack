from __future__ import annotations

from broker.dhan.http_api import DhanHTTP


def profile(http: DhanHTTP) -> dict:
    return http.request("GET", "/v2/profile")


def fund_limits(http: DhanHTTP) -> dict:
    return http.request("GET", "/v2/fundlimit")
