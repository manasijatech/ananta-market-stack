from __future__ import annotations

import csv
import json
from io import StringIO
from typing import Any

from broker.core.data_features import ohlc_from_quotes, unsupported_operation
from broker.core.http import get_httpx_client
from broker.core.instruments import InstrumentResolver
from broker.dhan.http_api import DhanHTTP


def fetch_quotes(http: DhanHTTP, instruments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    exchange_securities: dict[str, list[str]] = {}
    order: list[tuple[str, str, str]] = []
    for inst in instruments:
        seg = inst.get("dhan_exchange_segment")
        sid = inst.get("dhan_security_id")
        if not seg or sid is None:
            continue
        sid_s = str(sid)
        exchange_securities.setdefault(seg, []).append(sid_s)
        order.append((seg, sid_s, inst.get("symbol") or f"{seg}:{sid_s}"))
    if not exchange_securities:
        return []
    raw = http.request(
        "POST", "/v2/marketfeed/quote", json.dumps(exchange_securities)
    )
    if raw.get("status") == "failed":
        raise RuntimeError(str(raw))
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
        rows.append(
            {
                "symbol": item.get("SEM_TRADING_SYMBOL") or item.get("SM_SYMBOL_NAME") or "",
                "exchange": item.get("EXCH_ID"),
                "segment": item.get("SEM_EXM_EXCH_ID"),
                "trading_symbol": item.get("SEM_TRADING_SYMBOL"),
                "name": item.get("SM_SYMBOL_NAME"),
                "isin": item.get("SEM_ISIN"),
                "instrument_type": item.get("SEM_INSTRUMENT_NAME"),
                "expiry": item.get("EXPIRY_DATE"),
                "strike": item.get("SEM_STRIKE_PRICE"),
                "option_type": item.get("SEM_OPTION_TYPE"),
                "lot_size": item.get("SEM_LOT_UNITS"),
                "tick_size": item.get("SEM_TICK_SIZE"),
                "dhan_security_id": item.get("SEM_SMST_SECURITY_ID"),
                "dhan_exchange_segment": item.get("SEM_EXM_EXCH_ID"),
                "raw_payload": item,
            }
        )
    return rows


def fetch_ohlc(http: DhanHTTP, instruments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return ohlc_from_quotes(fetch_quotes(http, instruments))


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
    interval = str(request.get("interval") or "day").lower()
    endpoint = "/v2/charts/historical" if interval in {"day", "1day", "daily"} else "/v2/charts/intraday"
    payload = {
        "securityId": str(security_id),
        "exchangeSegment": seg,
        "instrument": instrument.get("instrument_type") or "EQUITY",
        "expiryCode": 0,
        "oi": False,
        "fromDate": str(request["from_date"])[:10],
        "toDate": str(request["to_date"])[:10],
    }
    if endpoint.endswith("intraday"):
        payload["interval"] = interval.replace("minute", "") or "1"
    return http.request("POST", endpoint, json.dumps(payload))


def fetch_option_chain(http: DhanHTTP, request: dict[str, Any]) -> dict[str, Any]:
    security_id = request.get("dhan_security_id")
    segment = request.get("dhan_exchange_segment") or request.get("exchange")
    if not security_id or not segment:
        return unsupported_operation("dhan", "option_chain requires dhan_security_id and dhan_exchange_segment")
    if not request.get("expiry"):
        return http.request(
            "POST",
            "/v2/optionchain/expirylist",
            json.dumps({"UnderlyingScrip": int(security_id), "UnderlyingSeg": segment}),
        )
    return http.request(
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


def stream_capabilities() -> dict[str, Any]:
    return {
        "websocket_enabled": True,
        "guidance": "Dhan market feeds support websocket subscriptions. Market Stack websocket v1 is broker-uniform and read-only.",
    }
