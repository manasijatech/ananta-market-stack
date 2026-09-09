from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.v1 import broker_chat
from app.schemas.broker_chat import BrokerChatSubmitIn
from app.services import broker_chat as chat_svc
from db.models import User
from db.session import Base, get_db


def _db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def _submit(message: str, *, session_id: str | None = None, adaptive: bool = True) -> BrokerChatSubmitIn:
    return BrokerChatSubmitIn(
        message=message,
        session_id=session_id,
        provider="openai",
        model="gpt-4o-mini",
        metadata={"adaptive_workspace": True, "workspace_spec": {"version": 1, "components": []}} if adaptive else {},
    )


def test_submit_while_running_queues_follow_up_without_rq(monkeypatch):
    db = _db()
    enqueued: list[str] = []
    monkeypatch.setattr(chat_svc, "enqueue_broker_chat_run", lambda run_id: enqueued.append(run_id) or f"job-{run_id}")

    first = chat_svc.create_run(db, "user-1", _submit("Fetch peers"))
    first.status = "running"
    db.add(first)
    db.commit()

    second = chat_svc.create_run(db, "user-1", _submit("Also check margins", session_id=first.session_id))

    assert second.status == "queued"
    assert second.job_id is None
    assert enqueued == [first.id]
    assert chat_svc.queue_position_for_run(db, second) == 1
    meta = chat_svc.json_loads(second.metadata_json, {})
    assert meta.get("session_queue") is True
    assert meta.get("spec_at_enqueue") == {"version": 1, "components": []}


def test_terminal_run_starts_next_queued_exactly_once(monkeypatch):
    db = _db()
    enqueued: list[str] = []
    jobs: dict[str, str] = {}

    def _enqueue(run_id: str) -> str:
        if run_id not in jobs:
            enqueued.append(run_id)
            jobs[run_id] = f"job-{run_id}"
        return jobs[run_id]

    monkeypatch.setattr(chat_svc, "enqueue_broker_chat_run", _enqueue)
    monkeypatch.setattr(chat_svc, "ensure_broker_chat_job_queued", _enqueue)

    first = chat_svc.create_run(db, "user-1", _submit("A"))
    first.status = "running"
    db.add(first)
    db.commit()
    second = chat_svc.create_run(db, "user-1", _submit("B", session_id=first.session_id))
    assert second.job_id is None

    chat_svc.mark_run_terminal(db, first, status="completed", response_text="done")
    db.refresh(second)

    assert enqueued.count(second.id) == 1
    assert second.job_id == f"job-{second.id}"

    again = chat_svc.start_next_queued_run(db, first.session_id)
    assert again is None or again.id == second.id
    assert enqueued.count(second.id) == 1


def test_cancel_queued_keeps_later_items_and_running_cancel_starts_next(monkeypatch):
    db = _db()
    enqueued: list[str] = []
    monkeypatch.setattr(chat_svc, "enqueue_broker_chat_run", lambda run_id: enqueued.append(run_id) or f"job-{run_id}")
    monkeypatch.setattr(chat_svc, "ensure_broker_chat_job_queued", lambda run_id: enqueued.append(run_id) or f"job-{run_id}")
    monkeypatch.setattr(chat_svc, "request_broker_chat_cancel", lambda run_id: None)
    monkeypatch.setattr(chat_svc, "cancel_broker_chat_job", lambda run_id: True)
    monkeypatch.setattr(chat_svc, "clear_broker_chat_cancel", lambda run_id: None)

    first = chat_svc.create_run(db, "user-1", _submit("A"))
    first.status = "running"
    db.add(first)
    db.commit()
    second = chat_svc.create_run(db, "user-1", _submit("B", session_id=first.session_id))
    third = chat_svc.create_run(db, "user-1", _submit("C", session_id=first.session_id))

    chat_svc.cancel_run(db, "user-1", second.id)
    db.refresh(second)
    db.refresh(third)
    assert second.status == "cancelled"
    assert third.status == "queued"
    assert third.job_id is None

    chat_svc.cancel_run(db, "user-1", first.id)
    db.refresh(third)
    assert third.job_id == f"job-{third.id}"
    assert enqueued.count(third.id) == 1


def test_two_sessions_queue_independently(monkeypatch):
    db = _db()
    enqueued: list[str] = []
    monkeypatch.setattr(chat_svc, "enqueue_broker_chat_run", lambda run_id: enqueued.append(run_id) or f"job-{run_id}")

    a1 = chat_svc.create_run(db, "user-1", _submit("Session A"))
    b1 = chat_svc.create_run(db, "user-1", _submit("Session B"))
    a1.status = "running"
    b1.status = "running"
    db.add(a1)
    db.add(b1)
    db.commit()

    a2 = chat_svc.create_run(db, "user-1", _submit("Follow A", session_id=a1.session_id))
    b2 = chat_svc.create_run(db, "user-1", _submit("Follow B", session_id=b1.session_id))

    assert {a1.id, b1.id} == set(enqueued)
    assert a2.job_id is None and b2.job_id is None
    assert a2.session_id != b2.session_id


def test_reconcile_enqueues_only_one_per_session(monkeypatch):
    db = _db()
    enqueued: list[str] = []
    monkeypatch.setattr(chat_svc, "enqueue_broker_chat_run", lambda run_id: enqueued.append(run_id) or f"job-{run_id}")
    monkeypatch.setattr(chat_svc, "ensure_broker_chat_job_queued", lambda run_id: enqueued.append(run_id) or f"job-{run_id}")
    monkeypatch.setattr(chat_svc, "broker_chat_job_status", lambda run_id: None)

    first = chat_svc.create_run(db, "user-1", _submit("A"))
    first.status = "running"
    db.add(first)
    db.commit()
    second = chat_svc.create_run(db, "user-1", _submit("B", session_id=first.session_id))
    third = chat_svc.create_run(db, "user-1", _submit("C", session_id=first.session_id))
    enqueued.clear()

    result = chat_svc.reconcile_incomplete_runs(db)
    db.refresh(first)
    db.refresh(second)
    db.refresh(third)

    assert result["running_reset"] == 1
    assert first.status == "queued"
    assert enqueued == [first.id]
    assert second.job_id is None
    assert third.job_id is None


def test_strict_single_active_still_rejects(monkeypatch):
    db = _db()
    monkeypatch.setattr(chat_svc, "enqueue_broker_chat_run", lambda run_id: f"job-{run_id}")
    first = chat_svc.create_run(db, "user-1", _submit("A"))
    first.status = "running"
    db.add(first)
    db.commit()

    try:
        chat_svc.create_run(
            db,
            "user-1",
            _submit("B", session_id=first.session_id),
            strict_single_active=True,
        )
        raised = False
    except ValueError as exc:
        raised = True
        assert "already active" in str(exc)
    assert raised


def test_queue_list_and_cancel_queued_api(monkeypatch):
    db = _db()
    db.add(User(id="user-1", display_name="Trader"))
    db.commit()
    enqueued: list[str] = []
    monkeypatch.setattr(chat_svc, "enqueue_broker_chat_run", lambda run_id: enqueued.append(run_id) or f"job-{run_id}")
    monkeypatch.setattr(chat_svc, "ensure_broker_chat_job_queued", lambda run_id: enqueued.append(run_id) or f"job-{run_id}")
    monkeypatch.setattr(chat_svc, "request_broker_chat_cancel", lambda run_id: None)
    monkeypatch.setattr(chat_svc, "cancel_broker_chat_job", lambda run_id: True)
    monkeypatch.setattr(chat_svc, "clear_broker_chat_cancel", lambda run_id: None)

    first = chat_svc.create_run(db, "user-1", _submit("A"))
    first.status = "running"
    db.add(first)
    db.commit()
    second = chat_svc.create_run(db, "user-1", _submit("B", session_id=first.session_id))
    third = chat_svc.create_run(db, "user-1", _submit("C", session_id=first.session_id))

    test_app = FastAPI()
    test_app.include_router(broker_chat.router, prefix="/broker-chat")

    def _override_db():
        yield db

    test_app.dependency_overrides[get_db] = _override_db
    with TestClient(test_app) as client:
        queue = client.get(f"/broker-chat/sessions/{first.session_id}/queue", headers={"X-User-Id": "user-1"})
        assert queue.status_code == 200
        bodies = queue.json()
        assert [item["id"] for item in bodies] == [second.id, third.id]
        assert bodies[0]["queue_position"] == 1
        assert bodies[1]["queue_position"] == 2

        cancelled = client.post(
            f"/broker-chat/runs/{first.id}/cancel",
            params={"cancel_queued": "true"},
            headers={"X-User-Id": "user-1"},
        )
        assert cancelled.status_code == 200

    db.refresh(second)
    db.refresh(third)
    assert second.status == "cancelled"
    assert third.status == "cancelled"
    assert chat_svc.list_session_queue(db, "user-1", first.session_id) == []


def test_failed_run_still_starts_next(monkeypatch):
    db = _db()
    enqueued: list[str] = []
    monkeypatch.setattr(chat_svc, "enqueue_broker_chat_run", lambda run_id: enqueued.append(run_id) or f"job-{run_id}")
    monkeypatch.setattr(chat_svc, "ensure_broker_chat_job_queued", lambda run_id: enqueued.append(run_id) or f"job-{run_id}")

    first = chat_svc.create_run(db, "user-1", _submit("A"))
    first.status = "running"
    db.add(first)
    db.commit()
    second = chat_svc.create_run(db, "user-1", _submit("B", session_id=first.session_id))
    chat_svc.mark_run_terminal(db, first, status="failed", response_text="", error="provider down")
    db.refresh(second)
    assert second.job_id == f"job-{second.id}"
