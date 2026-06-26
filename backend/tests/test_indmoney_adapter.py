from datetime import datetime, timezone
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from broker.indmoney import funds as ifunds
from broker.indmoney import margin as imargin
from broker.indmoney import market_data as imd
from broker.indmoney import orders as iorders


class FakeHTTP:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, dict | None, object | None]] = []

    def request(self, method: str, path: str, params=None, json_body=None):
        self.calls.append((method, path, params, json_body))
        return {"status": "success", "data": []}


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
