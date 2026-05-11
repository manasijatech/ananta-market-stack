from __future__ import annotations

from typing import Any


def unsupported_operation(broker_code: str, feature: str) -> dict[str, Any]:
    return {
        "status": "unsupported",
        "broker_code": broker_code,
        "feature": feature,
        "message": f"{feature} is not implemented for {broker_code}.",
    }


def capability(supported: bool, guidance: str) -> dict[str, Any]:
    return {"supported": supported, "guidance": guidance}


def ohlc_from_quotes(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for row in rows:
        raw = row.get("raw") if isinstance(row.get("raw"), dict) else {}
        ohlc = raw.get("ohlc") if isinstance(raw.get("ohlc"), dict) else raw
        out.append(
            {
                **row,
                "open": ohlc.get("open") or ohlc.get("open_price"),
                "high": ohlc.get("high") or ohlc.get("high_price"),
                "low": ohlc.get("low") or ohlc.get("low_price"),
                "close": ohlc.get("close") or ohlc.get("close_price"),
            }
        )
    return out
