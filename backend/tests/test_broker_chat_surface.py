from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.v1 import broker_chat
from app.main import app
from app.schemas.broker_chat import BrokerChatSubmitIn
from app.services import broker_chat as chat_svc
from db.models import BrokerChatSession, User
from db.session import Base, get_db


def _db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def _submit(
    message: str = "Show holdings",
    *,
    session_id: str | None = None,
    adaptive: bool = False,
    session_title: str | None = None,
) -> BrokerChatSubmitIn:
    metadata = {"adaptive_workspace": True} if adaptive else {}
    return BrokerChatSubmitIn(
        message=message,
        session_id=session_id,
        session_title=session_title,
        provider="openai",
        model="gpt-4o-mini",
        metadata=metadata,
    )


def test_create_session_defaults_to_broker_chat():
    db = _db()
    session = chat_svc.create_session(db, "user-1", "Morning review")

    assert session.surface == "broker_chat"


def test_create_session_adaptive_workspace():
    db = _db()
    session = chat_svc.create_session(db, "user-1", "Adaptive workspace", surface="adaptive_workspace")

    assert session.surface == "adaptive_workspace"


def test_list_sessions_default_excludes_adaptive():
    db = _db()
    broker = chat_svc.create_session(db, "user-1", "Broker desk")
    chat_svc.create_session(db, "user-1", "Adaptive workspace", surface="adaptive_workspace")

    listed = chat_svc.list_sessions(db, "user-1")

    assert [item.id for item in listed] == [broker.id]
    assert all(item.surface == "broker_chat" for item in listed)


def test_list_sessions_adaptive_excludes_broker_chat():
    db = _db()
    chat_svc.create_session(db, "user-1", "Broker desk")
    adaptive = chat_svc.create_session(db, "user-1", "Adaptive workspace", surface="adaptive_workspace")

    listed = chat_svc.list_sessions(db, "user-1", surface="adaptive_workspace")

    assert [item.id for item in listed] == [adaptive.id]
    assert all(item.surface == "adaptive_workspace" for item in listed)


def test_submit_adaptive_metadata_creates_adaptive_session(monkeypatch):
    db = _db()
    monkeypatch.setattr(chat_svc, "enqueue_broker_chat_run", lambda run_id: "job-1")

    run = chat_svc.create_run(db, "user-1", _submit(adaptive=True, session_title="Adaptive workspace"))
    session = db.get(BrokerChatSession, run.session_id)

    assert session is not None
    assert session.surface == "adaptive_workspace"
    listed = chat_svc.list_sessions(db, "user-1")
    assert listed == []


def test_submit_adaptive_metadata_onto_broker_chat_session_raises():
    db = _db()
    session = chat_svc.create_session(db, "user-1", "Broker desk")

    with pytest.raises(ValueError, match="this session belongs to Broker Chat"):
        chat_svc.create_run(db, "user-1", _submit(session_id=session.id, adaptive=True))


def test_submit_without_adaptive_metadata_onto_adaptive_session_raises():
    db = _db()
    session = chat_svc.create_session(db, "user-1", "Adaptive workspace", surface="adaptive_workspace")

    with pytest.raises(ValueError, match="this session belongs to Adaptive Workspace"):
        chat_svc.create_run(db, "user-1", _submit(session_id=session.id, adaptive=False))


def test_list_runs_can_filter_by_session_surface(monkeypatch):
    db = _db()
    monkeypatch.setattr(chat_svc, "enqueue_broker_chat_run", lambda run_id: "job-1")
    broker_session = chat_svc.create_session(db, "user-1", "Broker desk")
    adaptive_run = chat_svc.create_run(db, "user-1", _submit(adaptive=True))
    broker_run = chat_svc.create_run(db, "user-1", _submit(session_id=broker_session.id))

    adaptive_only = chat_svc.list_runs(db, "user-1", surface="adaptive_workspace")
    broker_only = chat_svc.list_runs(db, "user-1", surface="broker_chat")

    assert [item.id for item in adaptive_only] == [adaptive_run.id]
    assert [item.id for item in broker_only] == [broker_run.id]


def test_get_sessions_without_query_returns_only_broker_chat():
    db = _db()
    db.add(User(id="user-1", display_name="Trader"))
    db.commit()
    broker = chat_svc.create_session(db, "user-1", "Broker desk")
    chat_svc.create_session(db, "user-1", "Adaptive workspace", surface="adaptive_workspace")

    test_app = FastAPI()
    test_app.include_router(broker_chat.router, prefix="/broker-chat")

    def _override_db():
        yield db

    test_app.dependency_overrides[get_db] = _override_db
    with TestClient(test_app) as client:
        response = client.get("/broker-chat/sessions", headers={"X-User-Id": "user-1"})

    assert response.status_code == 200
    bodies = response.json()
    assert [item["id"] for item in bodies] == [broker.id]
    assert all(item["surface"] == "broker_chat" for item in bodies)


def test_sessions_list_openapi_defaults_surface_to_broker_chat():
    params = app.openapi()["paths"]["/api/v1/broker-chat/sessions"]["get"]["parameters"]
    surface = next(item for item in params if item["name"] == "surface")
    assert surface["schema"]["default"] == "broker_chat"


def test_runs_list_openapi_defaults_surface_to_broker_chat():
    params = app.openapi()["paths"]["/api/v1/broker-chat/runs"]["get"]["parameters"]
    surface = next(item for item in params if item["name"] == "surface")
    assert surface["schema"]["default"] == "broker_chat"


def test_submit_wrong_surface_returns_http_400():
    db = _db()
    db.add(User(id="user-1", display_name="Trader"))
    db.commit()
    session = chat_svc.create_session(db, "user-1", "Broker desk")

    test_app = FastAPI()
    test_app.include_router(broker_chat.router, prefix="/broker-chat")

    def _override_db():
        yield db

    test_app.dependency_overrides[get_db] = _override_db
    with TestClient(test_app) as client:
        response = client.post(
            "/broker-chat/runs",
            headers={"X-User-Id": "user-1"},
            json={
                "message": "compose a desk",
                "session_id": session.id,
                "provider": "openai",
                "model": "gpt-4o-mini",
                "metadata": {"adaptive_workspace": True},
            },
        )

    assert response.status_code == 400
    assert response.json()["detail"] == "this session belongs to Broker Chat"


def test_backfill_marks_adaptive_sessions_from_metadata_title_and_snapshots():
    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                CREATE TABLE broker_chat_sessions (
                    id VARCHAR(36) PRIMARY KEY,
                    user_id VARCHAR(36),
                    title VARCHAR(256),
                    surface VARCHAR(32) NOT NULL DEFAULT 'broker_chat'
                )
                """
            )
        )
        conn.execute(
            text(
                """
                CREATE TABLE broker_chat_runs (
                    id VARCHAR(36) PRIMARY KEY,
                    session_id VARCHAR(36),
                    metadata_json TEXT
                )
                """
            )
        )
        conn.execute(
            text(
                """
                CREATE TABLE adaptive_workspace_snapshots (
                    id VARCHAR(36) PRIMARY KEY,
                    session_id VARCHAR(36)
                )
                """
            )
        )
        conn.execute(
            text(
                "INSERT INTO broker_chat_sessions (id, user_id, title) VALUES "
                "('s-meta', 'u1', 'Holdings'), "
                "('s-title', 'u1', 'Adaptive workspace'), "
                "('s-snap', 'u1', 'Desk'), "
                "('s-plain', 'u1', 'Broker chat')"
            )
        )
        conn.execute(
            text(
                "INSERT INTO broker_chat_runs (id, session_id, metadata_json) VALUES "
                "(:id, :session_id, :metadata_json)"
            ),
            {
                "id": "r1",
                "session_id": "s-meta",
                "metadata_json": '{"adaptive_workspace":true}',
            },
        )
        conn.execute(
            text(
                "INSERT INTO broker_chat_runs (id, session_id, metadata_json) VALUES "
                "(:id, :session_id, :metadata_json)"
            ),
            {"id": "r2", "session_id": "s-plain", "metadata_json": "{}"},
        )
        conn.execute(text("INSERT INTO adaptive_workspace_snapshots (id, session_id) VALUES ('snap1', 's-snap')"))

        module_path = Path(__file__).resolve().parents[1] / "alembic/versions/c8d2f1a6b047_broker_chat_session_surface.py"
        spec_ns: dict[str, object] = {}
        exec(module_path.read_text(), spec_ns)
        spec_ns["backfill_broker_chat_session_surfaces"](conn)

        rows = {
            row[0]: row[1]
            for row in conn.execute(text("SELECT id, surface FROM broker_chat_sessions")).fetchall()
        }

    assert rows["s-meta"] == "adaptive_workspace"
    assert rows["s-title"] == "adaptive_workspace"
    assert rows["s-snap"] == "adaptive_workspace"
    assert rows["s-plain"] == "broker_chat"


def test_backfill_skips_missing_snapshots_table():
    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                CREATE TABLE broker_chat_sessions (
                    id VARCHAR(36) PRIMARY KEY,
                    title VARCHAR(256),
                    surface VARCHAR(32) NOT NULL DEFAULT 'broker_chat'
                )
                """
            )
        )
        conn.execute(
            text(
                """
                CREATE TABLE broker_chat_runs (
                    id VARCHAR(36) PRIMARY KEY,
                    session_id VARCHAR(36),
                    metadata_json TEXT DEFAULT '{}'
                )
                """
            )
        )
        conn.execute(text("INSERT INTO broker_chat_sessions (id, title) VALUES ('s1', 'Broker chat')"))
        module_path = Path(__file__).resolve().parents[1] / "alembic/versions/c8d2f1a6b047_broker_chat_session_surface.py"
        spec_ns: dict[str, object] = {}
        exec(module_path.read_text(), spec_ns)
        spec_ns["backfill_broker_chat_session_surfaces"](conn)
        surface = conn.execute(text("SELECT surface FROM broker_chat_sessions WHERE id = 's1'")).scalar_one()

    assert surface == "broker_chat"
