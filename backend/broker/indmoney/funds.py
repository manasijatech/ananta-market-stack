from __future__ import annotations

from broker.indmoney.http_api import IndmoneyHTTP


def user_profile(http: IndmoneyHTTP) -> dict:
    return http.request("GET", "/user/profile", None, None)


def funds(http: IndmoneyHTTP) -> dict:
    return http.request("GET", "/funds", None, None)
