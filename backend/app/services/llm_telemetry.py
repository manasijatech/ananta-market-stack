from __future__ import annotations

import contextlib
import logging
import os
import uuid
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any, Iterator, Mapping

logger = logging.getLogger(__name__)

_fallback_trace_id: ContextVar[str | None] = ContextVar("llm_fallback_trace_id", default=None)
_fallback_span_id: ContextVar[str | None] = ContextVar("llm_fallback_span_id", default=None)
_configured = False


def _new_trace_id() -> str:
    return uuid.uuid4().hex + uuid.uuid4().hex


def _new_span_id() -> str:
    return uuid.uuid4().hex[:16]


def _clean_attr_value(value: Any) -> str | int | float | bool | list[str] | None:
    if value is None:
        return None
    if isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, (list, tuple)) and all(isinstance(item, (str, int, float, bool)) for item in value):
        return [str(item) for item in value]
    return str(value)


@dataclass(slots=True)
class LlmSpanContext:
    trace_id: str | None = None
    span_id: str | None = None

    def attrs(self) -> dict[str, str]:
        out: dict[str, str] = {}
        if self.trace_id:
            out["trace_id"] = self.trace_id
        if self.span_id:
            out["span_id"] = self.span_id
        return out


def configure_llm_telemetry() -> None:
    """Configure optional OTLP export when the OpenTelemetry SDK is installed.

    Local telemetry does not require this setup. If the OTLP endpoint is absent
    or OTel packages are unavailable, fallback trace/span ids are still produced.
    """

    global _configured
    if _configured:
        return
    _configured = True
    endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT") or os.getenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT")
    if not endpoint:
        return
    try:
        from opentelemetry import trace
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        from opentelemetry.sdk.resources import SERVICE_NAME, Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor

        provider = trace.get_tracer_provider()
        if not isinstance(provider, TracerProvider):
            service_name = os.getenv("OTEL_SERVICE_NAME", "ananta-market-stack-backend")
            provider = TracerProvider(resource=Resource.create({SERVICE_NAME: service_name}))
            trace.set_tracer_provider(provider)
        provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
    except Exception:
        logger.exception("failed to configure optional OTLP LLM telemetry export")


def _otel_span_context() -> LlmSpanContext | None:
    try:
        from opentelemetry import trace

        span = trace.get_current_span()
        context = span.get_span_context()
        if not context or not context.is_valid:
            return None
        return LlmSpanContext(
            trace_id=format(context.trace_id, "032x"),
            span_id=format(context.span_id, "016x"),
        )
    except Exception:
        return None


def current_span_context() -> LlmSpanContext:
    otel = _otel_span_context()
    if otel:
        return otel
    return LlmSpanContext(trace_id=_fallback_trace_id.get(), span_id=_fallback_span_id.get())


@contextlib.contextmanager
def start_span(name: str, attributes: Mapping[str, Any] | None = None) -> Iterator[LlmSpanContext]:
    configure_llm_telemetry()
    attrs = {key: value for key, value in (attributes or {}).items() if value is not None}
    tracer = None
    try:
        from opentelemetry import trace

        tracer = trace.get_tracer("ananta.llm")
    except Exception:
        tracer = None

    if tracer is not None:
        with tracer.start_as_current_span(name) as span:
            for key, value in attrs.items():
                clean = _clean_attr_value(value)
                if clean is not None:
                    span.set_attribute(key, clean)
            yield current_span_context()
            return

    parent_trace_id = _fallback_trace_id.get()
    trace_id = parent_trace_id or _new_trace_id()
    span_id = _new_span_id()
    trace_token = _fallback_trace_id.set(trace_id)
    span_token = _fallback_span_id.set(span_id)
    try:
        yield LlmSpanContext(trace_id=trace_id, span_id=span_id)
    finally:
        _fallback_span_id.reset(span_token)
        _fallback_trace_id.reset(trace_token)


def set_current_span_attributes(attributes: Mapping[str, Any]) -> None:
    if not attributes:
        return
    try:
        from opentelemetry import trace

        span = trace.get_current_span()
        context = span.get_span_context()
        if not context or not context.is_valid:
            return
        for key, value in attributes.items():
            clean = _clean_attr_value(value)
            if clean is not None:
                span.set_attribute(key, clean)
    except Exception:
        return
