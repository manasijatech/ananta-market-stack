from __future__ import annotations

import json
from datetime import datetime

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.schemas.alert import (
    AlertCondition,
    AlertFeedTriggerConfig,
    AlertLlmAnalysisConfig,
    AlertNotificationConfig,
    AlertWorkflowDsl,
)
from app.services import alerts as alert_svc
from app.services import alert_runtime
from app.services.alerts_engine.dsl_normalize import broker_trigger_enabled, feed_trigger_enabled
from app.services.alerts_engine.reconcile import build_desired_subscriptions
from db.models import AlertWorkflow, AlphaWebSocketEvent, User
from db.session import Base


def _db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def _add_user(db, user_id: str = "u1") -> None:
    db.add(User(id=user_id, display_name=user_id))
    db.commit()


def _workflow_row(
    db,
    *,
    workflow_id: str,
    dsl: AlertWorkflowDsl,
    status: str = "active",
) -> AlertWorkflow:
    row = AlertWorkflow(
        id=workflow_id,
        user_id="u1",
        name=workflow_id,
        description="",
        symbol="TCS",
        exchange="NSE",
        workflow_dsl_json=json.dumps(dsl.model_dump()),
        graph_dsl_json="{}",
        status=status,
        deployment_status="validated",
    )
    db.add(row)
    db.commit()
    return row


def test_reconcile_skips_feed_only_workflows():
    db = _db()
    _add_user(db)
    _workflow_row(
        db,
        workflow_id="feed-only",
        dsl=AlertWorkflowDsl(
            workflow_type="alert",
            broker_trigger={"enabled": False},
            feed_trigger=AlertFeedTriggerConfig(enabled=True, products=["news"], source_scope="full_market"),
            conditions=[AlertCondition(field="event", operator="always")],
        ),
    )
    desired = build_desired_subscriptions(db, "u1")
    assert all(item.workflow_id != "feed-only" for item in desired)


def test_feed_worker_accepts_unified_alert_type(monkeypatch):
    db = _db()
    _add_user(db)
    _workflow_row(
        db,
        workflow_id="unified-feed",
        dsl=AlertWorkflowDsl(
            workflow_type="alert",
            broker_trigger={"enabled": False},
            feed_trigger=AlertFeedTriggerConfig(
                enabled=True,
                products=["news"],
                source_scope="full_market",
                condition_prompt="",
            ),
            conditions=[AlertCondition(field="event", operator="always")],
            notification=AlertNotificationConfig(
                title_template="{symbol} feed",
                message_template="{symbol} {feed_trigger_reason}",
            ),
            cooldown_seconds=0,
        ),
    )
    event = AlphaWebSocketEvent(
        id="evt-unified",
        user_id="u1",
        product="news",
        symbol="TCS",
        event_key="evt-unified:news:tcs",
        payload_json=json.dumps({"symbol": "TCS", "headline": "Order win"}),
        received_at=datetime.utcnow(),
    )
    db.add(event)
    db.commit()

    from db.models import AlertWorkflowRun

    runs_before = db.query(AlertWorkflowRun).count()
    monkeypatch.setattr(alert_runtime, "run_feed_trigger_batches", lambda *a, **k: {})
    alert_runtime._process_alpha_feed_event(db, event)
    assert db.query(AlertWorkflowRun).count() > runs_before


def test_broker_active_helper_respects_trigger_flags():
    class _Workflow:
        def __init__(self, dsl: AlertWorkflowDsl):
            self.workflow_dsl = dsl
            self.broker_code = "zerodha"

    broker_on = _Workflow(
        AlertWorkflowDsl(
            workflow_type="alert",
            broker_trigger={"enabled": True},
            conditions=[AlertCondition(field="ltp", operator="gte", value=1)],
            active_period={"enabled": False},
        )
    )
    feed_on = _Workflow(
        AlertWorkflowDsl(
            workflow_type="alert",
            broker_trigger={"enabled": False},
            feed_trigger=AlertFeedTriggerConfig(enabled=True, products=["news"], source_scope="full_market"),
            conditions=[AlertCondition(field="event", operator="always")],
            active_period={"enabled": False},
        )
    )
    assert broker_trigger_enabled(broker_on.workflow_dsl) is True
    assert feed_trigger_enabled(broker_on.workflow_dsl) is False
    active, details = alert_runtime._workflow_active_for_tick(
        object(), feed_on, {"symbol": "TCS", "exchange": "NSE"}
    )
    assert active is False
    assert details["reason"] == "broker market-data trigger disabled"
    original = alert_runtime._instrument_scope_for_tick
    alert_runtime._instrument_scope_for_tick = lambda db, workflow, tick: {
        "symbol": "TCS",
        "exchange": "NSE",
    }
    try:
        broker_active, broker_details = alert_runtime._workflow_active_for_tick(
            object(), broker_on, {"symbol": "TCS", "exchange": "NSE", "broker_code": "zerodha"}
        )
    finally:
        alert_runtime._instrument_scope_for_tick = original
    assert broker_details["reason"] != "broker market-data trigger disabled"
    assert broker_active is True
    assert feed_trigger_enabled(feed_on.workflow_dsl) is True


def test_assess_readiness_warns_when_drishti_missing_for_feed():
    db = _db()
    _add_user(db)
    dsl = AlertWorkflowDsl(
        workflow_type="alert",
        broker_trigger={"enabled": False},
        feed_trigger=AlertFeedTriggerConfig(enabled=True, products=["news"], source_scope="full_market"),
        conditions=[AlertCondition(field="event", operator="always")],
        llm_analysis=AlertLlmAnalysisConfig(
            enabled=True,
            prompt_template="News: @news(days=1, max_pages=1, max_items=1)",
        ),
    )
    readiness = alert_svc.assess_workflow_trigger_readiness(db, "u1", dsl)
    assert readiness["feed_enabled"] is True
    assert readiness["feed_ready"] is False
    assert readiness["any_source_ready"] is False
    assert readiness["warnings"]
