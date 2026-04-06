from __future__ import annotations

from typing import Any

from broker.zerodha.http_api import ZerodhaHTTP


def fetch_quotes(http: ZerodhaHTTP, instruments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    tokens: list[str] = []
    meta: list[dict[str, Any]] = []
    for inst in instruments:
        t = inst.get("zerodha_instrument_token")
        if t is None:
            continue
        tokens.append(str(int(t)))
        meta.append(
            {
                "label": inst.get("symbol") or str(t),
                "exchange": inst.get("exchange"),
                "token": int(t),
            }
        )
    if not tokens:
        return []
    q = "&".join(f"i={x}" for x in tokens)
    data = http.request("GET", f"/quote?{q}")
    if data.get("status") == "error":
        raise RuntimeError(data.get("message", "quote failed"))
    out: list[dict[str, Any]] = []
    payload = data.get("data") or {}
    for m in meta:
        key = str(m["token"])
        row = payload.get(key) or {}
        last = row.get("last_price") or (row.get("ohlc") or {}).get("close")
        out.append(
            {
                "symbol": m["label"],
                "exchange": m.get("exchange"),
                "instrument_token": m["token"],
                "ltp": float(last or 0),
                "raw": row,
            }
        )
    return out
