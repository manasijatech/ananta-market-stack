from __future__ import annotations

import csv
import json
from datetime import datetime, timedelta, timezone
from io import StringIO
from typing import Any

from broker.core.data_features import unsupported_operation
from broker.core.http import get_httpx_client
from broker.core.instruments import InstrumentResolver
from broker.dhan.http_api import DhanHTTP

IST = timezone(timedelta(hours=5, minutes=30))
_INTERVALS = {
    "1": "1",
    "1m": "1",
    "1min": "1",
    "1minute": "1",
    "5": "5",
    "5m": "5",
    "5min": "5",
    "5minute": "5",
    "15": "15",
    "15m": "15",
    "15min": "15",
    "15minute": "15",
    "25": "25",
    "25m": "25",
    "25min": "25",
    "25minute": "25",
    "60": "60",
    "60m": "60",
    "60min": "60",
    "60minute": "60",
    "1h": "60",
    "1hour": "60",
    "hour": "60",
}


def _dhan_exchange_segment(exchange: str, segment: str) -> str | None:
    exchange = exchange.strip().upper()
    segment = segment.strip().upper()
    if segment == "I":
        return "IDX_I"
    if exchange == "NSE":
        return {"E": "NSE_EQ", "D": "NSE_FNO", "C": "NSE_CURRENCY", "M": "NSE_FNO"}.get(segment)
    if exchange == "BSE":
        return {"E": "BSE_EQ", "D": "BSE_FNO", "C": "BSE_CURRENCY"}.get(segment)
    if exchange == "MCX" and segment == "M":
        return "MCX_COMM"
    return None


def _security_id(value: Any) -> int:
    try:
        return int(str(value))
    except (TypeError, ValueError) as exc:
        raise ValueError(f"invalid Dhan security id: {value}") from exc


def _raise_dhan_error(payload: dict[str, Any]) -> None:
    if payload.get("status") in {"failed", "error"} or payload.get("errorType"):
        message = payload.get("errorMessage") or payload.get("message") or payload.get("errorType")
        raise RuntimeError(f"Dhan API error: {message}")


def _marketfeed_request(
    http: DhanHTTP,
    endpoint: str,
    instruments: list[dict[str, Any]],
) -> tuple[dict[str, Any], list[tuple[str, str, str]]]:
    exchange_securities: dict[str, list[int]] = {}
    order: list[tuple[str, str, str]] = []
    for inst in instruments:
        seg = inst.get("dhan_exchange_segment")
        sid = inst.get("dhan_security_id")
        if not seg or sid is None:
            continue
        sid_int = _security_id(sid)
        sid_s = str(sid_int)
        exchange_securities.setdefault(str(seg), []).append(sid_int)
        order.append((str(seg), sid_s, inst.get("symbol") or f"{seg}:{sid_s}"))
    if not exchange_securities:
        return {}, []
    if sum(len(ids) for ids in exchange_securities.values()) > 1000:
        raise ValueError("Dhan market quote APIs accept at most 1000 instruments per request")
    raw = http.request("POST", endpoint, json.dumps(exchange_securities))
    _raise_dhan_error(raw)
    return raw, order


def fetch_quotes(http: DhanHTTP, instruments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    raw, order = _marketfeed_request(http, "/v2/marketfeed/quote", instruments)
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


def sync_instruments(_http: DhanHTTP) -> list[dict[str, Any]]:
    response = get_httpx_client().get("https://images.dhan.co/api-data/api-scrip-master.csv")
    response.raise_for_status()
    rows: list[dict[str, Any]] = []
    for item in csv.DictReader(StringIO(response.text)):
        exchange = (item.get("SEM_EXM_EXCH_ID") or "").strip().upper()
        source_segment = (item.get("SEM_SEGMENT") or "").strip().upper()
        dhan_segment = _dhan_exchange_segment(exchange, source_segment)
        if not dhan_segment:
            continue
        rows.append(
            {
                "symbol": item.get("SEM_TRADING_SYMBOL") or item.get("SM_SYMBOL_NAME") or "",
                "exchange": exchange,
                "segment": source_segment,
                "trading_symbol": item.get("SEM_TRADING_SYMBOL"),
                "name": item.get("SM_SYMBOL_NAME"),
                "isin": None,
                "instrument_type": item.get("SEM_INSTRUMENT_NAME"),
                "expiry": item.get("SEM_EXPIRY_DATE"),
                "strike": item.get("SEM_STRIKE_PRICE"),
                "option_type": item.get("SEM_OPTION_TYPE"),
                "lot_size": item.get("SEM_LOT_UNITS"),
                "tick_size": item.get("SEM_TICK_SIZE"),
                "dhan_security_id": item.get("SEM_SMST_SECURITY_ID"),
                "dhan_exchange_segment": dhan_segment,
                "raw_payload": item,
            }
        )
    return rows


def fetch_ohlc(http: DhanHTTP, instruments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    raw, order = _marketfeed_request(http, "/v2/marketfeed/ohlc", instruments)
    resp_data = raw.get("data") or {}
    out: list[dict[str, Any]] = []
    for seg, sid_s, sym in order:
        row = (resp_data.get(seg) or {}).get(sid_s) or {}
        out.append(
            {
                "symbol": sym,
                "dhan_exchange_segment": seg,
                "dhan_security_id": sid_s,
                "ltp": float(row.get("last_price") or 0),
                "open": float((row.get("ohlc") or {}).get("open") or 0),
                "high": float((row.get("ohlc") or {}).get("high") or 0),
                "low": float((row.get("ohlc") or {}).get("low") or 0),
                "close": float((row.get("ohlc") or {}).get("close") or 0),
                "raw": row,
            }
        )
    return out


def _parse_request_datetime(value: Any) -> datetime:
    if isinstance(value, datetime):
        parsed = value
    else:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=IST)
    return parsed.astimezone(IST)


def fetch_historical(
    http: DhanHTTP,
    request: dict[str, Any],
    resolver: InstrumentResolver,
) -> dict[str, Any]:
    instrument = request.get("instrument") or {}
    seg = instrument.get("dhan_exchange_segment")
    security_id = instrument.get("dhan_security_id")
    if not seg or not security_id:
        seg, security_id = resolver.dhan_security(
            instrument.get("symbol", ""),
            instrument.get("exchange", ""),
        )
    if not seg or not security_id:
        return {"status": "failed", "message": "dhan_security_id and dhan_exchange_segment required"}
    interval = str(request.get("interval") or "day").strip().lower()
    endpoint = "/v2/charts/historical" if interval in {"day", "1day", "daily"} else "/v2/charts/intraday"
    from_date = _parse_request_datetime(request["from_date"])
    to_date = _parse_request_datetime(request["to_date"])
    payload = {
        "securityId": str(security_id),
        "exchangeSegment": seg,
        "instrument": instrument.get("instrument_type") or "EQUITY",
        "expiryCode": 0,
        "oi": False,
        "fromDate": from_date.strftime("%Y-%m-%d"),
        "toDate": to_date.strftime("%Y-%m-%d"),
    }
    if endpoint.endswith("intraday"):
        native_interval = _INTERVALS.get(interval)
        if not native_interval:
            raise ValueError("Dhan intraday interval must be one of 1, 5, 15, 25, or 60 minutes")
        payload["interval"] = native_interval
        payload["fromDate"] = from_date.strftime("%Y-%m-%d %H:%M:%S")
        payload["toDate"] = to_date.strftime("%Y-%m-%d %H:%M:%S")
    response = http.request("POST", endpoint, json.dumps(payload))
    _raise_dhan_error(response)
    return response


def fetch_option_chain(http: DhanHTTP, request: dict[str, Any]) -> dict[str, Any]:
    security_id = request.get("dhan_security_id")
    segment = request.get("dhan_exchange_segment") or request.get("exchange")
    if not security_id or not segment:
        return unsupported_operation("dhan", "option_chain requires dhan_security_id and dhan_exchange_segment")
    if not request.get("expiry"):
        response = http.request(
            "POST",
            "/v2/optionchain/expirylist",
            json.dumps({"UnderlyingScrip": int(security_id), "UnderlyingSeg": segment}),
        )
    else:
        response = http.request(
            "POST",
            "/v2/optionchain",
            json.dumps(
                {
                    "UnderlyingScrip": int(security_id),
                    "UnderlyingSeg": segment,
                    "Expiry": request["expiry"],
                }
            ),
        )
    _raise_dhan_error(response)
    return response


def fetch_greeks(http: DhanHTTP, request: dict[str, Any]) -> dict[str, Any]:
    if not request.get("expiry"):
        return unsupported_operation("dhan", "greeks requires an option-chain expiry")
    response = fetch_option_chain(http, request)
    response["guidance"] = "Dhan supplies option greeks inside each CE/PE option-chain entry."
    return response


def stream_capabilities() -> dict[str, Any]:
    return {
        "websocket_enabled": True,
        "guidance": "Dhan supports a native v2 market-feed websocket. This uniform test stream currently polls Dhan quotes through the shared read-only stream manager.",
    }
