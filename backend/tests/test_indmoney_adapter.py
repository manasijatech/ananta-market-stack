from datetime import datetime, timezone
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from broker.indmoney import funds as ifunds
from broker.indmoney import margin as imargin
from broker.indmoney import market_data as imd
from broker.indmoney import orders as iorders


class FakeHTTP:
    def __init__(self, responses: dict[str, dict] | None = None) -> None:
        self.calls: list[tuple[str, str, dict | None, object | None]] = []
        self.responses = responses or {}

    def request(self, method: str, path: str, params=None, json_body=None):
        self.calls.append((method, path, params, json_body))
        return self.responses.get(path, {"status": "success", "data": []})


def test_indmoney_user_profile_uses_profile_endpoint():
    http = FakeHTTP()

    ifunds.user_profile(http)

    assert http.calls == [("GET", "/user/profile", None, None)]


def test_indmoney_order_book_and_trade_book_use_documented_endpoints():
    http = FakeHTTP()

    iorders.order_book(http)
    iorders.trade_book(http)

    assert http.calls == [
        ("GET", "/order-book", None, None),
        ("GET", "/trade-book", {"segment": "EQUITY"}, None),
        ("GET", "/trade-book", {"segment": "DERIVATIVE"}, None),
    ]


def test_indmoney_historical_uses_path_interval_and_epoch_millis():
    http = FakeHTTP()

    imd.fetch_historical(
        http,
        {
            "instrument": {"indmoney_scrip_code": "NSE_2885"},
            "interval": "minute",
            "from_date": datetime(2026, 6, 26, 9, 15, tzinfo=timezone.utc),
            "to_date": datetime(2026, 6, 26, 15, 30, tzinfo=timezone.utc),
        },
        resolver=None,
    )

    assert http.calls == [
        (
            "GET",
            "/market/historical/1minute",
            {
                "scrip-codes": "NSE_2885",
                "start_time": 1782465300000,
                "end_time": 1782487800000,
            },
            None,
        )
    ]


def test_indmoney_margin_uses_get_with_json_body_and_security_id():
    http = FakeHTTP()

    imargin.calculate_margin(
        http,
        [
            {
                "indmoney_scrip_code": "NSE_2885",
                "exchange": "NSE",
                "action": "BUY",
                "quantity": 1,
                "price": 1318,
                "product": "CNC",
            }
        ],
    )

    assert http.calls == [
        (
            "GET",
            "/margin",
            None,
            {
                "segment": "EQUITY",
                "exchange": "NSE",
                "securityID": "2885",
                "txnType": "BUY",
                "quantity": "1",
                "price": "1318",
                "product": "CNC",
            },
        )
    ]


_OPTION_CHAIN_PAYLOAD = {
    "status": "success",
    "data": {
        "expiry": "2026-08-27",
        "strikes": {
            "1400": {
                "ce": {
                    "greeks": {"delta": 0.51, "gamma": 0.02, "theta": -0.12, "vega": 0.31},
                    "iv": 18.2,
                    "last_price": 12.5,
                    "oi": 1100,
                    "trading_symbol": "RELIANCE26AUG1400CE",
                },
                "pe": {
                    "greeks": {"delta": -0.49, "gamma": 0.02, "theta": -0.11, "vega": 0.3},
                    "iv": 19.1,
                    "last_price": 11.0,
                    "oi": 980,
                    "trading_symbol": "RELIANCE26AUG1400PE",
                },
            }
        },
        "underlying_ltp": 1401.25,
    },
}


def test_indmoney_option_chain_uses_underlying_scrip_and_expiry():
    http = FakeHTTP({"/market/option-chain": _OPTION_CHAIN_PAYLOAD})

    payload = imd.fetch_option_chain(
        http,
        {
            "count": 8,
            "exchange": "NSE",
            "expiry": "2026-08-27",
            "indmoney_scrip_code": "NSE_2885",
            "symbol": "RELIANCE",
        },
    )

    assert payload["status"] == "success"
    assert payload["data"]["strikes"]["1400"]["ce"]["last_price"] == 12.5
    assert http.calls == [
        (
            "GET",
            "/market/option-chain",
            {
                "exchange": "NSE",
                "expiry": "2026-08-27",
                "segment": "EQUITY",
                "strike_count": 8,
                "underlying-scrip": "2885",
            },
            None,
        )
    ]


def test_indmoney_option_chain_uses_index_segment_for_nifty():
    http = FakeHTTP({"/market/option-chain": _OPTION_CHAIN_PAYLOAD})

    imd.fetch_option_chain(
        http,
        {
            "exchange": "NSE",
            "expiry": "2026-08-27",
            "indmoney_scrip_code": "NSE_40000001",
            "symbol": "NIFTY",
        },
    )

    assert http.calls[0][2]["segment"] == "INDEX"
    assert http.calls[0][2]["underlying-scrip"] == "40000001"


def test_indmoney_greeks_reuse_option_chain():
    http = FakeHTTP({"/market/option-chain": _OPTION_CHAIN_PAYLOAD})

    payload = imd.fetch_greeks(
        http,
        {
            "exchange": "NSE",
            "expiry": "2026-08-27",
            "indmoney_scrip_code": "NSE_2885",
            "symbol": "RELIANCE",
        },
    )

    assert payload["status"] == "success"
    assert "greeks" in (payload.get("guidance") or "").lower()
    assert http.calls[0][1] == "/market/option-chain"


def test_indmoney_option_chain_rejects_fno_contract_scrip_and_missing_expiry():
    http = FakeHTTP({"/market/option-chain": _OPTION_CHAIN_PAYLOAD})

    missing_underlying = imd.fetch_option_chain(
        http,
        {"exchange": "NSE", "expiry": "2026-08-27", "indmoney_scrip_code": "NFO_51011", "symbol": "RELIANCE"},
    )
    missing_expiry = imd.fetch_option_chain(
        http,
        {"exchange": "NSE", "indmoney_scrip_code": "NSE_2885", "symbol": "RELIANCE"},
    )

    assert missing_underlying["status"] == "error"
    assert missing_expiry["status"] == "error"
    assert http.calls == []


def test_parse_expiry_reads_indmoney_csv_datetime():
    from broker.core.instrument_store import parse_expiry

    parsed = parse_expiry("08/25/2026 14:00")
    assert parsed is not None
    assert parsed.date().isoformat() == "2026-08-25"
    assert parse_expiry("10/27/2026 14:00").date().isoformat() == "2026-10-27"
