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
from app.services import alert_runtime
from db.models import AlphaWebSocketEvent, AlertWorkflow, AlertWorkflowRun, User, UserAlertNotification, UserLlmModel
from db.session import Base


class _Message:
    def __init__(self, content: str):
        self.content = content


class _Choice:
    def __init__(self, content: str):
        self.message = _Message(content)


class _Response:
    def __init__(self, content: str, model: str = "test-model"):
        self.id = f"resp-{abs(hash(content))}"
        self.model = model
        self.choices = [_Choice(content)]
        self.usage = {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}


def _db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    return session_factory()


def _add_user_model(db, provider: str, model_id: str) -> None:
    db.add(
        UserLlmModel(
            id=f"model-{provider}-{model_id}",
            user_id="u1",
            provider=provider,
            model_id=model_id,
            label=model_id,
            is_enabled=True,
        )
    )


def _add_workflow(
    db,
    workflow_id: str,
    prompt: str,
    *,
    provider: str = "openai",
    model_id: str = "gpt-test",
    products: list[str] | None = None,
    last_triggered_at: datetime | None = None,
    llm_analysis: bool = False,
    market_cap_filter: dict[str, object] | None = None,
) -> AlertWorkflow:
    dsl = AlertWorkflowDsl(
        workflow_type="alpha_feed",
        conditions=[AlertCondition(field="event", operator="always")],
        notification=AlertNotificationConfig(
            title_template="{symbol} feed match",
            message_template="{symbol} matched: {feed_trigger_reason}",
        ),
        feed_trigger=AlertFeedTriggerConfig(
            enabled=True,
            products=products or ["news"],
            condition_prompt=prompt,
            source_scope="full_market",
            provider=provider,
            model_id=model_id,
        ),
        llm_analysis=AlertLlmAnalysisConfig(
            enabled=llm_analysis,
            provider=provider,
            model_id=model_id,
            prompt_template="Analyze @trigger.reason for {symbol}. Details @trigger.details",
        ),
        market_cap_filter=market_cap_filter or {"mode": "all"},
    )
    row = AlertWorkflow(
        id=workflow_id,
        user_id="u1",
        name=f"Workflow {workflow_id}",
        description="",
        symbol="TCS",
        exchange="NSE",
        workflow_dsl_json=json.dumps(dsl.model_dump()),
        graph_dsl_json="{}",
        status="active",
        deployment_status="validated",
        last_triggered_at=last_triggered_at,
    )
    db.add(row)
    return row


def _add_event(db, event_id: str = "evt-1") -> AlphaWebSocketEvent:
    event = AlphaWebSocketEvent(
        id=event_id,
        user_id="u1",
        product="news",
        symbol="TCS",
        event_key=f"{event_id}:news:tcs",
        payload_json=json.dumps(
            {
                "symbol": "TCS",
                "headline": "TCS wins a large cloud transformation contract",
                "summary": "The company announced a multi-year customer mandate.",
            }
        ),
        received_at=datetime.utcnow(),
    )
    db.add(event)
    return event


def test_alpha_feed_event_batches_multiple_workflows_in_one_llm_call(monkeypatch):
    db = _db()
    calls = []

    def fake_generate_text(*args, **kwargs):
        calls.append(kwargs)
        workflow_ids = [item["workflow_id"] for item in json.loads(kwargs["user_text"])["workflow_cases"]]
        return _Response(
            json.dumps(
                {
                    "results": [
                        {
                            "workflow_id": workflow_id,
                            "matches": True,
                            "reason": f"{workflow_id} matched order-win context",
                            "confidence": 0.91,
                            "matched_terms": ["contract"],
                            "error": None,
                        }
                        for workflow_id in workflow_ids
                    ]
                }
            )
        )

    monkeypatch.setattr("app.services.alert_feed_batch.llm_gateway.generate_text", fake_generate_text)
    db.add(User(id="u1", display_name="User"))
    _add_user_model(db, "openai", "gpt-test")
    _add_workflow(db, "wf-1", "Order wins")
    _add_workflow(db, "wf-2", "Large deals")
    event = _add_event(db)
    db.commit()

    alert_runtime._process_alpha_feed_event(db, event)

    assert len(calls) == 1
    assert calls[0]["tracking"].request_kind == "workflow_feed_trigger_batch"
    runs = db.query(AlertWorkflowRun).order_by(AlertWorkflowRun.workflow_id).all()
    assert [run.workflow_id for run in runs] == ["wf-1", "wf-2"]
    assert all(run.matched for run in runs)
    assert all(json.loads(run.evaluation_payload_json)["batch"]["batch_size"] == 2 for run in runs)
    assert db.query(UserAlertNotification).count() == 2
    db.refresh(event)
    assert event.processed_at is not None
    db.close()


def test_alpha_feed_batches_are_split_by_model_provider(monkeypatch):
    db = _db()
    calls = []

    def fake_generate_text(*args, **kwargs):
        calls.append(kwargs)
        workflow_ids = [item["workflow_id"] for item in json.loads(kwargs["user_text"])["workflow_cases"]]
        return _Response(
            json.dumps(
                {
                    "results": [
                        {
                            "workflow_id": workflow_id,
                            "matches": False,
                            "reason": "not relevant",
                            "confidence": 0.2,
                            "matched_terms": [],
                            "error": None,
                        }
                        for workflow_id in workflow_ids
                    ]
                }
            )
        )

    monkeypatch.setattr("app.services.alert_feed_batch.llm_gateway.generate_text", fake_generate_text)
    db.add(User(id="u1", display_name="User"))
    _add_user_model(db, "openai", "gpt-test")
    _add_user_model(db, "gemini", "gemini-test")
    _add_workflow(db, "wf-openai", "Order wins", provider="openai", model_id="gpt-test")
    _add_workflow(db, "wf-gemini", "Order wins", provider="gemini", model_id="gemini-test")
    event = _add_event(db)
    db.commit()

    alert_runtime._process_alpha_feed_event(db, event)

    assert len(calls) == 2
    assert {call["model"] for call in calls} == {"gpt-test", "gemini-test"}
    assert db.query(AlertWorkflowRun).count() == 0
    db.refresh(event)
    assert event.processed_at is not None
    db.close()


def test_alpha_feed_prefilters_product_and_cooldown_before_batch(monkeypatch):
    db = _db()
    calls = []

    def fake_generate_text(*args, **kwargs):
        calls.append(kwargs)
        workflow_ids = [item["workflow_id"] for item in json.loads(kwargs["user_text"])["workflow_cases"]]
        return _Response(
            json.dumps(
                {
                    "results": [
                        {
                            "workflow_id": workflow_id,
                            "matches": False,
                            "reason": "not relevant",
                            "confidence": 0.1,
                            "matched_terms": [],
                            "error": None,
                        }
                        for workflow_id in workflow_ids
                    ]
                }
            )
        )

    monkeypatch.setattr("app.services.alert_feed_batch.llm_gateway.generate_text", fake_generate_text)
    db.add(User(id="u1", display_name="User"))
    _add_user_model(db, "openai", "gpt-test")
    _add_workflow(db, "wf-ok", "Order wins")
    _add_workflow(db, "wf-wrong-product", "Order wins", products=["announcements"])
    _add_workflow(db, "wf-cooldown", "Order wins", last_triggered_at=datetime.utcnow())
    event = _add_event(db)
    db.commit()

    alert_runtime._process_alpha_feed_event(db, event)

    assert len(calls) == 1
    cases = json.loads(calls[0]["user_text"])["workflow_cases"]
    assert [case["workflow_id"] for case in cases] == ["wf-ok"]
    assert calls[0]["tracking"].workflow_id == "wf-ok"
    assert calls[0]["tracking"].workflow_name == "Workflow wf-ok"
    db.close()


def test_alpha_feed_market_cap_filter_rejects_event_before_trigger_llm(monkeypatch):
    db = _db()
    calls = []

    def fake_generate_text(*args, **kwargs):
        calls.append(kwargs)
        return _Response(json.dumps({"results": []}))

    monkeypatch.setattr("app.services.alert_feed_batch.llm_gateway.generate_text", fake_generate_text)
    monkeypatch.setattr(
        "app.services.alert_market_cap.alpha_symbols.get_symbol_metadata",
        lambda db, user_id, symbols: [],
    )
    db.add(User(id="u1", display_name="User"))
    _add_user_model(db, "openai", "gpt-test")
    _add_workflow(
        db,
        "wf-market-cap",
        "Order wins",
        market_cap_filter={"mode": "custom", "min_value": 1000, "max_value": 5000},
    )
    event = _add_event(db)
    db.commit()

    alert_runtime._process_alpha_feed_event(db, event)

    assert calls == []
    assert db.query(AlertWorkflowRun).count() == 0
    db.refresh(event)
    assert event.processed_at is not None
    db.close()


def test_alpha_feed_partial_batch_output_records_error_without_blocking_success(monkeypatch):
    db = _db()

    def fake_generate_text(*args, **kwargs):
        return _Response(
            json.dumps(
                {
                    "results": [
                        {
                            "workflow_id": "wf-1",
                            "matches": True,
                            "reason": "contract award matched",
                            "confidence": 0.9,
                            "matched_terms": ["contract"],
                            "error": None,
                        }
                    ]
                }
            )
        )

    monkeypatch.setattr("app.services.alert_feed_batch.llm_gateway.generate_text", fake_generate_text)
    db.add(User(id="u1", display_name="User"))
    _add_user_model(db, "openai", "gpt-test")
    _add_workflow(db, "wf-1", "Order wins")
    _add_workflow(db, "wf-2", "Management changes")
    event = _add_event(db)
    db.commit()

    alert_runtime._process_alpha_feed_event(db, event)

    runs = db.query(AlertWorkflowRun).order_by(AlertWorkflowRun.workflow_id).all()
    assert len(runs) == 2
    assert runs[0].workflow_id == "wf-1"
    assert runs[0].matched is True
    assert runs[1].workflow_id == "wf-2"
    assert runs[1].matched is False
    assert "did not include this workflow_id" in runs[1].reason
    assert db.query(UserAlertNotification).count() == 1
    db.close()


def test_alpha_feed_followup_analysis_batches_only_matched_workflows(monkeypatch):
    db = _db()
    calls = []

    def fake_generate_text(*args, **kwargs):
        calls.append(kwargs)
        payload = json.loads(kwargs["user_text"])
        if "workflow_cases" in payload:
            return _Response(
                json.dumps(
                    {
                        "results": [
                            {
                                "workflow_id": "wf-match",
                                "matches": True,
                                "reason": "contract award matched",
                                "confidence": 0.9,
                                "matched_terms": ["contract"],
                                "error": None,
                            },
                            {
                                "workflow_id": "wf-skip",
                                "matches": False,
                                "reason": "not an earnings item",
                                "confidence": 0.1,
                                "matched_terms": [],
                                "error": None,
                            },
                        ]
                    }
                )
            )
        assert "analysis_cases" in payload
        assert [item["workflow_id"] for item in payload["analysis_cases"]] == ["wf-match"]
        return _Response(
            json.dumps(
                {
                    "results": [
                        {
                            "workflow_id": "wf-match",
                            "output": "The news is material because it confirms a customer contract.",
                            "error": None,
                        }
                    ]
                }
            )
        )

    monkeypatch.setattr("app.services.alert_feed_batch.llm_gateway.generate_text", fake_generate_text)
    db.add(User(id="u1", display_name="User"))
    _add_user_model(db, "openai", "gpt-test")
    _add_workflow(db, "wf-match", "Order wins", llm_analysis=True)
    _add_workflow(db, "wf-skip", "Earnings surprise", llm_analysis=True)
    event = _add_event(db)
    db.commit()

    alert_runtime._process_alpha_feed_event(db, event)

    assert [call["tracking"].request_kind for call in calls] == [
        "workflow_feed_trigger_batch",
        "workflow_followup_analysis_batch",
    ]
    assert calls[1]["tracking"].workflow_id == "wf-match"
    assert calls[1]["tracking"].workflow_name == "Workflow wf-match"
    notification = db.query(UserAlertNotification).one()
    assert "LLM Analysis: The news is material" in notification.message
    run = db.query(AlertWorkflowRun).one()
    payload = json.loads(run.evaluation_payload_json)
    assert payload["llm_analysis"]["batch"]["batch_size"] == 1
    db.close()
