from app.services.broker_chat_runner import _model_settings_for_run
from app.services.llm_config import normalize_reasoning_effort
from db.models import BrokerChatRun


def test_normalize_reasoning_effort_accepts_known_levels():
    assert normalize_reasoning_effort(None) is None
    assert normalize_reasoning_effort("") is None
    assert normalize_reasoning_effort("default") is None
    assert normalize_reasoning_effort("HIGH") == "high"
    assert normalize_reasoning_effort("xhigh") == "xhigh"
    assert normalize_reasoning_effort("none") == "none"


def test_normalize_reasoning_effort_rejects_unknown_levels():
    try:
        normalize_reasoning_effort("turbo")
        raise AssertionError("expected ValueError")
    except ValueError:
        pass


def test_openrouter_model_settings_include_reasoning_effort():
    run = BrokerChatRun(
        id="r1",
        session_id="s1",
        user_id="u1",
        provider="openrouter",
        model_id="deepseek/deepseek-v4-flash",
        message="hi",
        metadata_json='{"reasoning_effort":"high"}',
    )
    settings = _model_settings_for_run(run)
    assert settings.extra_body == {"reasoning": {"effort": "high"}}
    assert settings.reasoning is not None
    assert settings.reasoning.effort == "high"


def test_model_settings_omit_reasoning_when_default():
    run = BrokerChatRun(
        id="r1",
        session_id="s1",
        user_id="u1",
        provider="openrouter",
        model_id="deepseek/deepseek-v4-flash",
        message="hi",
        metadata_json="{}",
    )
    settings = _model_settings_for_run(run)
    assert settings.extra_body is None
    assert settings.reasoning is None
