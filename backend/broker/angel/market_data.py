from __future__ import annotations

import json
from typing import Any

from broker.core.data_features import ohlc_from_quotes
from broker.core.http import get_httpx_client
from broker.core.instruments import InstrumentResolver
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


def sync_instruments(_http: AngelHTTP) -> list[dict[str, Any]]:
    response = get_httpx_client().get(
        "https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json"
    )
    response.raise_for_status()
    payload = response.json()
    rows: list[dict[str, Any]] = []
    for item in payload:
        rows.append(
            {
                "symbol": item.get("symbol") or item.get("name") or "",
                "exchange": item.get("exch_seg"),
                "segment": item.get("exch_seg"),
                "trading_symbol": item.get("symbol"),
                "name": item.get("name"),
                "instrument_type": item.get("instrumenttype"),
                "expiry": item.get("expiry"),
                "strike": item.get("strike"),
                "lot_size": item.get("lotsize"),
                "tick_size": item.get("tick_size"),
                "angel_token": item.get("token"),
                "raw_payload": item,
            }
        )
    return rows


def fetch_ohlc(http: AngelHTTP, instruments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return ohlc_from_quotes(fetch_quotes(http, instruments))


def fetch_historical(
    http: AngelHTTP,
    request: dict[str, Any],
    resolver: InstrumentResolver,
) -> dict[str, Any]:
    instrument = request.get("instrument") or {}
    token = instrument.get("angel_token") or resolver.angel_token(
        instrument.get("symbol", ""),
        instrument.get("exchange", ""),
    )
    exchange = instrument.get("angel_exchange") or instrument.get("exchange")
    if not token or not exchange:
        return {"status": False, "message": "angel token and exchange required"}
    payload = {
        "exchange": exchange,
        "symboltoken": str(token),
        "interval": request.get("interval", "ONE_MINUTE").upper(),
        "fromdate": str(request["from_date"])[:16].replace("T", " "),
        "todate": str(request["to_date"])[:16].replace("T", " "),
    }
    return http.request(
        "POST",
        "/rest/secure/angelbroking/historical/v1/getCandleData",
        json.dumps(payload),
    )


def stream_capabilities() -> dict[str, Any]:
    return {
        "websocket_enabled": True,
        "guidance": "Angel SmartAPI supports SmartWebSocket feeds. Market Stack websocket v1 uses a broker-uniform inspection layer.",
    }
