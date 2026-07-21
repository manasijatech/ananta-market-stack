from __future__ import annotations

import csv
import io
from typing import Any
from urllib.parse import quote

from broker.arrow.http_api import ArrowHTTP

VALID_INTERVALS = {
    "min", "3min", "5min", "10min", "15min", "30min", "hour",
    "2hours", "3hours", "4hours", "day", "week", "month",
}


def _exchange_code(raw: dict[str, Any]) -> str | None:
    value = str(raw.get("ExchSeg") or raw.get("Exchange") or "").strip().upper()
    aliases = {
        "NSECM": "NSE",
        "NSEFO": "NFO",
        "NSEIDX": "INDEX",
        "BSECM": "BSE",
        "BSEFO": "BFO",
        "BSEIDX": "INDEX",
        "MCXFO": "MCX",
    }
    return aliases.get(value, value) or None


def _symbol(item: dict[str, Any], resolver: Any) -> tuple[str, str]:
    exchange = str(item.get("exchange") or "NSE").upper()
    symbol = str(item.get("trading_symbol") or item.get("symbol") or "")
    if symbol and resolver:
        symbol = resolver.broker_symbol(symbol, exchange)
    if not symbol:
        raise ValueError("Arrow requests require symbol/trading_symbol")
    return symbol, exchange


def _precision(item: dict[str, Any]) -> int:
    try:
        return max(0, min(int(item.get("price_precision", 2)), 8))
    except (TypeError, ValueError):
        return 2


def _price(value: Any, precision: int) -> float | None:
    if value is None:
        return None
    try:
        return float(value) / (10 ** precision)
    except (TypeError, ValueError):
        return None


def sync_instruments(http: ArrowHTTP) -> list[dict[str, Any]]:
    body = http.request("GET", "/all", group="market_data", raw_text=True)
    reader = csv.DictReader(io.StringIO(body.lstrip("\ufeff")))
    rows: list[dict[str, Any]] = []
    for raw in reader:
        symbol = str(raw.get("Symbol") or raw.get("TradingSymbol") or "").strip()
        trading_symbol = str(raw.get("TradingSymbol") or symbol).strip()
        if not symbol and not trading_symbol:
            continue
        rows.append(
            {
                "exchange": _exchange_code(raw),
                "segment": raw.get("Segment"),
                "symbol": symbol or trading_symbol,
                "trading_symbol": trading_symbol,
                "name": raw.get("FullName") or raw.get("CompanyName"),
                "isin": raw.get("ISIN") or raw.get("Isin"),
                "instrument_type": raw.get("Series") or raw.get("Instrument"),
                "expiry": raw.get("Expiry") or raw.get("ExpiryDate"),
                "strike": raw.get("StrikePrice"),
                "option_type": raw.get("OptionType"),
                "lot_size": raw.get("LotSize"),
                "tick_size": raw.get("TickSize"),
                "price_precision": raw.get("PricePrecision") or "2",
                "arrow_token": raw.get("Token") or raw.get("ExchangeID"),
                "native_payload": raw,
                "raw_payload": raw,
            }
        )
    return rows


def fetch_quotes(http: ArrowHTTP, instruments: list[dict[str, Any]], resolver: Any, *, mode: str = "full") -> list[dict[str, Any]]:
    requested: list[tuple[dict[str, Any], str, str]] = []
    for item in instruments:
        symbol, exchange = _symbol(item, resolver)
        requested.append((item, symbol, exchange))
    if not requested:
        return []
    payload = http.request(
        "POST",
        f"/info/quotes/{mode}",
        group="market_data",
        json=[{"symbol": symbol, "exchange": exchange} for _, symbol, exchange in requested],
    )
    data = ArrowHTTP.data(payload)
    rows = data if isinstance(data, list) else [data] if isinstance(data, dict) else []
    by_token = {str(row.get("token")): row for row in rows if isinstance(row, dict) and row.get("token") is not None}
    output: list[dict[str, Any]] = []
    for index, (item, symbol, exchange) in enumerate(requested):
        token = str(item.get("arrow_token") or "")
        raw = by_token.get(token) or (rows[index] if index < len(rows) and isinstance(rows[index], dict) else {})
        precision = _precision(item)
        normalized = {
            key: _price(raw.get(key), precision)
            for key in ("ltp", "close", "open", "high", "low", "avgPrice", "upperLimit", "lowerLimit")
            if raw.get(key) is not None
        }
        output.append(
            {
                "symbol": str(item.get("symbol") or symbol),
                "ltp": normalized.get("ltp") or 0.0,
                "exchange": exchange,
                "arrow_token": token or str(raw.get("token") or ""),
                "price_precision": precision,
                "ohlc": {k: normalized.get(k) for k in ("open", "high", "low", "close")},
                "raw": raw,
            }
        )
    return output


def fetch_historical(http: ArrowHTTP, request: dict[str, Any], resolver: Any) -> dict[str, Any]:
    instrument = request.get("instrument") or request
    symbol, exchange = _symbol(instrument, resolver)
    token = str(instrument.get("arrow_token") or "")
    if not token and hasattr(resolver, "arrow_token"):
        token = str(resolver.arrow_token(symbol, exchange) or "")
    if not token:
        raise ValueError("Arrow historical data requires arrow_token or a synced instrument")
    interval = str(request.get("interval") or "day")
    if interval not in VALID_INTERVALS:
        raise ValueError(f"unsupported Arrow historical interval: {interval}")
    params = {
        "from": _iso(request.get("from_date") or request.get("from")),
        "to": _iso(request.get("to_date") or request.get("to")),
    }
    if request.get("oi") is not None:
        params["oi"] = "1" if bool(request["oi"]) else "0"
    payload = http.request(
        "GET",
        f"/candle/{quote(exchange)}/{quote(token)}/{quote(interval)}",
        group="historical",
        params=params,
        historical=True,
    )
    raw_candles = ArrowHTTP.data(payload)
    precision = _precision(instrument)
    candles: list[Any] = []
    if isinstance(raw_candles, list):
        for candle in raw_candles:
            if isinstance(candle, list) and len(candle) >= 5:
                normalized = list(candle)
                normalized[1:5] = [(_price(value, precision) or 0.0) for value in candle[1:5]]
                candles.append(normalized)
            else:
                candles.append(candle)
    return {
        "data": candles,
        "raw": payload,
        "symbol": symbol,
        "exchange": exchange,
        "interval": interval,
        "price_precision": precision,
    }


def _iso(value: Any) -> str:
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value or "")


def option_chain(http: ArrowHTTP, request: dict[str, Any]) -> dict[str, Any]:
    body: dict[str, Any] = {
        "exchange": str(request.get("exchange") or "INDEX").upper(),
        "count": str(request.get("count") or 10),
    }
    if request.get("expiry"):
        body["expiry"] = request["expiry"]
    if request.get("instrument_token") or request.get("arrow_token"):
        body["token"] = str(request.get("instrument_token") or request.get("arrow_token"))
    else:
        body["underlying"] = str(request.get("symbol") or request.get("underlying") or "")
    payload = http.request("POST", "/info/option-chain", group="market_data", json=body)
    return {"data": ArrowHTTP.data(payload), "raw": payload}


def greeks(http: ArrowHTTP, request: dict[str, Any], *, enabled: bool) -> dict[str, Any]:
    if not enabled:
        return {"status": "unsupported", "message": "Arrow Greeks are experimental and disabled by configuration."}
    tokens = request.get("instrument_tokens") or request.get("tokens") or []
    if not tokens and request.get("instrument_token"):
        tokens = [request["instrument_token"]]
    payload = http.request("POST", "/info/greeks", group="market_data", json=[str(token) for token in tokens])
    return {"data": ArrowHTTP.data(payload), "raw": payload}


def utility(http: ArrowHTTP, path: str) -> dict[str, Any]:
    payload = http.request("GET", path, group="market_data")
    return {"data": ArrowHTTP.data(payload), "raw": payload}
