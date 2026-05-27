from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.v1 import alert_workflow_chat
from app.main import app
from app.schemas.alert import AlertCondition, AlertGraphDsl, AlertWorkflowCreate, AlertWorkflowDsl
from app.schemas.alert_workflow_chat import AlertWorkflowChatSessionCreateIn
from app.services.alert_workflow_chat import sessions as chat_sessions
from app.services.alert_workflow_chat import snapshots as chat_snapshots
from app.services.alert_workflow_chat.queue import (
    alert_workflow_chat_cancel_key,
    alert_workflow_chat_job_id,
    alert_workflow_chat_stream_key,
)
from app.services.broker_chat_queue import broker_chat_stream_key
from db.models import AlertWorkflow, LiveSymbolSubscription
from db.session import Base


def _db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    return Session()


def _workflow_create(name: str = "AI draft") -> AlertWorkflowCreate:
    return AlertWorkflowCreate(
        name=name,
        description="Draft from test",
        symbol="RELIANCE",
        exchange="NSE",
        workflow_dsl=AlertWorkflowDsl(
            workflow_type="market_data",
            combine="all",
            conditions=[AlertCondition(field="ltp", operator="gte", value=100)],
        ),
        graph_dsl=AlertGraphDsl(),
        editor_mode="rule",
    )


def test_alert_workflow_chat_routes_are_registered_with_testclient_context():
    test_app = FastAPI()
    test_app.include_router(alert_workflow_chat.router, prefix="/alert-workflow-chat")

    with TestClient(test_app) as client:
        paths = {getattr(route, "path", "") for route in client.app.routes}

    assert "/alert-workflow-chat/config" in paths
    assert "/alert-workflow-chat/sessions" in paths
    assert "/alert-workflow-chat/runs/{run_id}/stream" in paths
    assert "/alert-workflow-chat/snapshots/{snapshot_id}/apply" in paths


def test_alert_workflow_chat_routes_are_mounted_under_api_v1():
    paths = {getattr(route, "path", "") for route in app.routes}

    assert "/api/v1/alert-workflow-chat/config" in paths
    assert "/api/v1/alert-workflow-chat/runs" in paths
    assert "/api/v1/alert-workflow-chat/runs/{run_id}/events" in paths
    assert "/api/v1/alert-workflow-chat/queue/health" in paths


def test_alert_workflow_chat_queue_keys_do_not_collide_with_broker_chat():
    assert broker_chat_stream_key("run-1") == "broker-chat:run:run-1:events"
    assert alert_workflow_chat_stream_key("run-1") == "alert-workflow-chat:run:run-1:events"
    assert alert_workflow_chat_cancel_key("run-1") == "alert-workflow-chat:run:run-1:cancel"
    assert alert_workflow_chat_job_id("run-1").startswith("alert-workflow-chat-")


def test_draft_session_creates_draft_workflow_without_live_subscriptions():
    db = _db_session()

    session = chat_sessions.create_session(
        db,
        "user-1",
        AlertWorkflowChatSessionCreateIn(title="Draft chat", draft_workflow=_workflow_create()),
    )

    workflow = db.get(AlertWorkflow, session.workflow_id)
    assert workflow is not None
    assert workflow.status == "draft"
    assert workflow.deployment_status == "draft"
    assert db.query(LiveSymbolSubscription).count() == 0


def test_snapshot_creation_rejects_invalid_dsl_proposal():
    db = _db_session()
    session = chat_sessions.create_session(
        db,
        "user-1",
        AlertWorkflowChatSessionCreateIn(title="Draft chat", draft_workflow=_workflow_create()),
    )
    workflow_out = chat_sessions.session_to_schema(db, session).workflow
    assert workflow_out is not None
    payload = chat_snapshots.workflow_out_payload(workflow_out)
    payload["workflow_dsl"]["dsl_text"] = "unknown_func(ltp, value=1)"

    snapshot = chat_snapshots.create_snapshot(
        db,
        session=session,
        user_id="user-1",
        workflow_id=session.workflow_id,
        workflow_payload=payload,
        label="Invalid DSL",
    )

    assert snapshot.valid is False
    validation = chat_snapshots.snapshot_to_schema(snapshot).validation
    assert validation["valid"] is False
    assert validation["errors"]


def test_applying_valid_snapshot_updates_workflow_without_deploying():
    db = _db_session()
    session = chat_sessions.create_session(
        db,
        "user-1",
        AlertWorkflowChatSessionCreateIn(title="Draft chat", draft_workflow=_workflow_create("Before")),
    )
    workflow_out = chat_sessions.session_to_schema(db, session).workflow
    assert workflow_out is not None
    payload = chat_snapshots.workflow_out_payload(workflow_out)
    payload["name"] = "After"
    payload["status"] = "active"

    snapshot = chat_snapshots.create_snapshot(
        db,
        session=session,
        user_id="user-1",
        workflow_id=session.workflow_id,
        workflow_payload=payload,
        label="Rename workflow",
    )
    applied_snapshot, applied_workflow = chat_snapshots.apply_snapshot(db, "user-1", snapshot.id)
    workflow = db.get(AlertWorkflow, session.workflow_id)

    assert applied_snapshot.valid is True
    assert applied_workflow.name == "After"
    assert workflow is not None
    assert workflow.name == "After"
    assert workflow.status == "draft"
    assert workflow.deployment_status in {"draft", "validated"}
    assert db.query(LiveSymbolSubscription).count() == 0
