from __future__ import annotations

from broker.dhan.http_api import DhanHTTP


def fund_limits(http: DhanHTTP) -> dict:
    return http.request("GET", "/v2/fundlimit")
