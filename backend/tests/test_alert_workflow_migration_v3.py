from __future__ import annotations

import importlib.util
from pathlib import Path

from app.schemas.alert import AlertCondition, AlertFeedTriggerConfig, AlertWorkflowDsl
from app.services.alerts import SYSTEM_TEMPLATES, _workflow_dsl
from app.services.alerts_engine.compiler import compile_workflow_dsl
from app.services.alerts_engine.dsl_normalize import normalize_workflow_dsl_payload


def _load_migration_module():
    path = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "e5a1b7c3d902_unified_alert_workflow_dsl_v3.py"
    spec = importlib.util.spec_from_file_location("unified_alert_workflow_dsl_v3", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_normalize_legacy_market_data_payload():
    payload = {
        "workflow_type": "market_data",
        "version": 2,
        "conditions": [{"field": "ltp", "operator": "gte", "value": 100}],
        "combine": "all",
    }
    normalized = normalize_workflow_dsl_payload(payload)
    assert normalized["workflow_type"] == "alert"
    assert normalized["version"] == 3
    assert normalized["broker_trigger"]["enabled"] is True
    assert normalized["feed_trigger"]["enabled"] is False


def test_normalize_legacy_alpha_feed_payload():
    payload = {
        "workflow_type": "alpha_feed",
        "conditions": [{"field": "event", "operator": "always"}],
        "feed_trigger": {
            "enabled": True,
            "products": ["news"],
            "source_scope": "full_market",
        },
    }
    normalized = normalize_workflow_dsl_payload(payload)
    assert normalized["workflow_type"] == "alert"
    assert normalized["broker_trigger"]["enabled"] is False
    assert normalized["feed_trigger"]["enabled"] is True
    assert normalized["feed_trigger"]["products"] == ["news"]


def test_alert_workflow_dsl_model_normalizes_legacy_types():
    market = AlertWorkflowDsl(workflow_type="market_data", conditions=[AlertCondition(field="ltp", operator="gte", value=1)])
    assert market.workflow_type == "alert"
    assert market.broker_trigger.enabled is True
    assert market.feed_trigger.enabled is False

    feed = AlertWorkflowDsl(
        workflow_type="alpha_feed",
        conditions=[AlertCondition(field="event", operator="always")],
        feed_trigger=AlertFeedTriggerConfig(enabled=True, products=["announcements"], source_scope="full_market"),
    )
    assert feed.workflow_type == "alert"
    assert feed.broker_trigger.enabled is False
    assert feed.feed_trigger.enabled is True


def test_workflow_dsl_soft_load_normalizes_stored_json():
    dsl = _workflow_dsl(
        {
            "workflow_type": "alpha_feed",
            "conditions": [{"field": "event", "operator": "always"}],
            "feed_trigger": {"enabled": True, "products": ["earnings"], "source_scope": "full_market"},
        }
    )
    assert dsl.workflow_type == "alert"
    assert dsl.broker_trigger.enabled is False
    assert dsl.feed_trigger.enabled is True


def test_compile_rejects_both_triggers_disabled():
    dsl = AlertWorkflowDsl(
        workflow_type="alert",
        broker_trigger={"enabled": False},
        feed_trigger={"enabled": False, "products": []},
        conditions=[],
    )
    result = compile_workflow_dsl(dsl)
    assert result["valid"] is False
    assert any("at least one trigger source" in err.lower() for err in result["errors"])


def test_compile_feed_only_skips_broker_condition_requirements():
    dsl = AlertWorkflowDsl(
        workflow_type="alert",
        broker_trigger={"enabled": False},
        feed_trigger={"enabled": True, "products": ["news"], "source_scope": "full_market"},
        conditions=[{"field": "event", "operator": "always"}],
    )
    result = compile_workflow_dsl(dsl)
    assert result["valid"] is True
    assert result["compiled_summary"]["trigger_sources"]["broker_market_data"] is False
    assert result["compiled_summary"]["trigger_sources"]["alpha_feed"] is True


def test_alembic_normalize_dsl_helper_matches_soft_path():
    migration = _load_migration_module()
    payload = {
        "workflow_type": "market_data",
        "version": 2,
        "conditions": [{"field": "ltp", "operator": "gte", "value": 10}],
    }
    working = dict(payload)
    assert migration._normalize_dsl(working) is True
    soft = normalize_workflow_dsl_payload(payload)
    assert working["workflow_type"] == soft["workflow_type"] == "alert"
    assert working["broker_trigger"]["enabled"] is True
    assert working["feed_trigger"]["enabled"] is False


def test_system_templates_are_unified_alert_v3():
    slugs = {item["slug"] for item in SYSTEM_TEMPLATES}
    assert "price-move-with-news-reason" in slugs
    for item in SYSTEM_TEMPLATES:
        dsl = item["workflow_dsl"]
        assert dsl.get("workflow_type") == "alert"
        assert "broker_trigger" in dsl
        assert isinstance(dsl["broker_trigger"].get("enabled"), bool)
        # Feed templates must keep feed enabled; broker templates keep broker enabled.
        if item["category"] == "alpha-feed":
            assert dsl["broker_trigger"]["enabled"] is False
            assert dsl["feed_trigger"]["enabled"] is True
        else:
            assert dsl["broker_trigger"]["enabled"] is True
    news_reason = next(item for item in SYSTEM_TEMPLATES if item["slug"] == "price-move-with-news-reason")
    assert news_reason["workflow_dsl"]["llm_analysis"]["enabled"] is True
    assert "@news" in news_reason["workflow_dsl"]["llm_analysis"]["prompt_template"]
    # Ensure templates round-trip through schema + compile.
    for item in SYSTEM_TEMPLATES:
        dsl = AlertWorkflowDsl(**item["workflow_dsl"])
        compiled = compile_workflow_dsl(dsl)
        assert compiled["valid"], (item["slug"], compiled["errors"])
