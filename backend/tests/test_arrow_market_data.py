from __future__ import annotations

from typing import Any

from broker.arrow import market_data, orders


class HTTP:
    def __init__(self, payload: Any) -> None:
        self.payload = payload
        self.calls: list[tuple[str, str, dict[str, Any]]] = []

    def request(self, method: str, path: str, **kwargs: Any) -> Any:
        self.calls.append((method, path, kwargs))
        return self.payload


class Resolver:
    def broker_symbol(self, symbol: str, exchange: str) -> str:
        return f"{symbol}-EQ" if exchange == "NSE" and not symbol.endswith("-EQ") else symbol

    def arrow_token(self, symbol: str, exchange: str) -> str:
        return "2885"


def test_arrow_instrument_csv_mapping() -> None:
    http = HTTP(
        "Exchange,Segment,ExchSeg,Token,FullName,Symbol,TradingSymbol,Series,ISIN,LotSize,TickSize,PricePrecision,OptionType,Underlying,UnderlyingToken,StrikePrice,Expiry\n"
        "NSE,CM,NSECM,2885,RELIANCE INDUSTRIES,RELIANCE,RELIANCE-EQ,EQ,INE002A01018,1,0.10,2,,,,,\n"
    )
    rows = market_data.sync_instruments(http)  # type: ignore[arg-type]
    assert rows[0]["arrow_token"] == "2885"
    assert rows[0]["exchange"] == "NSE"
    assert rows[0]["trading_symbol"] == "RELIANCE-EQ"
    assert rows[0]["price_precision"] == "2"


def test_arrow_quotes_match_by_token_and_scale_prices() -> None:
    http = HTTP(
        {
            "status": "success",
            "data": [
                {"token": 1594, "ltp": 150025, "close": 149000},
                {"token": 2885, "ltp": 140050, "close": 139000},
            ],
        }
    )
    rows = market_data.fetch_quotes(
        http,  # type: ignore[arg-type]
        [
            {"symbol": "RELIANCE", "exchange": "NSE", "arrow_token": "2885", "price_precision": 2},
            {"symbol": "INFY", "exchange": "NSE", "arrow_token": "1594", "price_precision": 2},
        ],
        Resolver(),
    )
    assert rows[0]["ltp"] == 1400.5
    assert rows[1]["ltp"] == 1500.25
    assert rows[0]["raw"]["token"] == 2885


def test_arrow_market_order_uses_mpp_and_uniform_product_mapping() -> None:
    payload = orders.order_payload(
        {
            "symbol": "RELIANCE",
            "exchange": "NSE",
            "action": "buy",
            "quantity": "2",
            "product": "MIS",
            "pricetype": "MARKET",
        },
        Resolver(),
    )
    assert payload["symbol"] == "RELIANCE-EQ"
    assert payload["product"] == "I"
    assert payload["order"] == "MKT"
    assert payload["transactionType"] == "B"
    assert payload["quantity"] == "2"
    assert payload["validity"] == "DAY"
    assert payload["disclosedQty"] == "0"
    assert payload["mpp"] is True


def test_option_chain_accepts_underlying_or_explicit_token() -> None:
    underlying_http = HTTP({"data": []})
    market_data.option_chain(
        underlying_http,  # type: ignore[arg-type]
        {"symbol": "NIFTY", "exchange": "INDEX", "expiry": "30-JUL-2026", "count": 10},
    )
    assert underlying_http.calls[0][2]["json"]["underlying"] == "NIFTY"

    token_http = HTTP({"data": []})
    market_data.option_chain(
        token_http,  # type: ignore[arg-type]
        {"instrument_token": "26000", "exchange": "INDEX", "count": 10},
    )
    assert token_http.calls[0][2]["json"]["token"] == "26000"


def test_historical_candles_are_scaled_and_raw_is_preserved() -> None:
    http = HTTP([["2026-07-21T09:15:00+0530", 140000, 141000, 139500, 140500, 1000]])
    result = market_data.fetch_historical(
        http,  # type: ignore[arg-type]
        {
            "instrument": {
                "symbol": "RELIANCE",
                "exchange": "NSE",
                "arrow_token": "2885",
                "price_precision": 2,
            },
            "interval": "min",
            "from_date": "2026-07-21T09:15:00",
            "to_date": "2026-07-21T09:16:00",
            "oi": True,
        },
        Resolver(),
    )
    assert result["data"][0][1:5] == [1400.0, 1410.0, 1395.0, 1405.0]
    assert result["raw"][0][1] == 140000
    assert http.calls[0][2]["params"]["oi"] == "1"


def test_arrow_mpp_response_describes_limit_execution_semantics() -> None:
    http = HTTP({"status": "success", "data": {"orderNo": "123"}})
    response = orders.place(
        http,  # type: ignore[arg-type]
        {
            "symbol": "RELIANCE",
            "exchange": "NSE",
            "action": "BUY",
            "quantity": 1,
            "product": "CNC",
            "pricetype": "MARKET",
        },
        Resolver(),
    )
    assert "limit order" in response["execution_semantics"]
    assert http.calls[0][2]["retry_read"] is False


def test_arrow_basket_margin_uses_sdk_compatible_envelope() -> None:
    http = HTTP({"status": "success", "data": {"final_margin": 100}})
    orders.margin(
        http,  # type: ignore[arg-type]
        [
            {"symbol": "RELIANCE", "exchange": "NSE", "quantity": 1, "action": "BUY", "product": "CNC", "pricetype": "LIMIT", "price": 100, "arrow_token": "2885"},
            {"symbol": "INFY", "exchange": "NSE", "quantity": 1, "action": "SELL", "product": "CNC", "pricetype": "LIMIT", "price": 100},
        ],
        Resolver(),
        include_positions=False,
    )
    body = http.calls[0][2]["json"]
    assert body["includePositions"] is False
    assert body["orders"][0]["token"] == "2885"
    assert body["orders"][0]["transactionType"] == "B"
    assert body["orders"][1]["transactionType"] == "S"


def test_greeks_are_disabled_without_configuration() -> None:
    result = market_data.greeks(HTTP({}), {"instrument_tokens": ["1"]}, enabled=False)  # type: ignore[arg-type]
    assert result["status"] == "unsupported"
