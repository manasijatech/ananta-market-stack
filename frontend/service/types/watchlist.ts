import type { InstrumentRef } from "@/service/types/alerts";

export interface WatchlistSymbol {
  id: string;
  symbol: string;
  exchange?: string | null;
  instrument_ref: InstrumentRef;
  sort_order: number;
  created_at: string;
}

export interface Watchlist {
  id: string;
  user_id: string;
  name: string;
  symbols: string[];
  items: WatchlistSymbol[];
  created_at: string;
  updated_at: string;
}

export interface WatchlistCreateInput {
  name: string;
  symbols?: string[];
}

export interface WatchlistUpdateInput {
  name?: string | null;
}

export interface WatchlistSymbolInput {
  symbol: string;
  exchange?: string | null;
  account_id?: string | null;
  broker_code?: string | null;
  instrument_ref?: InstrumentRef;
}

export interface WatchlistSymbolsBulkInput {
  symbols: string[];
  exchange?: string | null;
  items?: WatchlistSymbolInput[];
}

export interface WatchlistSymbolsReplaceInput {
  symbols: WatchlistSymbolInput[];
}

export interface WatchlistSymbolsBulkResponse {
  watchlist: Watchlist;
  added_symbols: string[];
  skipped_symbols: string[];
}
