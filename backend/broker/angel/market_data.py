from __future__ import annotations

import json
from typing import Any

from broker.angel.http_api import AngelHTTP


def fetch_quotes(http: AngelHTTP, instruments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_ex: dict[str, list[int]] = {}
    meta: list[tuple[str, str, int]] = []
    for inst in instruments:
        ex = inst.get("angel_exchange") or inst.get("exchange")
        tok = inst.get("angel_token")
        if ex is None or tok is None:
            continue
        t = int(tok)
        by_ex.setdefault(ex, []).append(t)
        meta.append((inst.get("symbol") or str(t), ex, t))
    if not by_ex:
        return []
    payload = {"mode": "FULL", "exchangeTokens": by_ex}
    raw = http.request(
        "POST",
        "/rest/secure/angelbroking/market/v1/quote/",
        json.dumps(payload),
    )
    if not raw.get("status"):
        raise RuntimeError(raw.get("message", "angel quote failed"))
    fetched = (raw.get("data") or {}).get("fetched") or []
    by_key = {(q.get("exchange"), int(q.get("symbolToken", 0))): q for q in fetched}
    out: list[dict[str, Any]] = []
    for sym, ex, t in meta:
        q = by_key.get((ex, t)) or {}
        out.append(
            {
                "symbol": sym,
                "exchange": ex,
                "angel_token": t,
                "ltp": float(q.get("ltp", 0)),
                "raw": q,
            }
        )
    return out
