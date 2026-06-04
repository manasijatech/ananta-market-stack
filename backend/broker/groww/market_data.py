from __future__ import annotations

import csv
from datetime import datetime, timedelta, timezone
from io import StringIO
from typing import Any

from common.datetime_compat import UTC
from broker.core.data_features import ohlc_from_quotes, unsupported_operation
from broker.core.http import get_httpx_client
from broker.core.instruments import InstrumentResolver
from broker.groww.http_api import GrowwHTTP
from broker.groww.mapping import map_exchange, map_segment

IST = timezone(timedelta(hours=5, minutes=30))

_HISTORICAL_INTERVALS = {
    "minute": "1minute",
    "1minute": "1minute",
    "2minute": "2minute",
    "3minute": "3minute",
    "5minute": "5minute",
    "10minute": "10minute",
    "15minute": "15minute",
    "30minute": "30minute",
    "hour": "1hour",
    "1hour": "1hour",
    "4hour": "4hour",
    "day": "1day",
    "1day": "1day",
    "week": "1week",
    "1week": "1week",
    "month": "1month",
    "1month": "1month",
}


_LTP_BATCH_SIZE = 50


def _groww_historical_interval(value: Any) -> str:
    normalized = str(value or "1day").strip().lower().replace(" ", "")
    return _HISTORICAL_INTERVALS.get(normalized, normalized or "1day")


def _groww_time(value: Any) -> str:
    if isinstance(value, datetime):
        dt = value
    else:
        raw = str(value or "").strip()
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00")) if raw else datetime.now(tz=UTC)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(IST).strftime("%Y-%m-%d %H:%M:%S")


def _quote_request(inst: dict[str, Any], resolver: InstrumentResolver) -> dict[str, str]:
    exchange = str(inst.get("groww_exchange") or map_exchange(inst.get("exchange", "NSE")))
    segment = str(inst.get("groww_segment") or map_segment(inst.get("exchange", "NSE")))
    trading_symbol = str(
        inst.get("groww_trading_symbol")
        or resolver.broker_symbol(inst.get("symbol", ""), inst.get("exchange", "NSE"))
    )
    return {"exchange": exchange, "segment": segment, "trading_symbol": trading_symbol}


def _quote_row(
    *,
    symbol: str,
    exchange: str,
    ltp: Any,
    raw: dict[str, Any],
) -> dict[str, Any]:
    return {
        "symbol": symbol,
        "exchange": exchange,
        "ltp": float(ltp or 0),
        "raw": raw,
    }


def _fetch_ltp_batches(
    http: GrowwHTTP,
    requests: list[dict[str, str]],
) -> list[dict[str, Any] | None]:
    out: list[dict[str, Any] | None] = [None] * len(requests)
    grouped: dict[str, list[tuple[int, dict[str, str]]]] = {}
    for index, request in enumerate(requests):
        grouped.setdefault(request["segment"], []).append((index, request))

    for segment, items in grouped.items():
        for start in range(0, len(items), _LTP_BATCH_SIZE):
            chunk = items[start : start + _LTP_BATCH_SIZE]
            exchange_symbols = ",".join(
                f"{item['exchange']}_{item['trading_symbol']}"
                for _, item in chunk
            )
            response = http.get(
                "/v1/live-data/ltp",
                {"segment": segment, "exchange_symbols": exchange_symbols},
            )
            payload = response.get("payload") if response.get("status") == "SUCCESS" else None
            if not isinstance(payload, dict):
                for index, item in chunk:
                    out[index] = _quote_row(
                        symbol=item["trading_symbol"],
                        exchange=item["exchange"],
                        ltp=0,
                        raw=response,
                    )
                continue
            for index, item in chunk:
                key = f"{item['exchange']}_{item['trading_symbol']}"
                out[index] = _quote_row(
                    symbol=item["trading_symbol"],
                    exchange=item["exchange"],
                    ltp=payload.get(key, 0),
                    raw={"status": "SUCCESS", "payload": payload, "source": "ltp", "key": key},
                )
    return out


def fetch_quotes(
    http: GrowwHTTP, instruments: list[dict[str, Any]], resolver: InstrumentResolver
) -> list[dict[str, Any]]:
    requests = [_quote_request(inst, resolver) for inst in instruments]
    if len(requests) > 1:
        return [row for row in _fetch_ltp_batches(http, requests) if row is not None]

    out: list[dict[str, Any]] = []
    for request in requests:
        ex = request["exchange"]
        seg = request["segment"]
        tsym = request["trading_symbol"]
        r = http.get(
            "/v1/live-data/quote",
            {"exchange": ex, "segment": seg, "trading_symbol": tsym},
        )
        payload = r
        if r.get("status") == "SUCCESS" and isinstance(r.get("payload"), dict):
            payload = r["payload"]
        lp = payload.get("last_price", 0) if isinstance(payload, dict) else 0
        if not lp:
            ltp_rows = _fetch_ltp_batches(http, [request])
            if ltp_rows and ltp_rows[0] is not None:
                out.append(ltp_rows[0])
                continue
        out.append(_quote_row(symbol=tsym, exchange=ex, ltp=lp, raw=payload if isinstance(payload, dict) else r))
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
                "exchange_token": item.get("exchange_token") or item.get("Exchange Token"),
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
                "groww_exchange_token": item.get("exchange_token") or item.get("Exchange Token"),
                "native_payload": {
                    "groww_symbol": groww_symbol,
                    "exchange_token": item.get("exchange_token") or item.get("Exchange Token"),
                },
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
    response = http.get(
        "/v1/historical/candles",
        {
            "exchange": exchange,
            "segment": segment,
            "groww_symbol": symbol,
            "start_time": _groww_time(request["from_date"]),
            "end_time": _groww_time(request["to_date"]),
            "candle_interval": _groww_historical_interval(request.get("interval")),
        },
    )
    error = response.get("error")
    if isinstance(error, dict) and str(error.get("code") or "") == "403":
        metadata = error.get("metadata")
        if not isinstance(metadata, dict):
            metadata = {}
        metadata.setdefault(
            "hint",
            "Groww historical/backtesting access is forbidden for this token. The request shape matches the current Groww backtesting API, so check whether historical data access is enabled on the Groww API subscription for this account.",
        )
        error["metadata"] = metadata
    return response


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
        "guidance": "Groww supports live data APIs. Ananta Market Stack websocket v1 polls the read-only data endpoints for testing.",
    }
