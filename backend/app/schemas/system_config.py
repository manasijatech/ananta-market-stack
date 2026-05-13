from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.broker import BrokerDataSearchConfigOut

LlmProvider = Literal["openai", "openrouter", "gemini"]


class LlmModelOut(BaseModel):
    id: str
    provider: LlmProvider
    model_id: str
    label: str | None = None
    is_enabled: bool = True
    created_at: datetime
    updated_at: datetime


class LlmProviderConfigOut(BaseModel):
    provider: LlmProvider
    label: str
    base_url: str
    has_api_key: bool = False
    api_key_hint: str | None = None
    is_enabled: bool = False
    api_key_updated_at: datetime | None = None
    models: list[LlmModelOut] = Field(default_factory=list)
    documentation_url: str | None = None


class LlmProviderCredentialUpsertIn(BaseModel):
    api_key: str = Field(..., min_length=1)
    is_enabled: bool = True


class LlmModelCreateIn(BaseModel):
    provider: LlmProvider
    model_id: str = Field(..., min_length=1, max_length=256)
    label: str | None = Field(default=None, max_length=128)
    is_enabled: bool = True


class SystemConfigOut(BaseModel):
    broker_data_search: BrokerDataSearchConfigOut
    llm_providers: list[LlmProviderConfigOut] = Field(default_factory=list)
