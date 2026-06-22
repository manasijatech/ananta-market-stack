from __future__ import annotations

import csv
from io import StringIO
from typing import Any

from broker.core.data_features import ohlc_from_quotes, unsupported_operation
from broker.core.instruments import InstrumentResolver
from broker.indmoney.http_api import IndmoneyHTTP

_INSTRUMENT_SOURCES = ("equity", "fno", "index")
_QUOTE_BATCH_SIZE = 100


def _clean_text(value: Any) -> str | None:
    text = str(value or "").strip()
    return text or None


def _normalize_exchange(value: Any) -> str | None:
    exchange = _clean_text(value)
    return exchange.upper() if exchange else None


def _normalize_symbol(value: Any) -> str | None:
    symbol = _clean_text(value)
    return symbol.upper() if symbol else None


def _segment_label(source: str, row: dict[str, Any]) -> str:
    segment = _clean_text(row.get("SEGMENT"))
    if segment:
        return segment.upper()
    return {"equity": "E", "fno": "FNO", "index": "INDEX"}[source]


def _quote_prefix(exchange: Any, segment: Any) -> str | None:
    normalized_exchange = _normalize_exchange(exchange)
    normalized_segment = (_clean_text(segment) or "").upper()
    if normalized_exchange in {"NFO", "BFO", "CDS", "MCX"}:
        return normalized_exchange
    if normalized_segment in {"FNO", "FO", "DERIVATIVE", "DERIVATIVES"}:
        if normalized_exchange == "BSE":
            return "BFO"
        if normalized_exchange == "NSE":
            return "NFO"
    return normalized_exchange


def _normalize_scrip_code(raw_value: Any, *, exchange: Any, segment: Any) -> str | None:
    raw = _clean_text(raw_value)
    if not raw:
        return None
    if "_" in raw:
        prefix, token = raw.split("_", 1)
        normalized_prefix = _clean_text(prefix)
        normalized_token = _clean_text(token)
        if normalized_prefix and normalized_token:
            return f"{normalized_prefix.upper()}_{normalized_token}"
        return raw.upper()
    prefix = _quote_prefix(exchange, segment)
    if not prefix:
        return raw
    return f"{prefix}_{raw}"


def _float_value(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(str(value).replace(",", ""))
    except (TypeError, ValueError):
        return None


def _depth_rows(block: dict[str, Any], scrip: str) -> dict[str, list[dict[str, Any]]]:
    market_depth = block.get("market_depth") if isinstance(block.get("market_depth"), dict) else {}
    depth_block = market_depth.get(scrip) if isinstance(market_depth.get(scrip), dict) else {}
    rows = depth_block.get("depth") if isinstance(depth_block.get("depth"), list) else []
    buy_rows: list[dict[str, Any]] = []
    sell_rows: list[dict[str, Any]] = []
    for item in rows:
        if not isinstance(item, dict):
            continue
        buy = item.get("buy") if isinstance(item.get("buy"), dict) else {}
        sell = item.get("sell") if isinstance(item.get("sell"), dict) else {}
        if buy:
            buy_rows.append(
                {
                    "price": _float_value(buy.get("price")),
                    "quantity": _float_value(buy.get("quantity")),
                }
            )
        if sell:
            sell_rows.append(
                {
                    "price": _float_value(sell.get("price")),
                    "quantity": _float_value(sell.get("quantity")),
                }
            )
    return {"buy": buy_rows, "sell": sell_rows}


def _quote_row_from_block(inst: dict[str, Any], scrip: str, block: dict[str, Any]) -> dict[str, Any]:
    ltp = _float_value(block.get("live_price") or block.get("ltp")) or 0.0
    day_change = _float_value(block.get("day_change"))
    day_change_perc = _float_value(block.get("day_change_percentage") or block.get("day_change_perc"))
    prev_close = _float_value(block.get("prev_close") or block.get("previous_close"))
    day_open = _float_value(block.get("day_open") or block.get("open"))
    day_high = _float_value(block.get("day_high") or block.get("high"))
    day_low = _float_value(block.get("day_low") or block.get("low"))
    volume = _float_value(block.get("volume"))
    raw = {
        **block,
        "live_price": ltp,
        "day_change": day_change,
        "day_change_perc": day_change_perc,
        "day_change_percentage": day_change_perc,
        "volume": volume,
        "upper_circuit_limit": _float_value(block.get("upper_circuit")),
        "lower_circuit_limit": _float_value(block.get("lower_circuit")),
        "week_52_high": _float_value(block.get("52week_high")),
        "week_52_low": _float_value(block.get("52week_low")),
        "ohlc": {
            "open": day_open,
            "high": day_high,
            "low": day_low,
            "close": prev_close,
        },
        "depth": _depth_rows(block, scrip),
    }
    if day_change is None and prev_close not in (None, 0) and ltp:
        raw["day_change"] = round(ltp - prev_close, 2)
    if day_change_perc is None and prev_close not in (None, 0) and ltp:
        raw["day_change_perc"] = round(((ltp - prev_close) / prev_close) * 100, 2)
        raw["day_change_percentage"] = raw["day_change_perc"]
    return {
        "symbol": inst.get("symbol") or scrip,
        "exchange": inst.get("exchange"),
        "indmoney_scrip_code": scrip,
        "ltp": ltp,
        "raw": raw,
    }


def fetch_quotes(http: IndmoneyHTTP, instruments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    requested: list[tuple[int, str, dict[str, Any]]] = []
    for inst in instruments:
        scrip = _normalize_scrip_code(
            inst.get("indmoney_scrip_code") or inst.get("scrip_code") or inst.get("security_id"),
            exchange=inst.get("exchange") or inst.get("exchange_segment"),
            segment=inst.get("segment"),
        )
        if not scrip:
            out.append(
                {
                    "symbol": inst.get("symbol") or "",
                    "exchange": inst.get("exchange"),
                    "ltp": 0,
                    "raw": {
                        "status": "error",
                        "message": "INDmoney scrip code is required for quotes. Run instrument sync or pass indmoney_scrip_code.",
                    },
                }
            )
            continue
        out.append(
            {
                "symbol": inst.get("symbol") or scrip,
                "exchange": inst.get("exchange"),
                "indmoney_scrip_code": scrip,
                "ltp": 0,
                "raw": {},
            }
        )
        requested.append((len(out) - 1, scrip, inst))

    if not requested:
        return out

    for start in range(0, len(requested), _QUOTE_BATCH_SIZE):
        chunk = requested[start : start + _QUOTE_BATCH_SIZE]
        scrip_codes = ",".join(scrip for _, scrip, _ in chunk)
        raw = http.request("GET", "/market/quotes/full", {"scrip-codes": scrip_codes}, None)
        data = raw.get("data") if isinstance(raw, dict) else {}
        if not isinstance(data, dict):
            ltp_raw = http.request("GET", "/market/quotes/ltp", {"scrip-codes": scrip_codes}, None)
            data = ltp_raw.get("data") if isinstance(ltp_raw, dict) and isinstance(ltp_raw.get("data"), dict) else {}
        for index, scrip, inst in chunk:
            block = data.get(scrip) or {}
            out[index] = _quote_row_from_block(inst, scrip, block)
    return out


def sync_instruments(http: IndmoneyHTTP) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str, str]] = set()
    for source in _INSTRUMENT_SOURCES:
        csv_text = http.request_text("/market/instruments", {"source": source})
        parsed = list(csv.DictReader(StringIO(csv_text)))
        for item in parsed:
            if not any(_clean_text(value) for value in item.values()):
                continue
            exchange = _normalize_exchange(item.get("EXCH"))
            segment = _segment_label(source, item)
            trading_symbol = _clean_text(item.get("TRADING_SYMBOL"))
            symbol = _normalize_symbol(
                trading_symbol or item.get("SYMBOL_NAME") or item.get("CUSTOM_SYMBOL")
            )
            security_id = _clean_text(item.get("SECURITY_ID"))
            if not exchange or not symbol or not security_id:
                continue
            indmoney_scrip_code = _normalize_scrip_code(
                security_id,
                exchange=exchange,
                segment=segment,
            )
            dedupe_key = (
                exchange,
                symbol,
                trading_symbol or symbol,
                indmoney_scrip_code or security_id,
            )
            if dedupe_key in seen:
                continue
            seen.add(dedupe_key)
            rows.append(
                {
                    "symbol": symbol,
                    "exchange": exchange,
                    "segment": segment,
                    "trading_symbol": trading_symbol or symbol,
                    "name": _clean_text(item.get("CUSTOM_SYMBOL"))
                    or _clean_text(item.get("SYMBOL_NAME"))
                    or trading_symbol
                    or symbol,
                    "instrument_type": _clean_text(item.get("INSTRUMENT_NAME"))
                    or _clean_text(item.get("SEM_EXCH_INSTRUMENT_TYPE"))
                    or source.upper(),
                    "expiry": _clean_text(item.get("EXPIRY_DATE")),
                    "strike": _clean_text(item.get("STRIKE_PRICE")),
                    "option_type": _clean_text(item.get("OPTION_TYPE")),
                    "lot_size": _clean_text(item.get("LOT_UNITS")),
                    "tick_size": _clean_text(item.get("TICK_SIZE")),
                    "indmoney_scrip_code": indmoney_scrip_code,
                    "native_payload": {
                        "security_id": security_id,
                        "source": source,
                        "expiry_code": _clean_text(item.get("EXPIRY_CODE")),
                        "expiry_flag": _clean_text(item.get("EXPIRY_FLAG")),
                        "series": _clean_text(item.get("SERIES")),
                    },
                    "raw_payload": item,
                }
            )
    return rows


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
