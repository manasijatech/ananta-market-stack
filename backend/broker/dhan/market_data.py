from __future__ import annotations

import json
from typing import Any

from broker.dhan.http_api import DhanHTTP


def fetch_quotes(http: DhanHTTP, instruments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    exchange_securities: dict[str, list[str]] = {}
    order: list[tuple[str, str, str]] = []
    for inst in instruments:
        seg = inst.get("dhan_exchange_segment")
        sid = inst.get("dhan_security_id")
        if not seg or sid is None:
            continue
        sid_s = str(sid)
        exchange_securities.setdefault(seg, []).append(sid_s)
        order.append((seg, sid_s, inst.get("symbol") or f"{seg}:{sid_s}"))
    if not exchange_securities:
        return []
    raw = http.request(
        "POST", "/v2/marketfeed/quote", json.dumps(exchange_securities)
    )
    if raw.get("status") == "failed":
        raise RuntimeError(str(raw))
    resp_data = raw.get("data") or {}
    out: list[dict[str, Any]] = []
    for seg, sid_s, sym in order:
        row = (resp_data.get(seg) or {}).get(sid_s) or {}
        lp = row.get("last_price") or row.get("lastPrice") or 0
        out.append(
            {
                "symbol": sym,
                "dhan_exchange_segment": seg,
                "dhan_security_id": sid_s,
                "ltp": float(lp or 0),
                "raw": row,
            }
        )
    return out
