from __future__ import annotations

import json
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
    LlmProvider,
    LlmProviderConfigOut,
    LlmProviderCredentialUpsertIn,
)
from app.services import rbac
from broker.crypto import decrypt_value, encrypt_value
from common.datetime_compat import UTC
from db.models import LlmModelPricing, UserLlmModel, UserLlmProviderCredential

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
        out.append(
            LlmProviderConfigOut(
                provider=provider,
                label=definition["label"],
                base_url=definition["base_url"],
                has_api_key=bool(credential and credential.api_key_cipher),
                api_key_hint=_build_api_key_hint(decrypt_value(credential.api_key_cipher))
                if credential and credential.api_key_cipher
                else None,
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


def add_provider_model(
    db: Session,
    user_id: str,
    payload: LlmModelCreateIn,
) -> list[LlmProviderConfigOut]:
    provider_definition(payload.provider)
    owner_user_id = rbac.workspace_config_owner_user_id(db, user_id)
    if not provider_has_api_key(db, owner_user_id, payload.provider):
        raise ValueError(f"{payload.provider} API key must be configured before saving models")
    existing = db.scalars(
        select(UserLlmModel).where(
            UserLlmModel.user_id == owner_user_id,
            UserLlmModel.provider == payload.provider,
            UserLlmModel.model_id == payload.model_id,
        )
    ).first()
    if existing is not None:
        existing.label = payload.label
        existing.is_enabled = payload.is_enabled
        db.add(existing)
        db.commit()
        return list_provider_configs(db, owner_user_id)
    row = UserLlmModel(
        id=str(uuid.uuid4()),
        user_id=owner_user_id,
        provider=payload.provider,
        model_id=payload.model_id,
        label=payload.label,
        is_enabled=payload.is_enabled,
    )
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
