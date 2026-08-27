from app.schemas.broker import QuoteRow
from app.services import broker_data


class _FakeAccount:
    broker_code = "indmoney"
    id = "acc-1"
    user_id = "user-1"


class _FakeClient:
    def __init__(self):
        self.calls: list[list[dict]] = []

    def fetch_quotes(self, instruments):
        self.calls.append(instruments)
        rows = []
        for item in instruments:
            exchange = str(item.get("exchange") or "NSE").upper()
            symbol = item.get("symbol")
            if exchange == "NSE":
                rows.append({"symbol": symbol, "ltp": 0, "exchange": "NSE"})
            else:
                rows.append({"symbol": symbol, "ltp": 3421.7, "exchange": "BSE"})
        return rows

    def fetch_historical(self, payload):
        exchange = str((payload.get("instrument") or {}).get("exchange") or "NSE").upper()
        if exchange == "NSE":
            return {"candles": []}
        return {"candles": [{"time": "2026-08-01", "open": 1, "high": 2, "low": 1, "close": 2, "volume": 10}]}


def test_cash_alt_exchange_nse_to_bse():
    assert broker_data.cash_alt_exchange("NSE") == "BSE"
    assert broker_data.cash_alt_exchange(None) == "BSE"
    assert broker_data.cash_alt_exchange("BSE") == "NSE"
    assert broker_data.cash_alt_exchange("NFO") is None


def test_fetch_quotes_retries_bse_when_nse_ltp_missing(monkeypatch):
    client = _FakeClient()
    monkeypatch.setattr(broker_data, "_client", lambda db, acc: client)
    monkeypatch.setattr(broker_data, "hydrate_instruments", lambda db, acc, instruments: list(instruments))

    rows = broker_data.fetch_quotes(
        None,
        _FakeAccount(),
        [{"symbol": "MM", "exchange": "NSE"}],
    )
    assert len(rows) == 1
    assert rows[0].ltp == 3421.7
    assert rows[0].detail.get("exchange_fallback") == "BSE"
    assert len(client.calls) == 2


def test_fetch_historical_retries_bse_when_nse_candles_empty(monkeypatch):
    client = _FakeClient()
    monkeypatch.setattr(broker_data, "_client", lambda db, acc: client)
    monkeypatch.setattr(
        broker_data,
        "_hydrate_exact_match",
        lambda db, broker_code, instrument: dict(instrument),
    )
    payload = broker_data.fetch_historical(
        None,
        _FakeAccount(),
        {
            "instrument": {"symbol": "MM", "exchange": "NSE"},
            "interval": "day",
            "from_date": "2026-05-01",
            "to_date": "2026-08-01",
        },
    )
    assert payload.get("exchange_fallback") == "BSE"
    assert payload.get("candles")


def test_quote_row_ltp_missing_treats_zero_as_empty():
    row = QuoteRow(symbol="MM", ltp=0, broker_code="indmoney", account_id="acc-1", detail={})
    assert broker_data._quote_ltp_missing(row) is True
    row.ltp = 12.5
    assert broker_data._quote_ltp_missing(row) is False
