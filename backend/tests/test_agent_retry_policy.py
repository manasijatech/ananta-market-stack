import asyncio
import random
from datetime import datetime, timedelta

import pytest

from app.agent_harness.retry_policy import (
    USER_BUSY,
    USER_CREDITS,
    AgentRetryPolicy,
    StreamIdleError,
    ToolFingerprintTracker,
    anext_with_idle,
    capped_sleep_seconds,
    classify_provider_error,
    clamp_user_retry,
    extract_retry_after_seconds,
    openai_client_kwargs,
    remaining_job_seconds,
    repair_unpaired_tool_messages,
    resolve_agent_retry_policy,
    retry_delay_seconds,
    tool_call_fingerprint,
)


class _FakeExc(Exception):
    def __init__(self, message: str, *, status_code: int | None = None, headers: dict | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        if headers is not None:
            self.response = type("Resp", (), {"headers": headers, "status_code": status_code})()


@pytest.mark.parametrize(
    ("exc", "expected_class", "retryable"),
    [
        (_FakeExc("server_error", status_code=500), "transient_transport", True),
        (_FakeExc("server error"), "transient_transport", True),
        (_FakeExc("The stream ended without sending any chunks"), "transient_transport", True),
        (_FakeExc("stream ended before message_stop"), "transient_transport", True),
        (_FakeExc("connection reset by peer"), "transient_transport", True),
        (_FakeExc("timeout waiting for response"), "transient_transport", True),
        (_FakeExc("rate limit exceeded", status_code=429), "rate_limited", True),
        (_FakeExc("overloaded"), "rate_limited", True),
        (_FakeExc("insufficient quota for this model"), "quota_exhausted", False),
        (_FakeExc("You exceeded your current quota, please check your plan"), "quota_exhausted", False),
        (_FakeExc("invalid api key", status_code=401), "fatal", False),
        (_FakeExc("context length exceeded"), "fatal", False),
        (_FakeExc("content filter blocked this request"), "fatal", False),
        (StreamIdleError(90), "transient_transport", True),
    ],
)
def test_classifier_table(exc, expected_class, retryable):
    classified = classify_provider_error(exc)
    assert classified.error_class == expected_class
    assert classified.retryable is retryable


def test_retry_after_7200_is_fatal_rate_limit():
    exc = _FakeExc("rate limit", status_code=429, headers={"retry-after": "7200"})
    classified = classify_provider_error(exc, max_server_delay_seconds=60)
    assert classified.error_class == "rate_limited"
    assert classified.retryable is False
    assert classified.user_message == USER_BUSY
    assert extract_retry_after_seconds(exc) == 7200.0


def test_quota_never_retries_and_uses_safe_copy():
    classified = classify_provider_error(_FakeExc("OpenRouter credits exhausted"))
    assert classified.retryable is False
    assert classified.user_message == USER_CREDITS
    assert "OpenRouter" not in classified.user_message


def test_openai_client_kwargs_disable_sdk_retries():
    kwargs = openai_client_kwargs(
        api_key="sk-test",
        base_url="https://openrouter.ai/api/v1",
        policy=AgentRetryPolicy(),
    )
    assert kwargs["max_retries"] == 0
    assert kwargs["timeout"] == 60.0


def test_user_cannot_set_max_retries_above_cap():
    clamped = clamp_user_retry({"enabled": True, "max_retries": 99, "base_delay_seconds": 2, "max_delay_seconds": 12})
    assert clamped["max_retries"] == 8


def test_user_cannot_raise_server_delay_via_policy_resolve():
    policy = resolve_agent_retry_policy(
        {"enabled": True, "max_retries": 2, "max_server_delay_seconds": 3600, "provider_max_retries": 9}
    )
    assert policy.max_server_delay_seconds == 60.0
    assert policy.provider_max_retries == 0
    assert policy.max_retries == 2


def test_remaining_job_time_shorter_than_delay_fails():
    started = datetime.utcnow() - timedelta(seconds=590)
    remaining = remaining_job_seconds(started, 600)
    assert capped_sleep_seconds(12, remaining_job_seconds=remaining) is None
    assert capped_sleep_seconds(2, remaining_job_seconds=40) == 2


def test_unlimited_job_timeout_never_exhausts_budget():
    from app.agent_harness.retry_policy import rq_timeout_value

    started = datetime.utcnow() - timedelta(hours=26)
    remaining = remaining_job_seconds(started, 0)
    assert remaining == float("inf")
    assert capped_sleep_seconds(12, remaining_job_seconds=remaining) == 12
    assert rq_timeout_value(0) == -1
    assert rq_timeout_value(-5) == -1
    assert rq_timeout_value(600) == 600


def test_retry_delay_honours_retry_after_and_jitter(monkeypatch):
    policy = AgentRetryPolicy(base_delay_seconds=2, max_delay_seconds=12)
    assert retry_delay_seconds(policy, 0, 7.0) == 7.0
    rng = random.Random(0)
    delay = retry_delay_seconds(policy, 0, None, rng=rng)
    assert 1.0 <= delay <= 2.0


def test_fingerprint_circuit_breaks_identical_tool_args():
    tracker = ToolFingerprintTracker(threshold=3)
    args = {"url": "https://screener.in/company/TCS/"}
    assert tracker.record("web_fetch", args) == 1
    assert tracker.record("web_fetch", args) == 2
    assert tracker.should_circuit_break("web_fetch", args) is False
    assert tracker.record("web_fetch", args) == 3
    assert tracker.should_circuit_break("web_fetch", args) is True
    assert tool_call_fingerprint("web_fetch", args) in tracker.broken_fingerprints()


def test_repair_unpaired_chat_completions_tool_messages():
    messages = [
        {"role": "user", "content": "open it"},
        {
            "role": "assistant",
            "content": "",
            "tool_calls": [{"id": "call_1", "type": "function", "function": {"name": "web_fetch", "arguments": "{}"}}],
        },
    ]
    repaired = repair_unpaired_tool_messages(messages)
    assert repaired[-1]["role"] == "tool"
    assert repaired[-1]["tool_call_id"] == "call_1"


def test_repair_unpaired_responses_api_items():
    messages = [
        {"type": "function_call", "call_id": "c1", "name": "web_search"},
        {"type": "function_call_output", "call_id": "c1", "output": "{}"},
        {"type": "function_call", "call_id": "c2", "name": "web_search"},
    ]
    repaired = repair_unpaired_tool_messages(messages)
    assert repaired[-1]["type"] == "function_call_output"
    assert repaired[-1]["call_id"] == "c2"


def test_idle_watchdog_raises_stream_idle():
    async def empty():
        await asyncio.sleep(0.05)
        yield "late"

    async def run():
        iterator = empty().__aiter__()
        with pytest.raises(StreamIdleError):
            await anext_with_idle(iterator, 0.01)

    asyncio.run(run())
