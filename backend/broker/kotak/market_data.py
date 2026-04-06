from __future__ import annotations

import urllib.parse
from typing import Any

from broker.kotak.http_api import KotakHTTP


def fetch_quotes(http: KotakHTTP, instruments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for inst in instruments:
        q = inst.get("kotak_query")
        if not q:
            seg, ps = inst.get("kotak_segment"), inst.get("kotak_psymbol")
            if seg and ps:
                q = f"{seg}|{ps}"
        if not q:
            continue
        enc = urllib.parse.quote(q, safe="|,")
        path = f"/script-details/1.0/quotes/neosymbol/{enc}/all"
        rows = http.quote_get(path)
        ltp = 0.0
        raw: Any = rows
        if isinstance(rows, list) and rows:
            raw = rows[0]
            if isinstance(raw, dict):
                ltp = float(raw.get("ltp") or raw.get("Ltp") or raw.get("lastPrice") or 0)
        out.append({"symbol": q, "ltp": ltp, "raw": raw})
    return out
