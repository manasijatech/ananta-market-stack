from __future__ import annotations

from pydantic import BaseModel, Field


class AlphaSymbolMetadata(BaseModel):
    symbol: str
    company_name: str | None = None
    logo: str | None = None
    market_cap: int | float | str | None = None
    sector: str | None = None
    basic_industry: str | None = None
    industry: str | None = None
    macro_economic_indicator: str | None = None
    theme: str | None = None
    scrip_code: str | None = None


class AlphaSymbolMetadataResponse(BaseModel):
    data: list[AlphaSymbolMetadata] = Field(default_factory=list)


class AlphaSymbolMetadataBulkRequest(BaseModel):
    symbols: list[str] = Field(min_length=1, max_length=1_000)
    force_refresh: bool = False
