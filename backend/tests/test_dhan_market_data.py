from __future__ import annotations

import json
import asyncio
import struct

from broker.dhan.client import DhanClient
from broker.dhan import market_data
from broker.dhan.live_price_adapter import DhanFeedDisconnect, DhanLivePriceAdapter, parse_feed_packet


class _HTTP:
    def __init__(self, payload: dict) -> None:
        self.payload = payload
        self.calls: list[tuple[str, str, str | None]] = []

    def request(self, method: str, endpoint: str, payload: str | None = None) -> dict:
        self.calls.append((method, endpoint, payload))
        return self.payload


def test_dhan_segment_mapping_matches_documented_api_enums() -> None:
    assert market_data._dhan_exchange_segment("NSE", "E") == "NSE_EQ"
    assert market_data._dhan_exchange_segment("NSE", "D") == "NSE_FNO"
    assert market_data._dhan_exchange_segment("BSE", "D") == "BSE_FNO"
    assert market_data._dhan_exchange_segment("NSE", "I") == "IDX_I"
    assert market_data._dhan_exchange_segment("MCX", "M") == "MCX_COMM"


def test_quote_uses_numeric_security_ids_and_native_segment() -> None:
    http = _HTTP({"data": {"NSE_EQ": {"2885": {"last_price": 1510.25}}}})

    rows = market_data.fetch_quotes(
        http,
        [{"symbol": "RELIANCE", "dhan_exchange_segment": "NSE_EQ", "dhan_security_id": "2885"}],
    )

    assert json.loads(http.calls[0][2] or "{}") == {"NSE_EQ": [2885]}
    assert rows[0]["ltp"] == 1510.25


def test_ohlc_uses_dhan_ohlc_endpoint() -> None:
    http = _HTTP(
        {
            "data": {
                "NSE_EQ": {
                    "2885": {
                        "last_price": 1510.25,
                        "ohlc": {"open": 1500, "high": 1520, "low": 1490, "close": 1505},
                    }
                }
            }
        }
    )

    rows = market_data.fetch_ohlc(
        http,
        [{"symbol": "RELIANCE", "dhan_exchange_segment": "NSE_EQ", "dhan_security_id": "2885"}],
    )

    assert http.calls[0][1] == "/v2/marketfeed/ohlc"
    assert rows[0]["open"] == 1500
    assert rows[0]["close"] == 1505


def test_intraday_history_uses_documented_datetime_and_interval() -> None:
    http = _HTTP({"open": [], "high": [], "low": [], "close": [], "volume": [], "timestamp": []})

    market_data.fetch_historical(
        http,
        {
            "instrument": {
                "dhan_exchange_segment": "NSE_EQ",
                "dhan_security_id": "2885",
                "instrument_type": "EQUITY",
            },
            "interval": "5minute",
            "from_date": "2026-07-17T09:15:00+05:30",
            "to_date": "2026-07-17T15:30:00+05:30",
        },
        resolver=None,  # type: ignore[arg-type]
    )

    payload = json.loads(http.calls[0][2] or "{}")
    assert http.calls[0][1] == "/v2/charts/intraday"
    assert payload["interval"] == "5"
    assert payload["fromDate"] == "2026-07-17 09:15:00"
    assert payload["toDate"] == "2026-07-17 15:30:00"


def test_verify_reports_inactive_dhan_data_plan() -> None:
    client = DhanClient(app_id="app", app_secret="secret", client_id="client", access_token="token")
    client._http = _HTTP({"dhanClientId": "client", "dataPlan": "Inactive"})  # type: ignore[assignment]

    ok, message = client.verify_connection()

    assert ok is False
    assert "Data API plan is not active" in message


def test_dhan_quote_feed_packet_uses_documented_little_endian_layout() -> None:
    packet = struct.pack(
        "<BHBIfHIfIIIffff",
        4,
        50,
        1,
        2885,
        1510.25,
        7,
        1_752_728_400,
        1505.5,
        123456,
        900,
        850,
        1500.0,
        1495.0,
        1520.0,
        1490.0,
    )

    parsed = parse_feed_packet(packet)

    assert parsed is not None
    assert parsed["exchange_segment"] == "NSE_EQ"
    assert parsed["security_id"] == "2885"
    assert parsed["ltp"] == 1510.25
    assert parsed["open"] == 1500.0
    assert parsed["volume"] == 123456


def test_dhan_feed_disconnect_exposes_data_api_entitlement_code() -> None:
    packet = struct.pack("<BHBIH", 50, 10, 0, 0, 806)

    try:
        parse_feed_packet(packet)
    except DhanFeedDisconnect as exc:
        assert exc.code == 806
        assert "not subscribed" in str(exc)
    else:
        raise AssertionError("expected DhanFeedDisconnect")


def test_dhan_subscription_messages_are_batched_at_100_instruments() -> None:
    class _WebSocket:
        def __init__(self) -> None:
            self.messages: list[str] = []

        async def send(self, message: str) -> None:
            self.messages.append(message)

    websocket = _WebSocket()
    keys = [f"NSE_EQ|{security_id}" for security_id in range(250)]

    asyncio.run(DhanLivePriceAdapter._send_batches(websocket, 17, keys))

    payloads = [json.loads(message) for message in websocket.messages]
    assert [payload["InstrumentCount"] for payload in payloads] == [100, 100, 50]
    assert all(payload["RequestCode"] == 17 for payload in payloads)
