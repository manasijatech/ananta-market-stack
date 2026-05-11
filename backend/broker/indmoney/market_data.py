from __future__ import annotations

from typing import Any

from broker.core.data_features import ohlc_from_quotes, unsupported_operation
from broker.core.instruments import InstrumentResolver
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


def sync_instruments(_http: IndmoneyHTTP) -> list[dict[str, Any]]:
    return []


def fetch_ohlc(http: IndmoneyHTTP, instruments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return ohlc_from_quotes(fetch_quotes(http, instruments))


def fetch_historical(
    http: IndmoneyHTTP,
    request: dict[str, Any],
    resolver: InstrumentResolver,
) -> dict[str, Any]:
    instrument = request.get("instrument") or {}
    scrip = instrument.get("indmoney_scrip_code")
    if not scrip and instrument.get("symbol"):
        _ = resolver
    if not scrip:
        return unsupported_operation("indmoney", "historical requires indmoney_scrip_code")
    return http.request(
        "GET",
        "/market/history/candles",
        {
            "scrip-code": scrip,
            "interval": request.get("interval", "day"),
            "from": str(request["from_date"]),
            "to": str(request["to_date"]),
        },
        None,
    )


def stream_capabilities() -> dict[str, Any]:
    return {
        "websocket_enabled": False,
        "guidance": "INDmoney websocket support is not wired in this repo yet. Use read-only polling via the test websocket layer.",
    }
