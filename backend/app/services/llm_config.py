from __future__ import annotations

import json
import re
import uuid
from datetime import datetime
from typing import Any

import requests
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.schemas.system_config import (
    LlmModelCreateIn,
    LlmModelOut,
    LlmModelPricingOut,
    LlmModelPricingUpsertIn,
    LlmModelUpdateIn,
    LlmProvider,
    LlmProviderConfigOut,
    LlmProviderCredentialUpsertIn,
)
from app.services import rbac
from broker.crypto import decrypt_value, decrypt_value_or_none, encrypt_value
from common.datetime_compat import UTC
from db.models import LlmModelPricing, UserLlmModel, UserLlmProviderCredential

REASONING_EFFORTS = {"none", "minimal", "low", "medium", "high", "xhigh"}


def normalize_reasoning_effort(value: Any) -> str | None:
    """Return a supported OpenRouter/OpenAI effort level, or None for provider default."""

    if value is None:
        return None
    cleaned = str(value).strip().lower()
    if cleaned in {"", "default", "auto"}:
        return None
    if cleaned not in REASONING_EFFORTS:
        raise ValueError(
            "Reasoning effort must be one of none, minimal, low, medium, high, xhigh, or left empty for the model default."
        )
    return cleaned


def get_model_reasoning_effort(db: Session, user_id: str, provider: str, model_id: str) -> str | None:
    owner_user_id = rbac.workspace_config_owner_user_id(db, user_id)
    row = db.scalars(
        select(UserLlmModel).where(
            UserLlmModel.user_id == owner_user_id,
            UserLlmModel.provider == provider,
            UserLlmModel.model_id == model_id,
        )
    ).first()
    if row is None:
        return None
    try:
        return normalize_reasoning_effort(row.reasoning_effort)
    except ValueError:
        return None


def normalize_provider_model_id(provider: str, model_id: str) -> str:
    """Normalize a model id the same way it is stored.

    OpenRouter ids may carry a leading `~` shorthand in the UI; strip it so
    lookups match the stored row. Other providers are stripped of surrounding
    whitespace only.
    """

    cleaned = (model_id or "").strip()
    if provider == "openrouter":
        while cleaned.startswith("~"):
            cleaned = cleaned[1:].lstrip()
    return cleaned


_OPENROUTER_PROVIDER_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9._\-/]*$")
MAX_OPENROUTER_PROVIDERS = 5


def normalize_openrouter_providers(value: Any) -> list[str]:
    """Normalize an OpenRouter provider preference into an ordered slug list.

    Accepts a list/tuple of slugs, a comma/whitespace/newline separated string,
    a JSON-encoded list string, or None. Returns deduped lowercase slugs in the
    user-specified fallback order. Raises ValueError with a user-friendly
    message on invalid input.
    """

    if value is None:
        return []
    candidates: list[Any] = []
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return []
        try:
            parsed = json.loads(stripped)
        except (json.JSONDecodeError, ValueError):
            parsed = None
        if isinstance(parsed, list):
            candidates = parsed
        elif isinstance(parsed, str):
            candidates = [parsed]
        elif parsed is None:
            # Plain text: split on commas, whitespace, and newlines.
            candidates = [part for part in re.split(r"[\s,;]+", stripped) if part]
        else:
            raise ValueError(
                "OpenRouter providers must be a list of provider names or a comma-separated string."
            )
    elif isinstance(value, (list, tuple)):
        candidates = list(value)
    else:
        raise ValueError(
            "OpenRouter providers must be a list of provider names or a comma-separated string."
        )
    seen: set[str] = set()
    out: list[str] = []
    for item in candidates:
        cleaned = str(item or "").strip().lower()
        if not cleaned:
            continue
        if len(cleaned) > 64 or not _OPENROUTER_PROVIDER_SLUG_RE.match(cleaned):
            raise ValueError(
                f"Invalid OpenRouter provider '{item}'. Use the provider slug from the OpenRouter model page "
                "(lowercase letters, numbers, '-', '_', '.', '/'), e.g. 'together' or 'deepinfra/turbo'."
            )
        if cleaned in seen:
            continue
        seen.add(cleaned)
        out.append(cleaned)
    if len(out) > MAX_OPENROUTER_PROVIDERS:
        raise ValueError(
            f"Save at most {MAX_OPENROUTER_PROVIDERS} OpenRouter providers per model "
            "(listed in fallback order)."
        )
    return out


def normalize_openrouter_allow_fallbacks(value: Any) -> bool:
    """Normalize the allow-fallbacks toggle (default True)."""

    if value is None:
        return True
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        cleaned = value.strip().lower()
        if cleaned in {"", "default", "auto"}:
            return True
        if cleaned in {"1", "true", "yes", "y", "on", "allow", "allowed"}:
            return True
        if cleaned in {"0", "false", "no", "n", "off", "deny", "denied", "disabled"}:
            return False
    raise ValueError("OpenRouter fallback preference must be true or false.")


def build_openrouter_provider_prefs(
    providers: list[str] | None,
    allow_fallbacks: bool = True,
) -> dict[str, Any] | None:
    """Build the OpenRouter `provider` request object, or None for default routing.

    Uses `order` (fallback order) + `allow_fallbacks`, per
    https://openrouter.ai/docs/features/provider-routing. Empty provider lists
    return None so the request uses OpenRouter's automatic routing.
    """

    ordered = list(providers or [])
    if not ordered:
        return None
    return {"order": ordered, "allow_fallbacks": bool(allow_fallbacks)}


def get_model_openrouter_routing(
    db: Session, user_id: str, provider: str, model_id: str
) -> tuple[list[str], bool]:
    """Return (providers, allow_fallbacks) for a saved model.

    Returns ([], True) when the model has no custom routing, is not an
    OpenRouter model, or is unknown. Never raises for missing rows or legacy
    databases without the new columns.
    """

    if provider != "openrouter":
        return [], True
    try:
        owner_user_id = rbac.workspace_config_owner_user_id(db, user_id)
    except Exception:
        return [], True
    try:
        lookup_id = normalize_provider_model_id(provider, model_id)
        row = db.scalars(
            select(UserLlmModel).where(
                UserLlmModel.user_id == owner_user_id,
                UserLlmModel.provider == provider,
                UserLlmModel.model_id == lookup_id,
            )
        ).first()
        if row is None and lookup_id != (model_id or "").strip():
            row = db.scalars(
                select(UserLlmModel).where(
                    UserLlmModel.user_id == owner_user_id,
                    UserLlmModel.provider == provider,
                    UserLlmModel.model_id == (model_id or "").strip(),
                )
            ).first()
        if row is None:
            return [], True
        try:
            providers = normalize_openrouter_providers(getattr(row, "openrouter_providers_json", None))
        except ValueError:
            providers = []
        allow_fallbacks = getattr(row, "openrouter_allow_fallbacks", True)
        return providers, bool(allow_fallbacks if allow_fallbacks is not None else True)
    except Exception:
        return [], True


def merge_openrouter_extra_body(
    base_extra_body: dict[str, Any] | None,
    *,
    reasoning_effort: str | None = None,
    providers: list[str] | None = None,
    allow_fallbacks: bool = True,
) -> dict[str, Any] | None:
    """Merge OpenRouter-only keys into an extra_body dict without clobbering callers.

    Preserves existing `reasoning`/`provider`/`usage` keys when the caller set
    them explicitly; only fills in missing pieces from the saved model config.
    Returns None when the merged body is empty.
    """

    merged: dict[str, Any] = dict(base_extra_body or {})
    if reasoning_effort and "reasoning" not in merged:
        merged["reasoning"] = {"effort": reasoning_effort}
    prefs = build_openrouter_provider_prefs(providers, allow_fallbacks)
    if prefs is not None and "provider" not in merged:
        merged["provider"] = prefs
    return merged or None


def snapshot_openrouter_routing_for_metadata(
    providers: Any, allow_fallbacks: Any
) -> tuple[list[str], bool]:
    """Normalize routing values for snapshotting into run metadata.

    Raises ValueError on invalid input (surfaced as a 400 at run creation).
    """

    return normalize_openrouter_providers(providers), normalize_openrouter_allow_fallbacks(
        allow_fallbacks if allow_fallbacks is not None else True
    )


def routing_from_metadata(metadata: dict[str, Any] | None) -> tuple[list[str], bool]:
    """Read a routing snapshot from run metadata, tolerating old runs.

    Old runs without a snapshot return ([], True) meaning default routing.
    Never raises.
    """

    if not isinstance(metadata, dict):
        return [], True
    try:
        providers = normalize_openrouter_providers(metadata.get("openrouter_providers"))
    except ValueError:
        providers = []
    try:
        allow_fallbacks = normalize_openrouter_allow_fallbacks(
            metadata.get("openrouter_allow_fallbacks", True)
        )
    except ValueError:
        allow_fallbacks = True
    return providers, allow_fallbacks


_PROVIDER_DEFINITIONS: dict[LlmProvider, dict[str, str]] = {
    "openai": {
        "label": "OpenAI",
        "base_url": "https://api.openai.com/v1",
    },
    "openrouter": {
        "label": "OpenRouter",
        "base_url": "https://openrouter.ai/api/v1",
    },
    "gemini": {
        "label": "Gemini",
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai/",
        "documentation_url": "https://ai.google.dev/gemini-api/docs/openai",
    },
    "anthropic": {
        "label": "Anthropic",
        "base_url": "https://api.anthropic.com/v1/",
        "documentation_url": "https://platform.claude.com/docs/en/api/openai-sdk",
    },
}


def _build_api_key_hint(api_key: str) -> str | None:
    """Return a non-reversible display hint for a stored API key.

    Read APIs never return the real secret. This helper emits only a minimal
    masked clue so the UI can show that a key is already configured after a
    reload, while still forcing users to re-enter the full key when replacing it.
    """

    cleaned = (api_key or "").strip()
    if not cleaned:
        return None
    visible_suffix = cleaned[-4:] if len(cleaned) >= 4 else cleaned
    return ("*" * 8) + visible_suffix


def provider_definitions() -> dict[LlmProvider, dict[str, str]]:
    """Return the fixed catalog of supported LLM providers.

    The backend intentionally keeps provider metadata centralized so later workflows
    can resolve a provider's OpenAI-compatible base URL without duplicating strings
    in routes, UI handlers, or workflow runners.
    """

    return _PROVIDER_DEFINITIONS


def provider_definition(provider: LlmProvider) -> dict[str, str]:
    if provider not in _PROVIDER_DEFINITIONS:
        raise ValueError(f"unsupported llm provider: {provider}")
    return _PROVIDER_DEFINITIONS[provider]


def list_provider_configs(db: Session, user_id: str) -> list[LlmProviderConfigOut]:
    owner_user_id = rbac.workspace_config_owner_user_id(db, user_id)
    credentials = list(
        db.scalars(
            select(UserLlmProviderCredential).where(UserLlmProviderCredential.user_id == owner_user_id)
        ).all()
    )
    credential_by_provider = {row.provider: row for row in credentials}
    models = list(
        db.scalars(
            select(UserLlmModel)
            .where(UserLlmModel.user_id == owner_user_id)
            .order_by(UserLlmModel.provider.asc(), UserLlmModel.created_at.asc(), UserLlmModel.id.asc())
        ).all()
    )
    models_by_provider: dict[str, list[UserLlmModel]] = {}
    for row in models:
        models_by_provider.setdefault(row.provider, []).append(row)

    out: list[LlmProviderConfigOut] = []
    for provider, definition in _PROVIDER_DEFINITIONS.items():
        credential = credential_by_provider.get(provider)
        provider_models = models_by_provider.get(provider, [])
        plain_key = decrypt_value_or_none(credential.api_key_cipher if credential else None)
        out.append(
            LlmProviderConfigOut(
                provider=provider,
                label=definition["label"],
                base_url=definition["base_url"],
                has_api_key=bool(credential and credential.api_key_cipher),
                api_key_hint=_build_api_key_hint(plain_key) if plain_key else None,
                is_enabled=bool(credential and credential.is_enabled),
                api_key_updated_at=credential.updated_at if credential else None,
                models=[LlmModelOut.model_validate(row) for row in provider_models],
                documentation_url=definition.get("documentation_url"),
            )
        )
    return out


def upsert_provider_credential(
    db: Session,
    user_id: str,
    provider: LlmProvider,
    payload: LlmProviderCredentialUpsertIn,
) -> LlmProviderConfigOut:
    provider_definition(provider)
    owner_user_id = rbac.workspace_config_owner_user_id(db, user_id)
    row = db.scalars(
        select(UserLlmProviderCredential).where(
            UserLlmProviderCredential.user_id == owner_user_id,
            UserLlmProviderCredential.provider == provider,
        )
    ).first()
    if row is None:
        row = UserLlmProviderCredential(
            id=str(uuid.uuid4()),
            user_id=owner_user_id,
            provider=provider,
        )
    row.api_key_cipher = encrypt_value(payload.api_key)
    row.is_enabled = payload.is_enabled
    db.add(row)
    db.commit()
    return next(item for item in list_provider_configs(db, owner_user_id) if item.provider == provider)


def delete_provider_credential(
    db: Session,
    user_id: str,
    provider: LlmProvider,
) -> list[LlmProviderConfigOut]:
    owner_user_id = rbac.workspace_config_owner_user_id(db, user_id)
    row = db.scalars(
        select(UserLlmProviderCredential).where(
            UserLlmProviderCredential.user_id == owner_user_id,
            UserLlmProviderCredential.provider == provider,
        )
    ).first()
    if row is not None:
        db.delete(row)
        db.commit()
    return list_provider_configs(db, owner_user_id)


def _resolve_model_routing_for_write(
    provider: str,
    providers_value: Any,
    allow_fallbacks_value: Any,
    *,
    providers_set: bool,
    allow_fallbacks_set: bool,
    existing_providers: list[str] | None = None,
    existing_allow_fallbacks: bool = True,
) -> tuple[list[str], bool]:
    """Resolve OpenRouter routing for model create/update.

    Non-OpenRouter providers always store empty routing. For OpenRouter, unset
    fields keep existing values on update (defaults on create).
    """

    if provider != "openrouter":
        if providers_set and normalize_openrouter_providers(providers_value):
            raise ValueError("OpenRouter providers can only be set on openrouter models.")
        return [], True
    providers = (
        normalize_openrouter_providers(providers_value)
        if providers_set
        else list(existing_providers or [])
    )
    allow_fallbacks = (
        normalize_openrouter_allow_fallbacks(allow_fallbacks_value)
        if allow_fallbacks_set
        else bool(existing_allow_fallbacks if existing_allow_fallbacks is not None else True)
    )
    if not providers and not allow_fallbacks:
        # Disabling fallbacks without pinning a provider would guarantee failure;
        # reset to default routing instead of storing a broken config.
        allow_fallbacks = True
    return providers, allow_fallbacks


def add_provider_model(
    db: Session,
    user_id: str,
    payload: LlmModelCreateIn,
) -> list[LlmProviderConfigOut]:
    provider_definition(payload.provider)
    owner_user_id = rbac.workspace_config_owner_user_id(db, user_id)
    if not provider_has_api_key(db, owner_user_id, payload.provider):
        raise ValueError(f"{payload.provider} API key must be configured before saving models")
    model_id = normalize_provider_model_id(payload.provider, payload.model_id)
    if not model_id:
        raise ValueError("model_id must not be empty")
    existing = db.scalars(
        select(UserLlmModel).where(
            UserLlmModel.user_id == owner_user_id,
            UserLlmModel.provider == payload.provider,
            UserLlmModel.model_id == model_id,
        )
    ).first()
    reasoning_effort = normalize_reasoning_effort(payload.reasoning_effort)
    providers, allow_fallbacks = _resolve_model_routing_for_write(
        payload.provider,
        getattr(payload, "openrouter_providers", None),
        getattr(payload, "openrouter_allow_fallbacks", None),
        providers_set="openrouter_providers" in payload.model_fields_set,
        allow_fallbacks_set="openrouter_allow_fallbacks" in payload.model_fields_set,
    )
    if existing is not None:
        existing.label = payload.label
        existing.is_enabled = payload.is_enabled
        existing.reasoning_effort = reasoning_effort
        existing.openrouter_providers_json = _json_dumps(providers)
        existing.openrouter_allow_fallbacks = allow_fallbacks
        db.add(existing)
        db.commit()
        return list_provider_configs(db, owner_user_id)
    row = UserLlmModel(
        id=str(uuid.uuid4()),
        user_id=owner_user_id,
        provider=payload.provider,
        model_id=model_id,
        label=payload.label,
        reasoning_effort=reasoning_effort,
        openrouter_providers_json=_json_dumps(providers),
        openrouter_allow_fallbacks=allow_fallbacks,
        is_enabled=payload.is_enabled,
    )
    db.add(row)
    db.commit()
    return list_provider_configs(db, owner_user_id)


def update_provider_model(
    db: Session,
    user_id: str,
    model_row_id: str,
    payload: LlmModelUpdateIn,
) -> list[LlmProviderConfigOut]:
    owner_user_id = rbac.workspace_config_owner_user_id(db, user_id)
    row = db.get(UserLlmModel, model_row_id)
    if row is None or row.user_id != owner_user_id:
        raise ValueError("llm model not found")
    if "label" in payload.model_fields_set:
        row.label = payload.label
    if "is_enabled" in payload.model_fields_set and payload.is_enabled is not None:
        row.is_enabled = payload.is_enabled
    if "reasoning_effort" in payload.model_fields_set:
        row.reasoning_effort = normalize_reasoning_effort(payload.reasoning_effort)
    if "openrouter_providers" in payload.model_fields_set or "openrouter_allow_fallbacks" in payload.model_fields_set:
        try:
            existing_providers = normalize_openrouter_providers(
                getattr(row, "openrouter_providers_json", None)
            )
        except ValueError:
            existing_providers = []
        providers, allow_fallbacks = _resolve_model_routing_for_write(
            row.provider,
            getattr(payload, "openrouter_providers", None),
            getattr(payload, "openrouter_allow_fallbacks", None),
            providers_set="openrouter_providers" in payload.model_fields_set,
            allow_fallbacks_set="openrouter_allow_fallbacks" in payload.model_fields_set,
            existing_providers=existing_providers,
            existing_allow_fallbacks=getattr(row, "openrouter_allow_fallbacks", True),
        )
        row.openrouter_providers_json = _json_dumps(providers)
        row.openrouter_allow_fallbacks = allow_fallbacks
    db.add(row)
    db.commit()
    return list_provider_configs(db, owner_user_id)


def delete_provider_model(db: Session, user_id: str, model_row_id: str) -> list[LlmProviderConfigOut]:
    owner_user_id = rbac.workspace_config_owner_user_id(db, user_id)
    row = db.get(UserLlmModel, model_row_id)
    if row is not None and row.user_id == owner_user_id:
        db.delete(row)
        db.commit()
    return list_provider_configs(db, owner_user_id)


def get_provider_api_key(db: Session, user_id: str, provider: LlmProvider) -> str:
    """Decrypt and return the stored API key for a provider.

    Workflow helpers should use this instead of reading encrypted DB fields directly.
    That keeps the encryption boundary centralized and makes future secret-management
    upgrades easier.
    """

    owner_user_id = rbac.workspace_config_owner_user_id(db, user_id)
    row = db.scalars(
        select(UserLlmProviderCredential).where(
            UserLlmProviderCredential.user_id == owner_user_id,
            UserLlmProviderCredential.provider == provider,
            UserLlmProviderCredential.is_enabled.is_(True),
        )
    ).first()
    if row is None or not row.api_key_cipher:
        raise ValueError(f"{provider} API key is not configured")
    return decrypt_value(row.api_key_cipher)


def provider_has_api_key(db: Session, user_id: str, provider: LlmProvider) -> bool:
    owner_user_id = rbac.workspace_config_owner_user_id(db, user_id)
    row = db.scalars(
        select(UserLlmProviderCredential).where(
            UserLlmProviderCredential.user_id == owner_user_id,
            UserLlmProviderCredential.provider == provider,
            UserLlmProviderCredential.is_enabled.is_(True),
        )
    ).first()
    return bool(row and row.api_key_cipher)


def list_provider_models(db: Session, user_id: str, provider: LlmProvider) -> list[UserLlmModel]:
    owner_user_id = rbac.workspace_config_owner_user_id(db, user_id)
    return list(
        db.scalars(
            select(UserLlmModel).where(
                UserLlmModel.user_id == owner_user_id,
                UserLlmModel.provider == provider,
                UserLlmModel.is_enabled.is_(True),
            )
        ).all()
    )


def system_provider_summary(db: Session, user_id: str) -> dict[str, Any]:
    return {
        "llm_providers": [item.model_dump(mode="json") for item in list_provider_configs(db, user_id)],
    }


def _json_dumps(value: Any) -> str:
    return json.dumps(value, default=str, separators=(",", ":"))


def _json_loads(value: str | None, default: Any) -> Any:
    if not value:
        return default
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return default


def _pricing_to_out(row: LlmModelPricing) -> LlmModelPricingOut:
    return LlmModelPricingOut(
        id=row.id,
        provider=row.provider,
        model_id=row.model_id,
        input_cost_per_1m_tokens=row.input_cost_per_1m_tokens,
        output_cost_per_1m_tokens=row.output_cost_per_1m_tokens,
        cached_input_cost_per_1m_tokens=row.cached_input_cost_per_1m_tokens,
        cache_write_cost_per_1m_tokens=row.cache_write_cost_per_1m_tokens,
        reasoning_cost_per_1m_tokens=row.reasoning_cost_per_1m_tokens,
        input_audio_cost_per_1m_tokens=row.input_audio_cost_per_1m_tokens,
        output_audio_cost_per_1m_tokens=row.output_audio_cost_per_1m_tokens,
        source=row.source,
        source_url=row.source_url,
        metadata=_json_loads(row.metadata_json, {}),
        effective_from=row.effective_from,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def list_model_pricing(db: Session, user_id: str) -> list[LlmModelPricingOut]:
    owner_user_id = rbac.workspace_config_owner_user_id(db, user_id)
    rows = db.scalars(
        select(LlmModelPricing)
        .where(LlmModelPricing.user_id == owner_user_id)
        .order_by(LlmModelPricing.provider.asc(), LlmModelPricing.model_id.asc())
    ).all()
    return [_pricing_to_out(row) for row in rows]


def upsert_model_pricing(db: Session, user_id: str, payload: LlmModelPricingUpsertIn) -> LlmModelPricingOut:
    provider_definition(payload.provider)
    owner_user_id = rbac.workspace_config_owner_user_id(db, user_id)
    now = datetime.now(tz=UTC).replace(tzinfo=None)
    row = db.scalars(
        select(LlmModelPricing).where(
            LlmModelPricing.user_id == owner_user_id,
            LlmModelPricing.provider == payload.provider,
            LlmModelPricing.model_id == payload.model_id,
        )
    ).first()
    if row is None:
        row = LlmModelPricing(
            id=str(uuid.uuid4()),
            user_id=owner_user_id,
            provider=payload.provider,
            model_id=payload.model_id,
            created_at=now,
        )
    for field in (
        "input_cost_per_1m_tokens",
        "output_cost_per_1m_tokens",
        "cached_input_cost_per_1m_tokens",
        "cache_write_cost_per_1m_tokens",
        "reasoning_cost_per_1m_tokens",
        "input_audio_cost_per_1m_tokens",
        "output_audio_cost_per_1m_tokens",
        "source_url",
        "effective_from",
    ):
        setattr(row, field, getattr(payload, field))
    row.source = "manual"
    row.metadata_json = _json_dumps(payload.metadata)
    row.updated_at = now
    db.add(row)
    db.commit()
    db.refresh(row)
    return _pricing_to_out(row)


def delete_model_pricing(db: Session, user_id: str, pricing_id: str) -> list[LlmModelPricingOut]:
    owner_user_id = rbac.workspace_config_owner_user_id(db, user_id)
    row = db.get(LlmModelPricing, pricing_id)
    if row is not None and row.user_id == owner_user_id:
        db.delete(row)
        db.commit()
    return list_model_pricing(db, user_id)


def _per_token_to_per_1m(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed * 1_000_000


def refresh_openrouter_model_pricing(db: Session, user_id: str) -> list[LlmModelPricingOut]:
    owner_user_id = rbac.workspace_config_owner_user_id(db, user_id)
    response = requests.get("https://openrouter.ai/api/v1/models", timeout=20)
    response.raise_for_status()
    payload = response.json()
    models = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(models, list):
        raise ValueError("OpenRouter pricing response did not include a model list")

    saved_models = {
        row.model_id
        for row in db.scalars(
            select(UserLlmModel).where(
                UserLlmModel.user_id == owner_user_id,
                UserLlmModel.provider == "openrouter",
            )
        ).all()
    }
    now = datetime.now(tz=UTC).replace(tzinfo=None)
    for item in models:
        if not isinstance(item, dict):
            continue
        model_id = str(item.get("id") or "").strip()
        if not model_id or (saved_models and model_id not in saved_models):
            continue
        pricing = item.get("pricing")
        if not isinstance(pricing, dict):
            continue
        row = db.scalars(
            select(LlmModelPricing).where(
                LlmModelPricing.user_id == owner_user_id,
                LlmModelPricing.provider == "openrouter",
                LlmModelPricing.model_id == model_id,
            )
        ).first()
        if row is None:
            row = LlmModelPricing(
                id=str(uuid.uuid4()),
                user_id=owner_user_id,
                provider="openrouter",
                model_id=model_id,
                created_at=now,
            )
        row.input_cost_per_1m_tokens = _per_token_to_per_1m(pricing.get("prompt"))
        row.output_cost_per_1m_tokens = _per_token_to_per_1m(pricing.get("completion"))
        row.cached_input_cost_per_1m_tokens = _per_token_to_per_1m(pricing.get("input_cache_read"))
        row.cache_write_cost_per_1m_tokens = _per_token_to_per_1m(pricing.get("input_cache_write"))
        row.source = "openrouter_pricing"
        row.source_url = "https://openrouter.ai/api/v1/models"
        row.metadata_json = _json_dumps({"raw_pricing": pricing})
        row.updated_at = now
        db.add(row)
    db.commit()
    return list_model_pricing(db, user_id)
