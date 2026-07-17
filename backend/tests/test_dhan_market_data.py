from __future__ import annotations

import json

from broker.dhan.client import DhanClient
from broker.dhan import market_data


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
