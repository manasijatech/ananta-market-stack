from __future__ import annotations

import csv
from io import StringIO
from typing import Any

from broker.core.data_features import ohlc_from_quotes, unsupported_operation
from broker.core.http import get_httpx_client
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


def sync_instruments(_http: GrowwHTTP) -> list[dict[str, Any]]:
    response = get_httpx_client().get("https://growwapi-assets.groww.in/instruments/instrument.csv")
    response.raise_for_status()
    rows: list[dict[str, Any]] = []
    for item in csv.DictReader(StringIO(response.text)):
        exchange = item.get("exchange") or item.get("Exchange")
        segment = item.get("segment") or item.get("Segment")
        trading_symbol = item.get("trading_symbol") or item.get("Trading Symbol")
        groww_symbol = item.get("groww_symbol") or item.get("Groww Symbol")
        rows.append(
            {
                "symbol": trading_symbol or groww_symbol or item.get("symbol") or "",
                "exchange": exchange,
                "segment": segment,
                "trading_symbol": trading_symbol,
                "name": item.get("company_name") or item.get("name"),
                "isin": item.get("isin"),
                "instrument_type": item.get("instrument_type"),
                "expiry": item.get("expiry"),
                "strike": item.get("strike_price") or item.get("strike"),
                "option_type": item.get("option_type"),
                "lot_size": item.get("lot_size"),
                "tick_size": item.get("tick_size"),
                "groww_exchange": exchange,
                "groww_segment": segment,
                "groww_trading_symbol": trading_symbol,
                "native_payload": {"groww_symbol": groww_symbol},
                "raw_payload": item,
            }
        )
    return rows


def fetch_ohlc(
    http: GrowwHTTP, instruments: list[dict[str, Any]], resolver: InstrumentResolver
) -> list[dict[str, Any]]:
    return ohlc_from_quotes(fetch_quotes(http, instruments, resolver))


def fetch_historical(
    http: GrowwHTTP,
    request: dict[str, Any],
    resolver: InstrumentResolver,
) -> dict[str, Any]:
    instrument = request.get("instrument") or {}
    exchange = instrument.get("groww_exchange") or map_exchange(instrument.get("exchange", "NSE"))
    segment = instrument.get("groww_segment") or map_segment(instrument.get("exchange", "NSE"))
    symbol = instrument.get("groww_symbol") or instrument.get("groww_trading_symbol")
    if not symbol:
        trading_symbol = instrument.get("groww_trading_symbol") or resolver.broker_symbol(
            instrument.get("symbol", ""), instrument.get("exchange", "NSE")
        )
        symbol = f"{exchange}-{trading_symbol}" if segment == "CASH" else trading_symbol
    return http.get(
        "/v1/historical/candles",
        {
            "exchange": exchange,
            "segment": segment,
            "groww_symbol": symbol,
            "start_time": request["from_date"],
            "end_time": request["to_date"],
            "candle_interval": request["interval"],
        },
    )


def fetch_option_chain(http: GrowwHTTP, request: dict[str, Any]) -> dict[str, Any]:
    exchange = request.get("exchange", "NSE")
    underlying = request.get("symbol")
    expiry = request.get("expiry")
    if not underlying or not expiry:
        return unsupported_operation("groww", "option_chain requires symbol and expiry")
    return http.get(
        f"/v1/option-chain/exchange/{exchange}/underlying/{underlying}",
        {"expiry_date": expiry},
    )


def fetch_greeks(http: GrowwHTTP, request: dict[str, Any]) -> dict[str, Any]:
    payload = fetch_option_chain(http, request)
    if payload.get("status") != "SUCCESS":
        return payload
    strikes = (payload.get("payload") or {}).get("strikes") or {}
    strike = str(request.get("strike") or "")
    option_type = str(request.get("option_type") or "").upper()
    if strike and option_type and isinstance(strikes, dict):
        contract = ((strikes.get(strike) or {}).get(option_type) or {})
        if contract:
            return {"status": "SUCCESS", "payload": contract.get("greeks") or {}}
    return payload


def stream_capabilities() -> dict[str, Any]:
    return {
        "websocket_enabled": True,
        "guidance": "Groww supports live data APIs. Market Stack websocket v1 polls the read-only data endpoints for testing.",
    }
