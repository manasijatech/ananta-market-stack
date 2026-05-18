"use server";

import { revalidatePath } from "next/cache";
import { fetchFastApi } from "@/lib/fastapi";
import type {
  Watchlist,
  WatchlistCreateInput,
  WatchlistPresetCatalogEntry,
  WatchlistSymbolsBulkInput,
  WatchlistSymbolsBulkResponse,
  WatchlistSymbolsReplaceInput,
  WatchlistUpdateInput
} from "@/service/types/watchlist";

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function parseJson(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { detail: text };
  }
}

function extractMessage(payload: unknown, fallback: string): string {
  if (!isJsonObject(payload)) return fallback;
  if (typeof payload.detail === "string") return payload.detail;
  if (typeof payload.message === "string") return payload.message;
  return fallback;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetchFastApi(path, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...Object.fromEntries(new Headers(init.headers).entries())
    }
  });
  const payload = await parseJson(response);
  if (!response.ok) {
    throw new Error(extractMessage(payload, "Request failed."));
  }
  return payload as T;
}

export async function getWatchlists(): Promise<Watchlist[]> {
  return request<Watchlist[]>("/watchlists");
}

export async function searchWatchlistPresets(
  query = "",
  limit = 30,
  offset = 0
): Promise<WatchlistPresetCatalogEntry[]> {
  const params = new URLSearchParams();
  if (query.trim()) params.set("q", query.trim());
  params.set("limit", String(limit));
  params.set("offset", String(Math.max(0, offset)));
  return request<WatchlistPresetCatalogEntry[]>(`/watchlists/presets/catalog?${params.toString()}`);
}

export async function createWatchlist(payload: WatchlistCreateInput): Promise<Watchlist> {
  const result = await request<Watchlist>("/watchlists", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  revalidatePath("/watchlists");
  revalidatePath("/alerts/subscriptions");
  revalidatePath("/alerts/stream-manager");
  return result;
}

export async function addPresetWatchlist(presetId: string): Promise<Watchlist> {
  const result = await request<Watchlist>("/watchlists/presets/add", {
    method: "POST",
    body: JSON.stringify({ preset_id: presetId })
  });
  revalidatePath("/watchlists");
  revalidatePath("/alerts/subscriptions");
  revalidatePath("/alerts/stream-manager");
  return result;
}

export async function updateWatchlist(id: string, payload: WatchlistUpdateInput): Promise<Watchlist> {
  const result = await request<Watchlist>(`/watchlists/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
  revalidatePath("/watchlists");
  return result;
}

export async function deleteWatchlist(id: string): Promise<void> {
  await request<{ ok: boolean }>(`/watchlists/${id}`, { method: "DELETE" });
  revalidatePath("/watchlists");
  revalidatePath("/alerts/subscriptions");
  revalidatePath("/alerts/stream-manager");
}

export async function refreshWatchlist(id: string): Promise<Watchlist> {
  const result = await request<Watchlist>(`/watchlists/${id}/refresh`, { method: "POST" });
  revalidatePath("/watchlists");
  revalidatePath("/alerts/subscriptions");
  revalidatePath("/alerts/stream-manager");
  return result;
}

export async function addSymbolsToWatchlist(
  id: string,
  payload: WatchlistSymbolsBulkInput
): Promise<WatchlistSymbolsBulkResponse> {
  const result = await request<WatchlistSymbolsBulkResponse>(`/watchlists/${id}/symbols`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
  revalidatePath("/watchlists");
  revalidatePath("/alerts/subscriptions");
  revalidatePath("/alerts/stream-manager");
  return result;
}

export async function replaceWatchlistSymbols(
  id: string,
  payload: WatchlistSymbolsReplaceInput
): Promise<Watchlist> {
  const result = await request<Watchlist>(`/watchlists/${id}/symbols`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
  revalidatePath("/watchlists");
  revalidatePath("/alerts/subscriptions");
  revalidatePath("/alerts/stream-manager");
  return result;
}

export async function removeSymbolFromWatchlist(
  id: string,
  symbol: string,
  exchange?: string | null
): Promise<Watchlist> {
  const query = exchange ? `?exchange=${encodeURIComponent(exchange)}` : "";
  const result = await request<Watchlist>(
    `/watchlists/${id}/symbols/${encodeURIComponent(symbol)}${query}`,
    { method: "DELETE" }
  );
  revalidatePath("/watchlists");
  revalidatePath("/alerts/subscriptions");
  revalidatePath("/alerts/stream-manager");
  return result;
}
