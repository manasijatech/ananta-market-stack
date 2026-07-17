from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.v1 import live_streams
from app.deps import get_db
from app.services import broker_data_preferences
from db.models import AlphaSymbolMetadataCache, AlphaWebSocketEvent, BrokerAccount, LiveSymbolSubscription, User
from db.session import Base


def _db_session():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    return Session()


def _test_client(db):
    app = FastAPI()
    app.include_router(live_streams.router, prefix="/live-streams")

    def _override_get_db():
        yield db

    app.dependency_overrides[get_db] = _override_get_db
    return TestClient(app)


def test_live_heatmap_returns_live_rows_with_metadata_and_alpha_events(monkeypatch):
    db = _db_session()
    db.add(User(id="user-1"))
    account = BrokerAccount(
        id="acc-1",
        user_id="user-1",
        broker_code="zerodha",
        label="Primary",
        is_active=True,
    )
    db.add(account)
    db.add(
        LiveSymbolSubscription(
            id="sub-1",
            user_id="user-1",
            account_id="acc-1",
            broker_code="zerodha",
            symbol="RELIANCE",
            exchange="NSE",
            source_kind="watchlist",
            status="active",
            health_status="ok",
            last_quote_json='{"symbol":"RELIANCE","ltp":2500,"detail":{"exchange":"NSE","raw":{"day_change":25,"day_change_perc":1.01,"ohlc":{"open":2480,"high":2510,"low":2470,"close":2475},"volume":12345}}}',
        )
    )
    db.add(
        AlphaSymbolMetadataCache(
            symbol="RELIANCE",
            company_name="Reliance Industries",
            logo="https://cdn.example/reliance.png",
            sector="Energy",
            basic_industry="Oil",
            industry="Integrated Oil & Gas",
            theme="Large Cap",
        )
    )
    db.add(
        AlphaWebSocketEvent(
            id="evt-1",
            user_id="user-1",
            product="news",
            symbol="RELIANCE",
            event_key="news:1",
            payload_json='{"title":"Headline"}',
        )
    )
    db.commit()

    monkeypatch.setattr(broker_data_preferences, "_account_session_active", lambda acc: True)

    with _test_client(db) as client:
        response = client.get("/live-streams/heatmap?limit=5", headers={"X-User-Id": "user-1"})

    assert response.status_code == 200
    body = response.json()
    assert body["broker_code"] == "zerodha"
    assert body["returned_count"] == 1
    assert body["tracked_symbol_count"] == 1
    assert body["items"][0]["symbol"] == "RELIANCE"
    assert body["items"][0]["company_name"] == "Reliance Industries"
    assert body["items"][0]["logo"] == "https://cdn.example/reliance.png"
    assert body["items"][0]["ltp"] == 2500.0
    assert body["items"][0]["day_change_perc"] == 1.01
    assert body["items"][0]["alpha_event_summary"]["total_count"] == 1
    assert body["items"][0]["alpha_event_summary"]["tags"] == [{"tag": "news", "count": 1}]
    assert body["items"][0]["alpha_events"][0]["product"] == "news"


def test_live_heatmap_uses_effective_default_account_and_respects_days_filter(monkeypatch):
    db = _db_session()
    db.add(User(id="user-1"))
    primary = BrokerAccount(
        id="acc-1",
        user_id="user-1",
        broker_code="zerodha",
        label="Primary",
        is_active=True,
    )
    secondary = BrokerAccount(
        id="acc-2",
        user_id="user-1",
        broker_code="upstox",
        label="Secondary",
        is_active=True,
    )
    db.add(primary)
    db.add(secondary)
    db.add_all(
        [
            LiveSymbolSubscription(
                id="sub-1",
                user_id="user-1",
                account_id="acc-1",
                broker_code="zerodha",
                symbol="TCS",
                exchange="NSE",
                source_kind="workflow",
                status="active",
                health_status="ok",
                last_quote_json='{"symbol":"TCS","ltp":3500,"detail":{"exchange":"NSE","raw":{"day_change_perc":2.5,"ohlc":{"close":3414.63}}}}',
            ),
            LiveSymbolSubscription(
                id="sub-2",
                user_id="user-1",
                account_id="acc-2",
                broker_code="upstox",
                symbol="INFY",
                exchange="NSE",
                source_kind="workflow",
                status="active",
                health_status="ok",
                last_quote_json='{"symbol":"INFY","ltp":1500,"detail":{"exchange":"NSE","raw":{"day_change_perc":1.1}}}',
            ),
        ]
    )
    db.add(
        AlphaWebSocketEvent(
            id="evt-1",
            user_id="user-1",
            product="announcements",
            symbol="TCS",
            event_key="ann:1",
            payload_json='{"title":"Recent"}',
        )
    )
    db.commit()

    monkeypatch.setattr(
        broker_data_preferences,
        "_account_session_active",
        lambda acc: acc.id == "acc-1",
    )

    with _test_client(db) as client:
        response = client.get("/live-streams/heatmap?limit=10&days=3", headers={"X-User-Id": "user-1"})

    assert response.status_code == 200
    body = response.json()
    assert body["account_id"] == "acc-1"
    assert body["broker_code"] == "zerodha"
    assert body["returned_count"] == 1
    assert body["items"][0]["symbol"] == "TCS"
    assert body["items"][0]["alpha_event_summary"]["total_count"] == 1
