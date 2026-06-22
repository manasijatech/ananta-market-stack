from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class HeatmapAlphaEventTagOut(BaseModel):
    tag: str
    count: int


class HeatmapAlphaEventOut(BaseModel):
    id: str
    product: str
    event_key: str
    received_at: datetime
    processed_at: datetime | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


class HeatmapAlphaEventSummaryOut(BaseModel):
    total_count: int = 0
    tags: list[HeatmapAlphaEventTagOut] = Field(default_factory=list)
    latest_received_at: datetime | None = None


class HeatmapSymbolOut(BaseModel):
    symbol: str
    exchange: str | None = None
    broker_code: str
    account_id: str
    ltp: float
    day_change: float | None = None
    day_change_perc: float | None = None
    open: float | None = None
    high: float | None = None
    low: float | None = None
    close: float | None = None
    volume: float | None = None
    market_cap: int | float | str | None = None
    company_name: str | None = None
    logo: str | None = None
    sector: str | None = None
    basic_industry: str | None = None
    industry: str | None = None
    theme: str | None = None
    health_status: str = "unknown"
    health_reason: str = ""
    last_received_at: datetime | None = None
    source_kinds: list[str] = Field(default_factory=list)
    alpha_event_summary: HeatmapAlphaEventSummaryOut = Field(default_factory=HeatmapAlphaEventSummaryOut)
    alpha_events: list[HeatmapAlphaEventOut] = Field(default_factory=list)
    live_data: dict[str, Any] = Field(default_factory=dict)


class HeatmapResponseOut(BaseModel):
    scope: Literal["tracked", "watchlist", "portfolio_holdings"] = "tracked"
    scope_label: str = "Tracked symbols"
    selection_id: str | None = None
    broker_code: str | None = None
    account_id: str | None = None
    requested_limit: int
    returned_count: int
    tracked_symbol_count: int = 0
    days: int | None = None
    items: list[HeatmapSymbolOut] = Field(default_factory=list)
