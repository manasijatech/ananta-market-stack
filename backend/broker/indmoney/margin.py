from __future__ import annotations

from typing import Any

from broker.indmoney.http_api import IndmoneyHTTP

_PRODUCT_MAP = {
    "CNC": "CNC",
    "DELIVERY": "CNC",
    "MIS": "INTRADAY",
    "INTRADAY": "INTRADAY",
    "NRML": "MARGIN",
    "MARGIN": "MARGIN",
}


def _security_id(position: dict[str, Any]) -> str | None:
    scrip_code = str(
        position.get("indmoney_scrip_code")
        or position.get("scrip_code")
        or position.get("security_id")
        or position.get("securityID")
        or ""
    ).strip()
    if "_" in scrip_code:
        return scrip_code.split("_", 1)[1].strip() or None
    return scrip_code or None


def _segment(position: dict[str, Any]) -> str:
    exchange = str(position.get("exchange") or "").upper()
    raw_segment = str(position.get("segment") or "").upper()
    if exchange in {"NFO", "BFO", "CDS", "MCX"} or raw_segment in {"D", "FNO", "FO", "DERIVATIVE"}:
        return "DERIVATIVE"
    return "EQUITY"


def _product(position: dict[str, Any]) -> str:
    normalized = str(position.get("product") or "CNC").upper()
    return _PRODUCT_MAP.get(normalized, normalized or "CNC")


def _txn_type(position: dict[str, Any]) -> str:
    action = str(position.get("action") or position.get("txnType") or "BUY").upper()
    return "SELL" if action == "SELL" else "BUY"


def calculate_margin(http: IndmoneyHTTP, positions: list[dict[str, Any]]) -> dict[str, Any]:
    if not positions:
        return {"status": "error", "message": "at least one margin leg is required"}
    if len(positions) > 1:
        return {
            "status": "error",
            "message": "INDmoney margin calculator currently supports one order leg per request",
        }

    position = positions[0]
    security_id = _security_id(position)
    if not security_id:
        return {
            "status": "error",
            "message": "INDmoney margin calculation requires indmoney_scrip_code or security_id",
        }

    payload = {
        "segment": _segment(position),
        "exchange": str(position.get("exchange") or "NSE").upper() or "NSE",
        "securityID": security_id,
        "txnType": _txn_type(position),
        "quantity": str(position.get("quantity") or "0"),
        "price": str(position.get("price") or "0"),
        "product": _product(position),
    }
    return http.request("GET", "/margin", None, payload)
