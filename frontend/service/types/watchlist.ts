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
  kind: string;
  is_editable: boolean;
  preset_id?: string | null;
  preset_slug?: string | null;
  preset_sync_status?: string | null;
  preset_last_synced_at?: string | null;
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

export interface WatchlistPresetCatalogEntry {
  id: string;
  slug: string;
  name: string;
  trading_index_name: string;
  constituent_csv_url?: string | null;
  constituent_count: number;
  is_popular: boolean;
  auto_sync_enabled: boolean;
  sync_status: string;
  sync_error?: string | null;
  last_catalog_sync_at?: string | null;
  last_constituents_sync_at?: string | null;
  is_added: boolean;
  user_watchlist_id?: string | null;
}
