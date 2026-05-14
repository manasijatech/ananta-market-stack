"""Reusable OpenAI-SDK helpers for OpenAI, OpenRouter, and Gemini.

This module is the single backend entrypoint for provider-aware LLM calls.
All three providers are intentionally routed through the `openai` Python SDK,
with provider-specific differences limited to API key lookup, base URL, and a
small amount of optional request metadata.

The helpers here are documented for later workflow reuse:

- `build_provider_client(...)`: create an OpenAI SDK client for a configured provider.
- `generate_text(...)`: simple text generation wrapper using Chat Completions for
  maximum cross-provider compatibility.
- `generate_text_response_api(...)`: Responses API wrapper for OpenAI-style text workflows.
- `build_text_part(...)` and `build_file_part(...)`: construct reusable content
  blocks for text-only, file-only, or mixed file+text prompts.
"""

from __future__ import annotations

import base64
from typing import Any

from openai import OpenAI
from sqlalchemy.orm import Session

from app.config import get_settings
from app.schemas.system_config import LlmProvider
from app.services import llm_config

_settings = get_settings()


def build_provider_client(
    db: Session,
    user_id: str,
    provider: LlmProvider,
    *,
    timeout: float | None = None,
) -> OpenAI:
    """Return an OpenAI SDK client configured for one supported provider.

    The provider-specific API key is decrypted at call time. For OpenRouter, we
    also set optional attribution headers when the app's public base URL is known.
    """

    definition = llm_config.provider_definition(provider)
    api_key = llm_config.get_provider_api_key(db, user_id, provider)
    kwargs: dict[str, Any] = {
        "api_key": api_key,
        "base_url": definition["base_url"],
    }
    if timeout is not None:
        kwargs["timeout"] = timeout
    if provider == "openrouter":
        default_headers: dict[str, str] = {}
        if _settings.app_public_base_url:
            default_headers["HTTP-Referer"] = _settings.app_public_base_url
        if _settings.app_name:
            default_headers["X-OpenRouter-Title"] = _settings.app_name
        if default_headers:
            kwargs["default_headers"] = default_headers
    return OpenAI(**kwargs)


def build_text_part(text: str) -> dict[str, Any]:
    """Create a text content part for chat-completions style multimodal inputs."""

    return {"type": "text", "text": text}


def build_file_part(*, filename: str, mime_type: str, data: bytes) -> dict[str, Any]:
    """Create a file content part using an inline base64 data URL.

    This format aligns with OpenAI's file-input guide and works well for the
    OpenAI-compatible Gemini path the user requested.
    """

    encoded = base64.b64encode(data).decode("utf-8")
    return {
        "type": "file",
        "file": {
            "filename": filename,
            "file_data": f"data:{mime_type};base64,{encoded}",
        },
    }


def build_user_message_content(
    *,
    text: str | None = None,
    files: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Assemble a user message payload for text-only, file-only, or mixed prompts."""

    content: list[dict[str, Any]] = []
    if files:
        content.extend(files)
    if text:
        content.append(build_text_part(text))
    return content


def generate_text(
    db: Session,
    user_id: str,
    provider: LlmProvider,
    *,
    model: str,
    developer_prompt: str | None = None,
    user_text: str | None = None,
    user_content: list[dict[str, Any]] | None = None,
    temperature: float | None = None,
    max_completion_tokens: int | None = None,
    stream: bool = False,
    extra_body: dict[str, Any] | None = None,
    timeout: float | None = None,
) -> Any:
    """Generate text via Chat Completions using a provider-specific OpenAI client.

    This is the safest cross-provider default for now because OpenRouter and the
    Gemini OpenAI-compatible endpoint both document chat-completions compatibility.
    Callers can pass either `user_text` or a prebuilt multimodal `user_content`.
    """

    client = build_provider_client(db, user_id, provider, timeout=timeout)
    messages: list[dict[str, Any]] = []
    if developer_prompt:
        messages.append({"role": "system", "content": developer_prompt})
    if user_content is not None:
        messages.append({"role": "user", "content": user_content})
    elif user_text is not None:
        messages.append({"role": "user", "content": user_text})
    else:
        raise ValueError("either user_text or user_content must be provided")

    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "stream": stream,
    }
    if temperature is not None:
        payload["temperature"] = temperature
    if max_completion_tokens is not None:
        payload["max_completion_tokens"] = max_completion_tokens
    if extra_body:
        payload["extra_body"] = extra_body
    return client.chat.completions.create(**payload)


def generate_text_response_api(
    db: Session,
    user_id: str,
    provider: LlmProvider,
    *,
    model: str,
    instructions: str | None = None,
    input_text: str,
    reasoning_effort: str | None = None,
) -> Any:
    """Generate text through the Responses API.

    Prefer this helper for new OpenAI-first text workflows that want the current
    Responses API shape. Cross-provider usage should still validate provider-side
    compatibility before relying on it broadly.
    """

    client = build_provider_client(db, user_id, provider)
    payload: dict[str, Any] = {
        "model": model,
        "input": input_text,
    }
    if instructions:
        payload["instructions"] = instructions
    if reasoning_effort:
        payload["reasoning"] = {"effort": reasoning_effort}
    return client.responses.create(**payload)
