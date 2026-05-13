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
    symbols: list[str] = Field(default_factory=list)
    items: list[WatchlistSymbolOut] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class WatchlistSymbolsBulkOut(BaseModel):
    watchlist: WatchlistOut
    added_symbols: list[str] = Field(default_factory=list)
    skipped_symbols: list[str] = Field(default_factory=list)
