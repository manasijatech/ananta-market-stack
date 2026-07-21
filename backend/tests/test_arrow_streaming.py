from __future__ import annotations

import struct

import pytest
import zstandard as zstd

from broker.arrow.streaming import (
    hft_subscription_batches,
    hft_symbol,
    parse_hft_packet,
    parse_standard_packet,
    scale_tick,
    split_hft_frames,
)


def test_hft_symbol_grammar_for_cash_and_derivatives() -> None:
    assert hft_symbol("NSE", "RELIANCE-EQ") == "NSE.RELIANCE-EQ"
    assert hft_symbol("BSE", "SBIN") == "BSE.SBIN"
    assert hft_symbol("NFO", "NIFTY30JUL26C25000") == "NIFTY30JUL26C25000"


def test_standard_ltp_and_ltpc_packets_are_big_endian() -> None:
    ltp = (2885).to_bytes(4, "big") + (140050).to_bytes(4, "big") + bytes(5)
    parsed = parse_standard_packet(ltp)
    assert parsed == {"token": "2885", "ltp_raw": 140050, "mode": "ltp"}

    ltpc = ltp + (139000).to_bytes(4, "big")
    parsed_ltpc = parse_standard_packet(ltpc)
    assert parsed_ltpc and parsed_ltpc["close_raw"] == 139000
    assert scale_tick(parsed_ltpc, 2)["ltp"] == 1400.5


def test_standard_quote_and_full_depth_packets() -> None:
    quote = bytearray(93)
    quote[0:4] = (2885).to_bytes(4, "big")
    quote[4:8] = (140050).to_bytes(4, "big")
    quote[13:17] = (10).to_bytes(4, "big")
    quote[17:21] = (139900).to_bytes(4, "big")
    quote[37:41] = (139000).to_bytes(4, "big")
    quote[41:45] = (141000).to_bytes(4, "big")
    quote[45:49] = (138500).to_bytes(4, "big")
    quote[49:53] = (138000).to_bytes(4, "big")
    parsed_quote = parse_standard_packet(bytes(quote))
    assert parsed_quote and parsed_quote["mode"] == "quote"
    assert scale_tick(parsed_quote, 2)["high"] == 1410.0

    full = bytearray(249)
    full[:93] = quote
    full[93:97] = (120000).to_bytes(4, "big")
    full[97:101] = (160000).to_bytes(4, "big")
    full[109:117] = (25).to_bytes(8, "big")
    full[117:121] = (140000).to_bytes(4, "big")
    full[121:123] = (3).to_bytes(2, "big")
    parsed_full = parse_standard_packet(bytes(full))
    assert parsed_full and parsed_full["mode"] == "full"
    assert scale_tick(parsed_full, 2)["bids"][0]["price"] == 1400.0


def test_hft_ltp_packet_is_little_endian() -> None:
    packet = bytearray(40)
    struct.pack_into("<hBBiiiqQII", packet, 0, 40, 1, 0, 2885, 140050, 139900, 1234, 100, 10, 20)
    parsed = parse_hft_packet(bytes(packet))
    assert parsed and parsed["token"] == "2885"
    assert parsed["ltp_raw"] == 140050


def test_hft_full_packet_is_little_endian() -> None:
    packet = bytearray(196)
    struct.pack_into("<hBB", packet, 0, 196, 2, 0)
    struct.pack_into("<8i", packet, 4, 2885, 140050, 5, 139900, 139000, 141000, 138500, 138000)
    struct.pack_into("<5i", packet, 72, 140000, 139990, 139980, 139970, 139960)
    struct.pack_into("<5i", packet, 112, 10, 20, 30, 40, 50)
    struct.pack_into("<5H", packet, 152, 1, 2, 3, 4, 5)
    parsed = parse_hft_packet(bytes(packet))
    assert parsed and parsed["mode"] == "full"
    assert parsed["bids"][0]["price_raw"] == 140000
    assert scale_tick(parsed, 2)["ltp"] == 1400.5


def test_hft_ack_and_concatenated_frames() -> None:
    ack = bytearray(540)
    struct.pack_into("<I", ack, 0, 540)
    ack[4] = 99
    ack[6:13] = b"SUCCESS"
    struct.pack_into("<HH", ack, 536, 2, 0)
    tick = bytearray(40)
    struct.pack_into("<hB", tick, 0, 40, 1)
    frames = split_hft_frames(bytes(tick + ack))
    assert [len(frame) for frame in frames] == [40, 540]
    parsed = parse_hft_packet(frames[1])
    assert parsed and parsed["kind"] == "ack" and parsed["success_count"] == 2

    compressed = zstd.ZstdCompressor().compress(bytes(tick + ack))
    decompressed = zstd.ZstdDecompressor().decompress(compressed)
    assert [len(frame) for frame in split_hft_frames(decompressed)] == [40, 540]


def test_hft_subscription_limits_and_batching() -> None:
    messages = hft_subscription_batches(
        [f"NSE.SYM{i}-EQ" for i in range(1024)], mode="ltpc", latency_ms=1000
    )
    assert len(messages) == 2
    with pytest.raises(ValueError, match="at most 1024"):
        hft_subscription_batches(
            [f"NSE.SYM{i}-EQ" for i in range(1025)], mode="ltpc", latency_ms=1000
        )
    with pytest.raises(ValueError, match="between 50 and 60000"):
        hft_subscription_batches(["NSE.SBIN-EQ"], mode="ltpc", latency_ms=49)
