from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.broker import InstrumentRef


class WatchlistCreateIn(BaseModel):
    name: str = Field(..., max_length=128)
    symbols: list[str] = Field(default_factory=list)


class WatchlistUpdateIn(BaseModel):
    name: str | None = Field(default=None, max_length=128)


class WatchlistSymbolCreateIn(BaseModel):
    symbol: str
    exchange: str | None = None
    account_id: str | None = None
    broker_code: str | None = None
    instrument_ref: InstrumentRef = Field(default_factory=InstrumentRef)


class WatchlistSymbolsBulkIn(BaseModel):
    symbols: list[str] = Field(default_factory=list)
    exchange: str | None = None
    items: list[WatchlistSymbolCreateIn] = Field(default_factory=list)


class WatchlistSymbolsReplaceIn(BaseModel):
    symbols: list[WatchlistSymbolCreateIn] = Field(default_factory=list)


class WatchlistSymbolOut(BaseModel):
    id: str
    symbol: str
    exchange: str | None = None
    instrument_ref: InstrumentRef = Field(default_factory=InstrumentRef)
    sort_order: int
    created_at: datetime


class WatchlistOut(BaseModel):
    id: str
    user_id: str
    name: str
    kind: str = "manual"
    is_editable: bool = True
    preset_id: str | None = None
    preset_slug: str | None = None
    preset_sync_status: str | None = None
    preset_last_synced_at: datetime | None = None
    symbols: list[str] = Field(default_factory=list)
    items: list[WatchlistSymbolOut] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class WatchlistSymbolsBulkOut(BaseModel):
    watchlist: WatchlistOut
    added_symbols: list[str] = Field(default_factory=list)
    skipped_symbols: list[str] = Field(default_factory=list)


class WatchlistPresetCatalogEntryOut(BaseModel):
    id: str
    slug: str
    name: str
    trading_index_name: str
    constituent_csv_url: str | None = None
    constituent_count: int = 0
    is_popular: bool = False
    auto_sync_enabled: bool = False
    sync_status: str
    sync_error: str | None = None
    last_catalog_sync_at: datetime | None = None
    last_constituents_sync_at: datetime | None = None
    is_added: bool = False
    user_watchlist_id: str | None = None


class WatchlistPresetAddIn(BaseModel):
    preset_id: str
