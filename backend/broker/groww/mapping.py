from __future__ import annotations

SEGMENT_CASH = "CASH"
SEGMENT_FNO = "FNO"
SEGMENT_COMMODITY = "COMMODITY"


def map_exchange(exchange: str) -> str:
    return {"NSE": "NSE", "BSE": "BSE", "NFO": "NSE", "BFO": "BSE", "MCX": "MCX"}.get(
        exchange, exchange
    )


def map_segment(exchange: str) -> str:
    if exchange == "MCX":
        return SEGMENT_COMMODITY
    return SEGMENT_FNO if exchange in ("NFO", "BFO", "CDS") else SEGMENT_CASH


def map_product(product: str) -> str:
    return {"CNC": "CNC", "NRML": "NRML", "MIS": "MIS"}.get(product, "CNC")


def map_order_type(pt: str) -> str:
    return {"MARKET": "MARKET", "LIMIT": "LIMIT", "SL": "SL", "SL-M": "SL-M"}.get(
        pt, "MARKET"
    )


def map_txn(action: str) -> str:
    return "BUY" if action.upper() == "BUY" else "SELL"
