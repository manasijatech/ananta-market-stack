from __future__ import annotations

from typing import Any

from broker.core.instruments import InstrumentResolver
from broker.groww.http_api import GrowwHTTP
from broker.groww.mapping import map_exchange, map_segment


def fetch_quotes(
    http: GrowwHTTP, instruments: list[dict[str, Any]], resolver: InstrumentResolver
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for inst in instruments:
        ex = inst.get("groww_exchange") or map_exchange(inst.get("exchange", "NSE"))
        seg = inst.get("groww_segment") or map_segment(inst.get("exchange", "NSE"))
        tsym = inst.get("groww_trading_symbol") or resolver.broker_symbol(
            inst.get("symbol", ""), inst.get("exchange", "NSE")
        )
        r = http.get(
            "/v1/live-data/quote",
            {"exchange": ex, "segment": seg, "trading_symbol": tsym},
        )
        payload = r
        if r.get("status") == "SUCCESS" and isinstance(r.get("payload"), dict):
            payload = r["payload"]
        lp = payload.get("last_price", 0) if isinstance(payload, dict) else 0
        out.append(
            {
                "symbol": tsym,
                "exchange": ex,
                "ltp": float(lp or 0),
                "raw": payload if isinstance(payload, dict) else r,
            }
        )
    return out
