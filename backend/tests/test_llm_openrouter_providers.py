import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.config import get_settings
from app.schemas.system_config import LlmModelCreateIn, LlmModelUpdateIn
from app.services import llm_config
from app.services.broker_chat_runner import _model_settings_for_run
from broker.crypto import encrypt_value
from db.models import BrokerChatRun, User, UserLlmModel, UserLlmProviderCredential
from db.session import Base


@pytest.fixture(autouse=True)
def _dev_credentials(monkeypatch):
    monkeypatch.setenv("ALLOW_INSECURE_DEV_CREDENTIALS", "true")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def _seed_openrouter_key(db, user_id="u1"):
    db.add(User(id=user_id, display_name="test"))
    db.add(
        UserLlmProviderCredential(
            id="cred-openrouter",
            user_id=user_id,
            provider="openrouter",
            api_key_cipher=encrypt_value("sk-test"),
            is_enabled=True,
        )
    )
    db.commit()


def test_normalize_openrouter_providers_accepts_list_and_string():
    assert llm_config.normalize_openrouter_providers(None) == []
    assert llm_config.normalize_openrouter_providers("") == []
    assert llm_config.normalize_openrouter_providers(["Together", " fireworks "]) == [
        "together",
        "fireworks",
    ]
    assert llm_config.normalize_openrouter_providers("together, fireworks\ntogether") == [
        "together",
        "fireworks",
    ]
    assert llm_config.normalize_openrouter_providers('["together", "fireworks"]') == [
        "together",
        "fireworks",
    ]
    assert llm_config.normalize_openrouter_providers("deepinfra/turbo") == ["deepinfra/turbo"]


def test_normalize_openrouter_providers_rejects_invalid():
    for bad in ["INVALID SLUG!", "a" * 65, 123]:
        try:
            llm_config.normalize_openrouter_providers([bad] if not isinstance(bad, int) else bad)
            raise AssertionError(f"expected ValueError for {bad!r}")
        except ValueError:
            pass
    try:
        llm_config.normalize_openrouter_providers(["a", "b", "c", "d", "e", "f"])
        raise AssertionError("expected ValueError for too many providers")
    except ValueError:
        pass


def test_build_openrouter_provider_prefs():
    assert llm_config.build_openrouter_provider_prefs([], True) is None
    assert llm_config.build_openrouter_provider_prefs(None) is None
    assert llm_config.build_openrouter_provider_prefs(["together"], True) == {
        "order": ["together"],
        "allow_fallbacks": True,
    }
    assert llm_config.build_openrouter_provider_prefs(["a", "b"], False) == {
        "order": ["a", "b"],
        "allow_fallbacks": False,
    }


def test_merge_openrouter_extra_body_preserves_caller_keys():
    merged = llm_config.merge_openrouter_extra_body(
        {"usage": {"include": True}},
        reasoning_effort="high",
        providers=["together"],
        allow_fallbacks=True,
    )
    assert merged == {
        "usage": {"include": True},
        "reasoning": {"effort": "high"},
        "provider": {"order": ["together"], "allow_fallbacks": True},
    }
    # Caller-provided provider wins over saved routing.
    merged = llm_config.merge_openrouter_extra_body(
        {"provider": {"order": ["custom"]}},
        providers=["together"],
        allow_fallbacks=False,
    )
    assert merged == {"provider": {"order": ["custom"]}}
    assert llm_config.merge_openrouter_extra_body(None) is None


def test_routing_from_metadata_tolerates_old_runs():
    assert llm_config.routing_from_metadata(None) == ([], True)
    assert llm_config.routing_from_metadata({}) == ([], True)
    assert llm_config.routing_from_metadata(
        {"openrouter_providers": ["together"], "openrouter_allow_fallbacks": False}
    ) == (["together"], False)
    # Invalid stored values degrade to default routing instead of failing the run.
    assert llm_config.routing_from_metadata({"openrouter_providers": ["BAD SLUG!!"]}) == ([], True)


def test_model_settings_include_provider_routing_from_metadata():
    run = BrokerChatRun(
        id="r1",
        session_id="s1",
        user_id="u1",
        provider="openrouter",
        model_id="deepseek/deepseek-v4-flash",
        message="hi",
        metadata_json='{"openrouter_providers":["together","fireworks"],"openrouter_allow_fallbacks":false}',
    )
    settings = _model_settings_for_run(run)
    assert settings.extra_body == {
        "provider": {"order": ["together", "fireworks"], "allow_fallbacks": False}
    }


def test_model_settings_merge_reasoning_and_routing():
    run = BrokerChatRun(
        id="r1",
        session_id="s1",
        user_id="u1",
        provider="openrouter",
        model_id="deepseek/deepseek-v4-flash",
        message="hi",
        metadata_json='{"reasoning_effort":"high","openrouter_providers":["together"],"openrouter_allow_fallbacks":true}',
    )
    settings = _model_settings_for_run(run)
    assert settings.extra_body == {
        "reasoning": {"effort": "high"},
        "provider": {"order": ["together"], "allow_fallbacks": True},
    }
    assert settings.reasoning is not None
    assert settings.reasoning.effort == "high"


def test_model_settings_default_routing_stays_none():
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


def test_model_settings_non_openrouter_ignores_routing():
    run = BrokerChatRun(
        id="r1",
        session_id="s1",
        user_id="u1",
        provider="openai",
        model_id="gpt-4o",
        message="hi",
        metadata_json='{"openrouter_providers":["together"]}',
    )
    settings = _model_settings_for_run(run)
    assert settings.extra_body is None


def test_add_provider_model_stores_routing():
    db = _db()
    _seed_openrouter_key(db)
    llm_config.add_provider_model(
        db,
        "u1",
        LlmModelCreateIn(
            provider="openrouter",
            model_id="deepseek/deepseek-chat",
            label="DeepSeek",
            openrouter_providers=["Together", "fireworks"],
            openrouter_allow_fallbacks=False,
        ),
    )
    providers, allow_fallbacks = llm_config.get_model_openrouter_routing(
        db, "u1", "openrouter", "deepseek/deepseek-chat"
    )
    assert providers == ["together", "fireworks"]
    assert allow_fallbacks is False


def test_add_provider_model_defaults_to_automatic_routing():
    db = _db()
    _seed_openrouter_key(db)
    configs = llm_config.add_provider_model(
        db, "u1", LlmModelCreateIn(provider="openrouter", model_id="x/y")
    )
    entry = next(m for p in configs if p.provider == "openrouter" for m in p.models)
    assert entry.openrouter_providers == []
    assert entry.openrouter_allow_fallbacks is True


def test_add_provider_model_rejects_bad_slug():
    db = _db()
    _seed_openrouter_key(db)
    try:
        llm_config.add_provider_model(
            db,
            "u1",
            LlmModelCreateIn(provider="openrouter", model_id="x/y", openrouter_providers=["BAD SLUG!!"]),
        )
        raise AssertionError("expected ValueError")
    except ValueError:
        pass


def test_update_provider_model_routing():
    db = _db()
    _seed_openrouter_key(db)
    configs = llm_config.add_provider_model(
        db, "u1", LlmModelCreateIn(provider="openrouter", model_id="x/y")
    )
    row_id = next(m.id for p in configs if p.provider == "openrouter" for m in p.models)
    configs = llm_config.update_provider_model(
        db,
        "u1",
        row_id,
        LlmModelUpdateIn(openrouter_providers="together, fireworks", openrouter_allow_fallbacks=True),
    )
    entry = next(m for p in configs if p.provider == "openrouter" for m in p.models)
    assert entry.openrouter_providers == ["together", "fireworks"]
    # Clearing back to empty restores automatic routing.
    configs = llm_config.update_provider_model(db, "u1", row_id, LlmModelUpdateIn(openrouter_providers=[]))
    entry = next(m for p in configs if p.provider == "openrouter" for m in p.models)
    assert entry.openrouter_providers == []


def test_non_openrouter_model_rejects_providers():
    db = _db()
    db.add(User(id="u1", display_name="test"))
    db.add(
        UserLlmProviderCredential(
            id="cred-openai",
            user_id="u1",
            provider="openai",
            api_key_cipher=encrypt_value("sk-test"),
            is_enabled=True,
        )
    )
    db.commit()
    try:
        llm_config.add_provider_model(
            db,
            "u1",
            LlmModelCreateIn(provider="openai", model_id="gpt-4o", openrouter_providers=["together"]),
        )
        raise AssertionError("expected ValueError")
    except ValueError:
        pass


def test_get_routing_unknown_model_returns_default():
    db = _db()
    assert llm_config.get_model_openrouter_routing(db, "nobody", "openrouter", "x/y") == ([], True)


def test_gateway_merges_saved_routing_with_usage_body(monkeypatch):
    from app.services import llm_gateway

    db = _db()
    _seed_openrouter_key(db)
    db.add(
        UserLlmModel(
            id="m1",
            user_id="u1",
            provider="openrouter",
            model_id="x/y",
            label="x",
            openrouter_providers_json='["together"]',
            openrouter_allow_fallbacks=False,
            is_enabled=True,
        )
    )
    db.commit()
    captured: dict = {}

    class _Completions:
        def create(self, **kwargs):
            captured.update(kwargs)

            class _Msg:
                content = "ok"

            class _Choice:
                message = _Msg()

            return type("Resp", (), {"choices": [_Choice()], "usage": None, "id": "r", "model": "x/y"})()

    class _Chat:
        completions = _Completions()

    class _Client:
        chat = _Chat()

    monkeypatch.setattr(llm_gateway, "build_provider_client", lambda *a, **k: _Client())
    monkeypatch.setattr(llm_gateway, "record_llm_usage", lambda *a, **k: None)

    class _Span:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    monkeypatch.setattr(llm_gateway.llm_telemetry, "start_span", lambda *a, **k: _Span())
    llm_gateway.generate_text(
        db, "u1", "openrouter", model="x/y", user_text="hi", extra_body={"usage": {"include": True}}
    )
    assert captured["extra_body"] == {
        "usage": {"include": True},
        "provider": {"order": ["together"], "allow_fallbacks": False},
    }
