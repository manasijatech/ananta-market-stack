from __future__ import annotations

import gzip
import json
import urllib.parse
from typing import Any

from broker.core.data_features import ohlc_from_quotes
from broker.core.http import get_httpx_client
from broker.core.instruments import InstrumentResolver
from broker.upstox.http_api import UpstoxHTTP


def fetch_quotes(_http: UpstoxHTTP, instruments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    keys: list[str] = []
    for inst in instruments:
        k = inst.get("upstox_instrument_key")
        if k:
            keys.append(k)
    if not keys:
        return []
    parts = "&".join(
        f"instrument_key={urllib.parse.quote(k, safe='|')}" for k in keys
    )
    client = get_httpx_client()
    r = client.get(
        f"https://api.upstox.com/v2/market-quote/quotes?{parts}",
        headers={
            "Authorization": f"Bearer {_http.access_token}",
            "Accept": "application/json",
        },
    )
    j = r.json()
    if r.status_code != 200:
        raise RuntimeError(str(j))
    data = j.get("data") or {}
    out: list[dict[str, Any]] = []
    for k in keys:
        row = data.get(k) or {}
        out.append(
            {
                "symbol": k,
                "upstox_instrument_key": k,
                "ltp": float(row.get("last_price") or 0),
                "raw": row,
            }
        )
    return out


def sync_instruments(_http: UpstoxHTTP) -> list[dict[str, Any]]:
    response = get_httpx_client().get(
        "https://assets.upstox.com/market-quote/instruments/exchange/complete.json.gz"
    )
    response.raise_for_status()
    payload = json.loads(gzip.decompress(response.content).decode("utf-8"))
    rows: list[dict[str, Any]] = []
    for item in payload:
        rows.append(
            {
                "symbol": item.get("trading_symbol") or item.get("name") or "",
                "exchange": item.get("exchange"),
                "segment": item.get("segment"),
                "trading_symbol": item.get("trading_symbol"),
                "name": item.get("name"),
                "isin": item.get("isin"),
                "instrument_type": item.get("instrument_type"),
                "expiry": item.get("expiry"),
                "strike": item.get("strike_price"),
                "option_type": item.get("instrument_type") if item.get("instrument_type") in {"CE", "PE"} else None,
                "lot_size": item.get("lot_size"),
                "tick_size": item.get("tick_size"),
                "upstox_instrument_key": item.get("instrument_key"),
                "zerodha_instrument_token": item.get("exchange_token"),
                "native_payload": {"underlying_key": item.get("underlying_key")},
                "raw_payload": item,
            }
        )
    return rows


def fetch_ohlc(http: UpstoxHTTP, instruments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    keys = [inst.get("upstox_instrument_key") for inst in instruments if inst.get("upstox_instrument_key")]
    if not keys:
        return []
    parts = ",".join(urllib.parse.quote(str(key), safe="|") for key in keys)
    response = get_httpx_client().get(
        f"https://api.upstox.com/v3/market-quote/ohlc?instrument_key={parts}&interval=1d",
        headers={
            "Authorization": f"Bearer {http.access_token}",
            "Accept": "application/json",
        },
    )
    payload = response.json()
    data = payload.get("data") or {}
    out: list[dict[str, Any]] = []
    for key in keys:
        row = data.get(key) or {}
        live_ohlc = row.get("live_ohlc") or {}
        out.append(
            {
                "symbol": key,
                "upstox_instrument_key": key,
                "ltp": float(row.get("last_price") or 0),
                "raw": row,
                "open": live_ohlc.get("open"),
                "high": live_ohlc.get("high"),
                "low": live_ohlc.get("low"),
                "close": live_ohlc.get("close"),
            }
        )
    return out if out else ohlc_from_quotes(fetch_quotes(http, instruments))


def fetch_historical(
    http: UpstoxHTTP,
    request: dict[str, Any],
    resolver: InstrumentResolver,
) -> dict[str, Any]:
    instrument = request.get("instrument") or {}
    key = instrument.get("upstox_instrument_key") or resolver.upstox_instrument_key(
        instrument.get("symbol", ""),
        instrument.get("exchange", ""),
    )
    if not key:
        return {"status": "error", "message": "upstox_instrument_key required"}
    interval = str(request.get("interval") or "day")
    from_date = str(request["from_date"])[:10]
    to_date = str(request["to_date"])[:10]
    headers = {
        "Authorization": f"Bearer {http.access_token}",
        "Accept": "application/json",
    }
    if interval in {"1minute", "30minute", "day", "week", "month"}:
        path = f"https://api.upstox.com/v2/historical-candle/{urllib.parse.quote(str(key), safe='|')}/{interval}/{to_date}/{from_date}"
    else:
        unit = "days"
        count = "1"
        normalized = interval.lower()
        if normalized.endswith("minute"):
            unit = "minutes"
            count = normalized.replace("minute", "") or "1"
        elif normalized.endswith("hour"):
            unit = "hours"
            count = normalized.replace("hour", "") or "1"
        elif normalized in {"week", "weeks"}:
            unit = "weeks"
        elif normalized in {"month", "months"}:
            unit = "months"
        path = f"https://api.upstox.com/v3/historical-candle/{urllib.parse.quote(str(key), safe='|')}/{unit}/{count}/{to_date}/{from_date}"
    return get_httpx_client().get(path, headers=headers).json()


def stream_capabilities() -> dict[str, Any]:
    return {
        "websocket_enabled": True,
        "guidance": "Upstox exposes Market Data Feed websocket APIs. Market Stack websocket v1 keeps a uniform test surface.",
    }
