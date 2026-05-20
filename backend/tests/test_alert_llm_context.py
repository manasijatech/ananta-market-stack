from datetime import datetime

from app.schemas.alert import (
    AlertChannelSelection,
    AlertLlmAnalysisConfig,
    AlertNotificationConfig,
    AlertWorkflowDsl,
    AlertWorkflowOut,
    AlertWorkflowTargeting,
)
from app.services import alerts as alert_svc
from app.services.alert_llm_context import parse_placeholder_calls, resolve_llm_context


def _workflow() -> AlertWorkflowOut:
    dsl = AlertWorkflowDsl(
        combine="all",
        cooldown_seconds=300,
        conditions=[],
        targeting=AlertWorkflowTargeting(),
        notification=AlertNotificationConfig(),
        channels=AlertChannelSelection(),
        llm_analysis=AlertLlmAnalysisConfig(
            enabled=True,
            provider="openai",
            model_id="gpt-test",
            prompt_template="Trigger @trigger.reason for {symbol}. Price @price.full Details @trigger.details",
        ),
        compiled_summary={"summary": "compiled trigger summary"},
    )
    now = datetime.utcnow()
    return AlertWorkflowOut(
        id="w1",
        user_id="u1",
        template_id=None,
        account_id=None,
        broker_code=None,
        name="LLM workflow",
        description="",
        symbol=None,
        exchange="NSE",
        instrument_ref={},
        workflow_dsl=dsl,
        graph_dsl={"nodes": [], "edges": []},
        editor_mode="rule",
        status="active",
        channel_override=None,
        deployment_status="active",
        deploy_version=1,
        compiled_summary={"summary": "compiled trigger summary"},
        last_validated_at=None,
        last_compiled_at=None,
        last_runtime_error=None,
        last_triggered_at=None,
        created_at=now,
        updated_at=now,
    )


def test_parse_placeholder_calls_with_typed_args():
    calls = parse_placeholder_calls("@news(days=2, max_pages=1, max_items=5, sentiment=null) @price.full")

    assert calls[0].name == "news"
    assert calls[0].args == {"days": 2, "max_pages": 1, "max_items": 5, "sentiment": None}
    assert calls[1].name == "price.full"


def test_resolve_llm_context_uses_tick_symbol_not_workflow_universe_symbol():
    workflow = _workflow()
    context = resolve_llm_context(
        None,
        workflow=workflow,
        tick={"symbol": "TCS", "ltp": 1000, "close": 980},
        previous_tick={"symbol": "TCS", "ltp": 970},
        reason="ltp gte 1000",
        evaluation_details={"current": 1000, "threshold": 1000},
    )

    assert context["symbol"] == "TCS"
    assert "ltp gte 1000" in context["rendered_prompt"]
    assert "TCS" in context["rendered_prompt"]
    assert context["context_errors"] == []
    assert context["placeholders"]["@price.full"]["symbol"] == "TCS"


def test_preview_workflow_llm_context_uses_draft_llm_without_persisting(monkeypatch):
    workflow = _workflow()

    def fake_get_workflow(_db, _user_id, _workflow_id):
        return workflow

    monkeypatch.setattr(alert_svc, "get_workflow", fake_get_workflow)
    context = alert_svc.preview_workflow_llm_context(
        None,
        "u1",
        "w1",
        {"symbol": "INFY", "ltp": 1500},
        reason="draft reason",
        llm_analysis=AlertLlmAnalysisConfig(
            enabled=True,
            provider="openai",
            model_id="gpt-test",
            prompt_template="Draft prompt for {symbol}: @trigger.reason",
        ),
    )

    assert context is not None
    assert context["rendered_prompt"] == "Draft prompt for INFY: draft reason"
    assert workflow.workflow_dsl.llm_analysis.prompt_template.startswith("Trigger @trigger.reason")
