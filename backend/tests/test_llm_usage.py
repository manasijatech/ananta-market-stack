from datetime import UTC, datetime

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.schemas.llm_usage import LlmUsageFilterOut
from app.services import llm_usage
from db.models import LlmUsageDailySnapshot, LlmUsageEvent, User
from db.session import Base


class _FakeResponse:
    def __init__(self, *, model: str, response_id: str, usage: dict):
        self.model = model
        self.id = response_id
        self.usage = usage


def test_record_llm_usage_persists_event_and_daily_snapshot():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    original_session_local = llm_usage.SessionLocal
    llm_usage.SessionLocal = session_factory
    try:
        db = session_factory()
        db.add(User(id="u1", display_name="User"))
        db.commit()
        db.close()

        response = _FakeResponse(
            model="openrouter/test-model",
            response_id="resp_1",
            usage={
                "prompt_tokens": 120,
                "completion_tokens": 45,
                "total_tokens": 165,
                "prompt_tokens_details": {"cached_tokens": 20, "cache_write_tokens": 10},
                "completion_tokens_details": {"reasoning_tokens": 7},
                "cost": 0.0123,
                "cost_details": {"upstream_inference_prompt_cost": 0.01},
                "is_byok": False,
            },
        )
        started_at = datetime(2026, 5, 15, 9, 0, tzinfo=UTC).replace(tzinfo=None)
        completed_at = datetime(2026, 5, 15, 9, 0, 2, tzinfo=UTC).replace(tzinfo=None)
        llm_usage.record_llm_usage(
            user_id="u1",
            provider="openrouter",
            requested_model_id="openrouter/test-model",
            api_surface="chat_completions",
            started_at=started_at,
            completed_at=completed_at,
            status="success",
            tracking=llm_usage.LlmTrackingContext(
                request_kind="workflow_llm_analysis",
                workflow_id="wf-1",
                workflow_name="Momentum",
                workflow_status="active",
                workflow_type="market_data",
                metadata={"source": "test"},
            ),
            response=response,
        )

        db = session_factory()
        event = db.query(LlmUsageEvent).one()
        snapshot = db.query(LlmUsageDailySnapshot).one()
        assert event.workflow_id == "wf-1"
        assert event.prompt_tokens == 120
        assert event.cached_tokens == 20
        assert event.reasoning_tokens == 7
        assert event.provider_cost == 0.0123
        assert event.provider_cost_currency == "credits"
        assert snapshot.request_count == 1
        assert snapshot.success_count == 1
        assert snapshot.total_tokens == 165
        assert snapshot.provider_cost_total == 0.0123
        db.close()
    finally:
        llm_usage.SessionLocal = original_session_local


def test_usage_overview_aggregates_historical_workflow_usage():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    original_session_local = llm_usage.SessionLocal
    llm_usage.SessionLocal = session_factory
    try:
        db = session_factory()
        db.add(User(id="u1", display_name="User"))
        db.commit()
        db.close()

        first = datetime(2026, 5, 14, 12, 0, tzinfo=UTC).replace(tzinfo=None)
        second = datetime(2026, 5, 15, 12, 0, tzinfo=UTC).replace(tzinfo=None)
        llm_usage.record_llm_usage(
            user_id="u1",
            provider="openai",
            requested_model_id="gpt-4.1-mini",
            api_surface="chat_completions",
            started_at=first,
            completed_at=first,
            status="success",
            tracking=llm_usage.LlmTrackingContext(
                request_kind="workflow_llm_test",
                workflow_id="wf-deleted",
                workflow_name="Deleted Workflow",
            ),
            response=_FakeResponse(
                model="gpt-4.1-mini",
                response_id="resp_2",
                usage={"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
            ),
        )
        llm_usage.record_llm_usage(
            user_id="u1",
            provider="gemini",
            requested_model_id="gemini-2.5-flash",
            api_surface="chat_completions",
            started_at=second,
            completed_at=second,
            status="error",
            tracking=llm_usage.LlmTrackingContext(request_kind="workflow_feed_trigger"),
            error="provider timeout",
        )

        db = session_factory()
        overview = llm_usage.usage_overview(db, "u1", filters=LlmUsageFilterOut())
        assert overview.totals.request_count == 2
        assert overview.totals.success_count == 1
        assert overview.totals.error_count == 1
        assert overview.totals.total_tokens == 15
        assert overview.by_provider[0].provider in {"openai", "gemini"}
        assert any(item.workflow_id == "wf-deleted" for item in overview.top_workflows)
        assert any(item.request_kind == "workflow_feed_trigger" for item in overview.request_kinds)
        db.close()
    finally:
        llm_usage.SessionLocal = original_session_local
