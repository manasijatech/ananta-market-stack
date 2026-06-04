from __future__ import annotations

import csv
from io import StringIO
from typing import Any

from broker.core.data_features import ohlc_from_quotes
from broker.core.http import get_httpx_client
from broker.core.instruments import InstrumentResolver
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


def sync_instruments(http: ZerodhaHTTP) -> list[dict[str, Any]]:
    response = get_httpx_client().get(
        "https://api.kite.trade/instruments",
        headers={
            "X-Kite-Version": "3",
            "Authorization": f"token {http.api_key}:{http.access_token}",
        },
    )
    response.raise_for_status()
    rows: list[dict[str, Any]] = []
    for item in csv.DictReader(StringIO(response.text)):
        rows.append(
            {
                "symbol": item.get("tradingsymbol") or "",
                "exchange": item.get("exchange"),
                "segment": item.get("segment"),
                "trading_symbol": item.get("tradingsymbol"),
                "name": item.get("name"),
                "isin": item.get("isin"),
                "instrument_type": item.get("instrument_type"),
                "expiry": item.get("expiry"),
                "strike": item.get("strike"),
                "lot_size": item.get("lot_size"),
                "tick_size": item.get("tick_size"),
                "zerodha_instrument_token": item.get("instrument_token"),
                "native_payload": {"exchange_token": item.get("exchange_token")},
                "raw_payload": item,
            }
        )
    return rows


def fetch_ohlc(http: ZerodhaHTTP, instruments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return ohlc_from_quotes(fetch_quotes(http, instruments))


def fetch_historical(
    http: ZerodhaHTTP,
    request: dict[str, Any],
    resolver: InstrumentResolver,
) -> dict[str, Any]:
    instrument = request.get("instrument") or {}
    token = instrument.get("zerodha_instrument_token")
    if token is None:
        token = resolver.instrument_token(
            instrument.get("symbol", ""),
            instrument.get("exchange", ""),
        )
    if token is None:
        return {"status": "error", "message": "zerodha_instrument_token required"}
    interval = request.get("interval", "day")
    from_date = str(request["from_date"]).replace("+00:00", "Z")
    to_date = str(request["to_date"]).replace("+00:00", "Z")
    path = (
        f"/instruments/historical/{int(token)}/{interval}"
        f"?from={from_date}&to={to_date}&continuous=0&oi=1"
    )
    return http.request("GET", path)


def stream_capabilities() -> dict[str, Any]:
    return {
        "websocket_enabled": True,
        "guidance": "Zerodha supports Kite ticker websocket feeds. Ananta Market Stack websocket v1 is a read-only inspection layer.",
    }
