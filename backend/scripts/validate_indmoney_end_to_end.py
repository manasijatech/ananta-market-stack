from __future__ import annotations

import argparse
import asyncio
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import websockets

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from broker.core.instrument_store import SQLiteInstrumentResolver
from broker.core.registry import get_client_for_account
from db.models import BrokerAccount
from db.session import SessionLocal


def _truncate(value: Any, limit: int = 1200) -> str:
    text = json.dumps(value, default=str)
    return text if len(text) <= limit else text[:limit] + "..."


def _choose_account(db, account_id: str | None) -> BrokerAccount:
    if account_id:
        row = db.get(BrokerAccount, account_id)
        if row is None:
            raise SystemExit(f"account {account_id} not found")
        if row.broker_code != "indmoney":
            raise SystemExit(f"account {account_id} is not indmoney")
        return row
    row = db.query(BrokerAccount).filter(BrokerAccount.broker_code == "indmoney").first()
    if row is None:
        raise SystemExit("no indmoney account found")
    return row


async def _probe_native_websockets(access_token: str, ws_token: str) -> dict[str, Any]:
    out: dict[str, Any] = {}
    headers = {"Authorization": access_token}
    try:
        async with websockets.connect(
            "wss://ws-prices.indstocks.com/api/v1/ws/prices",
            additional_headers=headers,
            open_timeout=15,
            close_timeout=5,
        ) as ws:
            await ws.send(
                json.dumps(
                    {
                        "action": "subscribe",
                        "mode": "ltp",
                        "instruments": [ws_token],
                    }
                )
            )
            try:
                message = await asyncio.wait_for(ws.recv(), timeout=8)
                out["price_ws"] = {"ok": True, "summary": str(message)[:500]}
            except asyncio.TimeoutError:
                out["price_ws"] = {
                    "ok": True,
                    "summary": "connected and subscribed; no price event arrived within timeout",
                }
    except Exception as exc:
        out["price_ws"] = {"ok": False, "summary": repr(exc)}

    try:
        async with websockets.connect(
            "wss://ws-order-updates.indstocks.com/api/v1/ws/trades",
            additional_headers=headers,
            open_timeout=15,
            close_timeout=5,
        ) as ws:
            await ws.send(json.dumps({"action": "subscribe", "mode": "order_updates"}))
            try:
                message = await asyncio.wait_for(ws.recv(), timeout=5)
                out["order_ws"] = {"ok": True, "summary": str(message)[:500]}
            except asyncio.TimeoutError:
                out["order_ws"] = {
                    "ok": True,
                    "summary": "connected and subscribed; no order update arrived within timeout",
                }
    except Exception as exc:
        out["order_ws"] = {"ok": False, "summary": repr(exc)}
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description="Run a live INDmoney broker validation using stored DB credentials.")
    parser.add_argument("--account-id", default=None)
    parser.add_argument("--symbol", default="RELIANCE")
    parser.add_argument("--exchange", default="NSE")
    parser.add_argument("--output", default=None, help="Optional JSON file path for the validation summary.")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        account = _choose_account(db, args.account_id)
        client = get_client_for_account(account, resolver=SQLiteInstrumentResolver(db, account.broker_code))

        instruments = client.sync_instruments()
        instrument = next(
            (
                row
                for row in instruments
                if str(row.get("symbol")).upper() == args.symbol.upper()
                and str(row.get("exchange")).upper() == args.exchange.upper()
            ),
            None,
        )
        if instrument is None:
            raise SystemExit(f"instrument {args.exchange}:{args.symbol} not found in INDmoney instrument master")

        now = datetime.now(tz=timezone.utc)
        one_day_ago = now - timedelta(days=1)
        probe_results: dict[str, Any] = {}

        calls = [
            ("verify_connection", client.verify_connection),
            ("user_profile", client.user_profile),
            ("funds", client.funds),
            ("order_book", client.order_book),
            ("trade_book", client.trade_book),
            ("positions", client.positions),
            ("holdings", client.holdings),
            ("quotes", lambda: client.fetch_quotes([instrument])),
            (
                "historical",
                lambda: client.fetch_historical(
                    {
                        "instrument": instrument,
                        "interval": "1minute",
                        "from_date": one_day_ago,
                        "to_date": now,
                    }
                ),
            ),
            (
                "margin",
                lambda: client.calculate_margin(
                    [
                        {
                            "indmoney_scrip_code": instrument.get("indmoney_scrip_code"),
                            "exchange": instrument.get("exchange"),
                            "action": "BUY",
                            "quantity": 1,
                            "price": int(float(client.fetch_quotes([instrument])[0]["ltp"]) or 1),
                            "product": "CNC",
                        }
                    ]
                ),
            ),
        ]

        for name, fn in calls:
            try:
                result = fn()
                probe_results[name] = {"ok": True, "summary": _truncate(result)}
            except Exception as exc:
                probe_results[name] = {"ok": False, "summary": repr(exc)}

        ws_token = str(instrument["indmoney_scrip_code"]).replace("_", ":")
        probe_results.update(asyncio.run(_probe_native_websockets(client.access_token, ws_token)))

        payload = {
            "validated_at": now.isoformat(),
            "account_id": account.id,
            "broker_code": account.broker_code,
            "instrument": {
                "symbol": instrument.get("symbol"),
                "exchange": instrument.get("exchange"),
                "segment": instrument.get("segment"),
                "indmoney_scrip_code": instrument.get("indmoney_scrip_code"),
            },
            "results": probe_results,
        }

        rendered = json.dumps(payload, indent=2)
        if args.output:
            path = Path(args.output)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(rendered + "\n", encoding="utf-8")
        print(rendered)
    finally:
        db.close()


if __name__ == "__main__":
    main()
