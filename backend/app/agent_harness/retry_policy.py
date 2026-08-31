"""Agent-level retry policy, error classification, and loop helpers.

Ananta owns retries. The provider SDK stays at ``max_retries=0`` so this
module classifies every failure. See ``docs/agent-harness-plans/01-agent-retries.md``.
"""

from __future__ import annotations

import asyncio
import json
import random
import re
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta
from typing import Any, Literal

ErrorClass = Literal[
    "transient_transport",
    "rate_limited",
    "quota_exhausted",
    "unknown_tool",
    "fatal",
    "task_incomplete",
    "repeated_tool",
    "unpaired_tools",
]

ErrorLayer = Literal["api", "tool", "context", "control"]

USER_MAX_RETRIES_CAP = 8
DEFAULT_MAX_RETRIES = 3
DEFAULT_BASE_DELAY_SECONDS = 2.0
DEFAULT_MAX_DELAY_SECONDS = 12.0
DEFAULT_MAX_SERVER_DELAY_SECONDS = 60.0
DEFAULT_PROVIDER_TIMEOUT_SECONDS = 60.0
DEFAULT_STREAM_IDLE_SECONDS = 0.0
JOB_SLEEP_RESERVE_SECONDS = 15.0
FINGERPRINT_BREAK_THRESHOLD = 3
UNPAIRED_TOOL_PLACEHOLDER = '{"error":"tool result missing; skipped"}'

_TRANSIENT_STATUS = {408, 409, 429, 500, 502, 503, 504}
_FATAL_AUTH_STATUS = {401, 403}
_RATE_LIMIT_RE = re.compile(r"rate[\s_-]?limit|too many requests|overloaded|429\b", re.I)
_QUOTA_RE = re.compile(
    r"insufficient quota|quota exceeded|exceeded.{0,40}quota|out of credits|credit(?:s)? exhausted|"
    r"spend cap|billing|payment required",
    re.I,
)
_TIMEOUT_RE = re.compile(
    r"timeout|timed out|connection reset|connection aborted|econnreset|"
    r"temporarily unavailable|temporar|bad gateway|502|503|504|"
    r"ended without sending any chunks|empty stream|empty response|"
    r"stream ended before|before message_stop|server[\s_-]?error",
    re.I,
)
_CONTEXT_LENGTH_RE = re.compile(
    r"context[\s_-]?length|maximum context|too many tokens|context window|"
    r"prompt is too long|max_tokens",
    re.I,
)
_CONTENT_FILTER_RE = re.compile(
    r"content[\s_-]?filter|content policy|safety system|refused to (?:answer|complete)",
    re.I,
)
_RETRY_AFTER_HEADER_RE = re.compile(r"retry[\s_-]?after[:\s]+(\d+(?:\.\d+)?)", re.I)
_RETRY_IN_RE = re.compile(r"retry in (\d+(?:\.\d+)?)\s*(s|sec|seconds|m|min|minutes|h|hours)?", re.I)

USER_BUSY = "The model provider is busy. Try later."
USER_CREDITS = "The model provider is out of credits."
USER_AUTH = "The model provider rejected this request. Check the API key in Settings."
USER_CONTEXT = "This conversation is too long for the model. Start a new chat."
USER_FILTER = "The model provider blocked this request."
USER_GENERIC = "The model provider could not complete this request."


class StreamIdleError(TimeoutError):
    """No SSE/stream event arrived within the idle watchdog window."""

    def __init__(self, idle_seconds: float) -> None:
        super().__init__(f"stream idle for {idle_seconds:.0f}s")
        self.idle_seconds = idle_seconds


class AgentRetryError(Exception):
    """Fatal or exhausted provider error with a user-safe message."""

    def __init__(self, classified: ClassifiedError) -> None:
        super().__init__(classified.user_message)
        self.classified = classified


@dataclass(frozen=True)
class ClassifiedError:
    error_class: ErrorClass
    layer: ErrorLayer
    retryable: bool
    user_message: str
    retry_after_seconds: float | None = None
    fingerprint: str | None = None


@dataclass(frozen=True)
class AgentRetryPolicy:
    enabled: bool = True
    max_retries: int = DEFAULT_MAX_RETRIES
    base_delay_seconds: float = DEFAULT_BASE_DELAY_SECONDS
    max_delay_seconds: float = DEFAULT_MAX_DELAY_SECONDS
    max_server_delay_seconds: float = DEFAULT_MAX_SERVER_DELAY_SECONDS
    provider_max_retries: int = 0
    provider_timeout_seconds: float = DEFAULT_PROVIDER_TIMEOUT_SECONDS
    stream_idle_seconds: float = DEFAULT_STREAM_IDLE_SECONDS
    fingerprint_break_threshold: int = FINGERPRINT_BREAK_THRESHOLD
    purpose: Literal["chat", "background"] = "chat"

    def user_facing(self) -> dict[str, Any]:
        return {
            "enabled": self.enabled,
            "max_retries": self.max_retries,
            "base_delay_seconds": self.base_delay_seconds,
            "max_delay_seconds": self.max_delay_seconds,
        }

    @classmethod
    def background(cls, base: AgentRetryPolicy | None = None) -> AgentRetryPolicy:
        source = base or from_env()
        return replace(source, purpose="background", max_retries=min(source.max_retries, 1))


def from_env() -> AgentRetryPolicy:
    from app.config import get_settings

    settings = get_settings()
    return AgentRetryPolicy(
        enabled=True,
        max_retries=_clamp_int(getattr(settings, "broker_chat_agent_max_retries", DEFAULT_MAX_RETRIES), 0, USER_MAX_RETRIES_CAP),
        base_delay_seconds=max(0.0, float(getattr(settings, "broker_chat_retry_base_delay_seconds", DEFAULT_BASE_DELAY_SECONDS))),
        max_delay_seconds=max(0.0, float(getattr(settings, "broker_chat_retry_max_delay_seconds", DEFAULT_MAX_DELAY_SECONDS))),
        max_server_delay_seconds=max(
            0.0,
            float(getattr(settings, "broker_chat_retry_max_server_delay_seconds", DEFAULT_MAX_SERVER_DELAY_SECONDS)),
        ),
        provider_max_retries=max(0, int(getattr(settings, "broker_chat_provider_max_retries", 0))),
        provider_timeout_seconds=max(
            1.0,
            float(getattr(settings, "broker_chat_provider_timeout_seconds", DEFAULT_PROVIDER_TIMEOUT_SECONDS)),
        ),
        stream_idle_seconds=max(0.0, float(getattr(settings, "broker_chat_stream_idle_seconds", DEFAULT_STREAM_IDLE_SECONDS))),
        purpose="chat",
    )


def parse_user_retry_json(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        data = raw
    elif isinstance(raw, str) and raw.strip():
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            parsed = {}
        data = parsed if isinstance(parsed, dict) else {}
    else:
        data = {}
    return {key: data[key] for key in ("enabled", "max_retries", "base_delay_seconds", "max_delay_seconds") if key in data}


def clamp_user_retry(payload: dict[str, Any], *, env_policy: AgentRetryPolicy | None = None) -> dict[str, Any]:
    env = env_policy or from_env()
    enabled = payload.get("enabled", env.enabled)
    if isinstance(enabled, str):
        enabled = enabled.strip().lower() in {"1", "true", "yes", "on"}
    max_retries = _clamp_int(payload.get("max_retries", env.max_retries), 0, USER_MAX_RETRIES_CAP)
    base_delay = max(0.0, float(payload.get("base_delay_seconds", env.base_delay_seconds)))
    max_delay = max(0.0, float(payload.get("max_delay_seconds", env.max_delay_seconds)))
    return {
        "enabled": bool(enabled),
        "max_retries": max_retries,
        "base_delay_seconds": base_delay,
        "max_delay_seconds": max_delay,
    }


def resolve_agent_retry_policy(user_retry_json: Any = None) -> AgentRetryPolicy:
    env = from_env()
    user = clamp_user_retry(parse_user_retry_json(user_retry_json), env_policy=env)
    return replace(
        env,
        enabled=bool(user["enabled"]),
        max_retries=int(user["max_retries"]),
        base_delay_seconds=float(user["base_delay_seconds"]),
        max_delay_seconds=float(user["max_delay_seconds"]),
        # Operators own these; the user API cannot raise them.
        max_server_delay_seconds=env.max_server_delay_seconds,
        provider_max_retries=0 if env.provider_max_retries < 0 else env.provider_max_retries,
    )


def openai_client_kwargs(*, api_key: str, base_url: str, policy: AgentRetryPolicy) -> dict[str, Any]:
    return {
        "api_key": api_key,
        "base_url": base_url,
        "timeout": policy.provider_timeout_seconds,
        "max_retries": policy.provider_max_retries,
    }


def extract_retry_after_seconds(exc: BaseException) -> float | None:
    response = getattr(exc, "response", None)
    headers = getattr(response, "headers", None)
    raw: Any = None
    if headers is not None and hasattr(headers, "get"):
        raw = headers.get("retry-after") or headers.get("Retry-After")
    if raw is None:
        raw = getattr(exc, "retry_after", None)
    parsed = _parse_retry_after_value(raw)
    if parsed is not None:
        return parsed
    text = str(exc)
    match = _RETRY_AFTER_HEADER_RE.search(text)
    if match:
        return float(match.group(1))
    match = _RETRY_IN_RE.search(text)
    if not match:
        return None
    value = float(match.group(1))
    unit = (match.group(2) or "s").lower()
    if unit.startswith("h"):
        return value * 3600.0
    if unit.startswith("m"):
        return value * 60.0
    return value


def _parse_retry_after_value(raw: Any) -> float | None:
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        return float(raw) if raw >= 0 else None
    text = str(raw).strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _status_code(exc: BaseException) -> int | None:
    for attr in ("status_code", "status"):
        value = getattr(exc, attr, None)
        if isinstance(value, int):
            return value
    response = getattr(exc, "response", None)
    value = getattr(response, "status_code", None)
    return value if isinstance(value, int) else None


def classify_provider_error(
    exc: BaseException,
    *,
    max_server_delay_seconds: float = DEFAULT_MAX_SERVER_DELAY_SECONDS,
) -> ClassifiedError:
    if isinstance(exc, AgentRetryError):
        return exc.classified
    if isinstance(exc, StreamIdleError):
        return ClassifiedError(
            error_class="transient_transport",
            layer="api",
            retryable=True,
            user_message=USER_BUSY,
        )

    status = _status_code(exc)
    text = str(exc)
    retry_after = extract_retry_after_seconds(exc)

    if status in _FATAL_AUTH_STATUS or re.search(r"\b(?:invalid api key|incorrect api key|unauthorized)\b", text, re.I):
        return ClassifiedError("fatal", "api", False, USER_AUTH)
    if _QUOTA_RE.search(text) or status == 402:
        return ClassifiedError("quota_exhausted", "api", False, USER_CREDITS)
    if _CONTENT_FILTER_RE.search(text):
        return ClassifiedError("fatal", "api", False, USER_FILTER)
    if _CONTEXT_LENGTH_RE.search(text):
        return ClassifiedError("fatal", "context", False, USER_CONTEXT)

    rate_limited = status == 429 or bool(_RATE_LIMIT_RE.search(text))
    if rate_limited:
        if retry_after is not None and retry_after > max_server_delay_seconds:
            return ClassifiedError(
                "rate_limited",
                "api",
                False,
                USER_BUSY,
                retry_after_seconds=retry_after,
            )
        return ClassifiedError(
            "rate_limited",
            "api",
            True,
            USER_BUSY,
            retry_after_seconds=retry_after,
        )

    transient = status in _TRANSIENT_STATUS or bool(_TIMEOUT_RE.search(text))
    if transient:
        return ClassifiedError("transient_transport", "api", True, USER_BUSY, retry_after_seconds=retry_after)

    return ClassifiedError("fatal", "api", False, USER_GENERIC)


def retry_delay_seconds(
    policy: AgentRetryPolicy,
    attempt: int,
    retry_after_seconds: float | None = None,
    *,
    rng: random.Random | None = None,
) -> float:
    if retry_after_seconds is not None:
        return max(0.0, float(retry_after_seconds))
    base = min(policy.max_delay_seconds, policy.base_delay_seconds * (2 ** max(0, attempt)))
    jitter = (rng or random).uniform(0.5, 1.0)
    return max(0.0, base * jitter)


def capped_sleep_seconds(
    delay: float,
    *,
    remaining_job_seconds: float,
    reserve_seconds: float = JOB_SLEEP_RESERVE_SECONDS,
) -> float | None:
    """Return the sleep duration, or None if the job should fail instead of hanging."""
    budget = remaining_job_seconds - reserve_seconds
    if delay <= 0:
        return 0.0
    if budget < delay:
        return None
    return delay


def remaining_job_seconds(started_at: datetime | None, timeout_seconds: float, *, now: datetime | None = None) -> float:
    if timeout_seconds <= 0:
        return float("inf")
    if started_at is None:
        return timeout_seconds
    current = now or datetime.utcnow()
    if started_at.tzinfo is not None:
        current = current.replace(tzinfo=started_at.tzinfo) if current.tzinfo is None else current
    elapsed = (current - started_at).total_seconds()
    return max(0.0, timeout_seconds - elapsed)


def rq_timeout_value(timeout_seconds: int | float) -> int:
    """Map product timeout to RQ. ``0`` or negative means no wall-clock death penalty."""
    value = int(timeout_seconds)
    return -1 if value <= 0 else value


def extend_job_timeout_window(timeout_seconds: float) -> None:
    """Slide RQ's SIGALRM window forward while the run is still making progress.

    No-op when the job has no wall-clock cap. Cancel still stops the run.
    """
    value = int(timeout_seconds)
    if value <= 0:
        return
    try:
        import signal

        if hasattr(signal, "SIGALRM"):
            signal.alarm(value)
    except (ValueError, OSError, RuntimeError):
        return


def job_deadline(started_at: datetime | None, timeout_seconds: float) -> datetime:
    start = started_at or datetime.utcnow()
    return start + timedelta(seconds=timeout_seconds)


def tool_call_fingerprint(name: str, arguments: Any) -> str:
    try:
        args = json.dumps(arguments, sort_keys=True, default=str, ensure_ascii=False)
    except TypeError:
        args = str(arguments)
    return f"{name}:{args}"


@dataclass
class ToolFingerprintTracker:
    threshold: int = FINGERPRINT_BREAK_THRESHOLD
    counts: dict[str, int] = field(default_factory=dict)

    def record(self, name: str, arguments: Any) -> int:
        fingerprint = tool_call_fingerprint(name, arguments)
        self.counts[fingerprint] = self.counts.get(fingerprint, 0) + 1
        return self.counts[fingerprint]

    def should_circuit_break(self, name: str, arguments: Any) -> bool:
        return self.counts.get(tool_call_fingerprint(name, arguments), 0) >= self.threshold

    def broken_fingerprints(self) -> list[str]:
        return [key for key, count in self.counts.items() if count >= self.threshold]


def fingerprint_nudge_message(fingerprints: list[str]) -> str:
    names = ", ".join(fp.split(":", 1)[0] for fp in fingerprints) or "that tool"
    return (
        f"You already called {names} with the same arguments {FINGERPRINT_BREAK_THRESHOLD} times. "
        "Do not call it again with the same arguments. Use the existing tool results or finish the answer."
    )


def _message_tool_call_ids(message: dict[str, Any]) -> list[str]:
    ids: list[str] = []
    item_type = str(message.get("type") or "")
    if item_type in {"function_call", "tool_call"}:
        call_id = message.get("call_id") or message.get("id")
        if call_id:
            ids.append(str(call_id))
        return ids
    if message.get("role") != "assistant":
        return ids
    tool_calls = message.get("tool_calls")
    if not isinstance(tool_calls, list):
        return ids
    for call in tool_calls:
        if isinstance(call, dict):
            call_id = call.get("id") or call.get("call_id")
            if call_id:
                ids.append(str(call_id))
    return ids


def _message_tool_result_ids(message: dict[str, Any]) -> list[str]:
    item_type = str(message.get("type") or "")
    if item_type in {"function_call_output", "tool_result", "tool_call_output"}:
        call_id = message.get("call_id") or message.get("tool_call_id")
        return [str(call_id)] if call_id else []
    if message.get("role") == "tool":
        call_id = message.get("tool_call_id") or message.get("call_id")
        return [str(call_id)] if call_id else []
    return []


def _synthetic_tool_result(call_id: str, *, responses_api: bool) -> dict[str, Any]:
    if responses_api:
        return {"type": "function_call_output", "call_id": call_id, "output": UNPAIRED_TOOL_PLACEHOLDER}
    return {"role": "tool", "tool_call_id": call_id, "content": UNPAIRED_TOOL_PLACEHOLDER}


def repair_unpaired_tool_messages(messages: list[Any]) -> list[Any]:
    """Append placeholder tool results so the next provider call is a valid pairing."""
    if not messages:
        return messages
    call_ids: list[str] = []
    result_ids: set[str] = set()
    responses_api = False
    for item in messages:
        if not isinstance(item, dict):
            continue
        item_type = str(item.get("type") or "")
        if item_type in {"function_call", "function_call_output"}:
            responses_api = True
        call_ids.extend(_message_tool_call_ids(item))
        result_ids.update(_message_tool_result_ids(item))
    missing = [call_id for call_id in call_ids if call_id not in result_ids]
    if not missing:
        return list(messages)
    repaired = list(messages)
    for call_id in missing:
        repaired.append(_synthetic_tool_result(call_id, responses_api=responses_api))
    return repaired


async def anext_with_idle(async_iter: Any, idle_seconds: float) -> Any:
    if idle_seconds <= 0:
        return await anext(async_iter)
    try:
        return await asyncio.wait_for(anext(async_iter), timeout=idle_seconds)
    except TimeoutError as exc:
        raise StreamIdleError(idle_seconds) from exc


def _clamp_int(value: Any, minimum: int, maximum: int) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        number = minimum
    return max(minimum, min(maximum, number))
