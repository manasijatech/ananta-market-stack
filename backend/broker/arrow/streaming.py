from __future__ import annotations

import json
import struct
from typing import Any

STANDARD_URL = "wss://ds.arrow.trade"
HFT_URL = "wss://socket.arrow.trade"
ORDER_URL = "wss://order-updates.arrow.trade"

HFT_MAX_SYMBOLS = 1024
HFT_BATCH_SIZE = 512
HFT_MAX_REQUEST_BYTES = 16 * 1024


def hft_symbol(exchange: str, trading_symbol: str) -> str:
    normalized = exchange.strip().upper()
    if normalized in {"NSE", "NSECM"}:
        return f"NSE.{trading_symbol}"
    if normalized in {"BSE", "BSECM"}:
        return f"BSE.{trading_symbol}"
    # Arrow's NSEFO/BSEFO symbol grammar does not use an exchange prefix.
    return trading_symbol


def _be(data: bytes) -> int:
    return int.from_bytes(data, "big", signed=False)


def parse_standard_packet(data: bytes) -> dict[str, Any] | None:
    if len(data) < 13 or 13 < len(data) < 17:
        return None
    tick: dict[str, Any] = {"token": str(_be(data[0:4])), "ltp_raw": _be(data[4:8]), "mode": "ltp"}
    if len(data) >= 17:
        tick.update(close_raw=_be(data[13:17]), mode="ltpc")
    if len(data) >= 93:
        tick.update(
            ltq=_be(data[13:17]),
            average_price_raw=_be(data[17:21]),
            total_buy_quantity=_be(data[21:29]),
            total_sell_quantity=_be(data[29:37]),
            open_raw=_be(data[37:41]),
            high_raw=_be(data[41:45]),
            close_raw=_be(data[45:49]),
            low_raw=_be(data[49:53]),
            volume=_be(data[53:61]),
            last_trade_time=_be(data[61:65]),
            timestamp=_be(data[65:69]),
            open_interest=_be(data[69:77]),
            oi_day_high=_be(data[77:85]),
            oi_day_low=_be(data[85:93]),
            mode="quote",
        )
    if len(data) >= 241:
        tick.update(lower_limit_raw=_be(data[93:97]), upper_limit_raw=_be(data[97:101]), mode="full")
        depth_offset = 109 if len(data) >= 249 else 101
        if len(data) >= depth_offset + 140:
            bids, asks = [], []
            for index in range(10):
                offset = depth_offset + index * 14
                level = {
                    "quantity": _be(data[offset : offset + 8]),
                    "price_raw": _be(data[offset + 8 : offset + 12]),
                    "orders": _be(data[offset + 12 : offset + 14]),
                }
                (bids if index < 5 else asks).append(level)
            tick.update(bids=bids, asks=asks)
    return tick


def parse_hft_packet(data: bytes) -> dict[str, Any] | None:
    if len(data) == 540 and data[4] == 99:
        return {
            "kind": "ack",
            "size": struct.unpack_from("<I", data)[0],
            "error_code": data[6:22].decode(errors="replace").rstrip("\x00"),
            "error_message": data[22:534].decode(errors="replace").rstrip("\x00"),
            "request_type": "subscribe" if data[534] == 0 else "unsubscribe",
            "mode": "ltpc" if data[535] == 0 else "full",
            "success_count": struct.unpack_from("<H", data, 536)[0],
            "error_count": struct.unpack_from("<H", data, 538)[0],
        }
    if len(data) == 40 and data[2] == 1:
        return {
            "kind": "tick", "mode": "ltpc", "exchange_segment": data[3],
            "token": str(struct.unpack_from("<i", data, 4)[0]),
            "ltp_raw": struct.unpack_from("<i", data, 8)[0],
            "average_price_raw": struct.unpack_from("<i", data, 12)[0],
            "volume": struct.unpack_from("<q", data, 16)[0],
            "last_trade_time": struct.unpack_from("<Q", data, 24)[0],
            "ask_traded_volume": struct.unpack_from("<I", data, 32)[0],
            "buy_traded_volume": struct.unpack_from("<I", data, 36)[0],
        }
    if len(data) == 196 and data[2] == 2:
        tick = {
            "kind": "tick", "mode": "full", "exchange_segment": data[3],
            "token": str(struct.unpack_from("<i", data, 4)[0]),
            "ltp_raw": struct.unpack_from("<i", data, 8)[0],
            "ltq": struct.unpack_from("<i", data, 12)[0],
            "average_price_raw": struct.unpack_from("<i", data, 16)[0],
            "open_raw": struct.unpack_from("<i", data, 20)[0],
            "high_raw": struct.unpack_from("<i", data, 24)[0],
            "close_raw": struct.unpack_from("<i", data, 28)[0],
            "low_raw": struct.unpack_from("<i", data, 32)[0],
            "last_trade_time": struct.unpack_from("<i", data, 36)[0],
            "lower_limit_raw": struct.unpack_from("<i", data, 40)[0],
            "upper_limit_raw": struct.unpack_from("<i", data, 44)[0],
            "total_buy_quantity": struct.unpack_from("<q", data, 48)[0],
            "total_sell_quantity": struct.unpack_from("<q", data, 56)[0],
            "volume": struct.unpack_from("<q", data, 64)[0],
            "open_interest": struct.unpack_from("<Q", data, 172)[0],
            "timestamp": struct.unpack_from("<Q", data, 180)[0],
        }
        tick["bids"] = _hft_depth(data, 72, 112, 152)
        tick["asks"] = _hft_depth(data, 92, 132, 162)
        return tick
    return None


def _hft_depth(data: bytes, price_offset: int, size_offset: int, orders_offset: int) -> list[dict[str, int]]:
    prices = struct.unpack_from("<5i", data, price_offset)
    sizes = struct.unpack_from("<5i", data, size_offset)
    orders = struct.unpack_from("<5H", data, orders_offset)
    return [{"price_raw": prices[i], "quantity": sizes[i], "orders": orders[i]} for i in range(5)]


def split_hft_frames(payload: bytes) -> list[bytes]:
    frames: list[bytes] = []
    offset = 0
    while offset < len(payload):
        remaining = payload[offset:]
        if len(remaining) < 2:
            break
        if len(remaining) >= 5 and remaining[4] == 99:
            size = struct.unpack_from("<I", remaining)[0]
        else:
            size = struct.unpack_from("<h", remaining)[0]
        valid_type = (
            (size == 40 and len(remaining) >= 3 and remaining[2] == 1)
            or (size == 196 and len(remaining) >= 3 and remaining[2] == 2)
            or (size == 540 and len(remaining) >= 5 and remaining[4] == 99)
        )
        if not valid_type or len(remaining) < size:
            break
        frames.append(remaining[:size])
        offset += size
    return frames


def hft_subscription_batches(symbols: list[str], *, mode: str, latency_ms: int, code: str = "sub") -> list[str]:
    if mode not in {"ltpc", "full", "l", "f"}:
        raise ValueError("Arrow HFT mode must be ltpc or full")
    if code not in {"sub", "unsub", "s", "u"}:
        raise ValueError("Arrow HFT code must subscribe or unsubscribe")
    if not 50 <= latency_ms <= 60_000:
        raise ValueError("Arrow HFT latency must be between 50 and 60000 ms")
    unique = list(dict.fromkeys(symbols))
    if len(unique) > HFT_MAX_SYMBOLS:
        raise ValueError(f"Arrow HFT supports at most {HFT_MAX_SYMBOLS} symbols per connection")
    messages: list[str] = []
    for start in range(0, len(unique), HFT_BATCH_SIZE):
        message = json.dumps(
            {"code": code, "mode": mode, "symbols": unique[start : start + HFT_BATCH_SIZE], "latency": latency_ms},
            separators=(",", ":"),
        )
        if len(message.encode()) > HFT_MAX_REQUEST_BYTES:
            raise ValueError("Arrow HFT subscription request exceeds 16 KB")
        messages.append(message)
    return messages


def scale_tick(tick: dict[str, Any], precision: int) -> dict[str, Any]:
    divisor = 10 ** max(0, min(precision, 8))
    out = dict(tick)
    mapping = {
        "ltp_raw": "ltp", "average_price_raw": "average_price", "open_raw": "open",
        "high_raw": "high", "low_raw": "low", "close_raw": "close",
        "lower_limit_raw": "lower_limit", "upper_limit_raw": "upper_limit",
    }
    for source, target in mapping.items():
        if source in tick:
            out[target] = float(tick[source]) / divisor
    for side in ("bids", "asks"):
        if isinstance(out.get(side), list):
            out[side] = [{**level, "price": float(level.get("price_raw", 0)) / divisor} for level in out[side]]
    return out
