from __future__ import annotations

from broker.angel.http_api import AngelHTTP


def get_rms(http: AngelHTTP) -> dict:
    return http.request("GET", "/rest/secure/angelbroking/user/v1/getRMS")
