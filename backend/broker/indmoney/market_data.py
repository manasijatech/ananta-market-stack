from __future__ import annotations

from typing import Any

from broker.indmoney.http_api import IndmoneyHTTP


def fetch_quotes(http: IndmoneyHTTP, instruments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for inst in instruments:
        scrip = inst.get("indmoney_scrip_code")
        if not scrip:
            continue
        raw = http.request("GET", "/market/quotes/ltp", {"scrip-codes": scrip}, None)
        block = (raw.get("data") or {}).get(scrip) or {}
        lp = block.get("live_price") or block.get("ltp") or 0
        out.append(
            {
                "symbol": inst.get("symbol") or scrip,
                "indmoney_scrip_code": scrip,
                "ltp": float(lp or 0),
                "raw": block,
            }
        )
    return out
