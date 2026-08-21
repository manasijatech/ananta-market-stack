"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getBrokerAccounts } from "@/service/actions/broker";
import { getWatchlists } from "@/service/actions/watchlist";
import type { BrokerAccount } from "@/service/types/broker";
import type { Watchlist } from "@/service/types/watchlist";
import { isRecord } from "@/lib/adaptive-workspace/tool-envelope";
import type { WorkspaceComponent } from "@/service/types/adaptive-workspace";

export function stringParam(source: Record<string, unknown> | undefined, keys: string[]): string {
    if (!source) return "";
    for (const key of keys) {
        const value = source[key];
        if (typeof value === "string" && value.trim()) return value.trim();
    }
    return "";
}

export function stringListParam(source: Record<string, unknown> | undefined, keys: string[]): string[] {
    if (!source) return [];
    for (const key of keys) {
        const value = source[key];
        if (Array.isArray(value)) {
            return value
                .map((item) => (typeof item === "string" ? item : isRecord(item) ? String(item.symbol ?? "") : ""))
                .map((item) => item.trim().toUpperCase())
                .filter(Boolean);
        }
        if (typeof value === "string" && value.trim()) {
            return value
                .split(",")
                .map((item) => item.trim().toUpperCase())
                .filter(Boolean);
        }
    }
    return [];
}

export function useDeskAccounts() {
    const [accounts, setAccounts] = useState<BrokerAccount[]>([]);
    const [error, setError] = useState<string | null>(null);

    const reload = useCallback(async () => {
        try {
            const rows = await getBrokerAccounts();
            setAccounts(rows.filter((item) => item.is_active));
            setError(null);
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : "Could not load broker accounts.");
        }
    }, []);

    useEffect(() => {
        void reload();
    }, [reload]);

    const account =
        accounts.find((item) => item.session_status === "active" || item.session_status === "connected") ??
        accounts[0] ??
        null;

    return { account, accounts, error, reload };
}

export function useDeskWatchlists() {
    const [watchlists, setWatchlists] = useState<Watchlist[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    const reload = useCallback(async () => {
        setLoading(true);
        try {
            const rows = await getWatchlists();
            setWatchlists(rows);
            setError(null);
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : "Could not load watchlists.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void reload();
    }, [reload]);

    return { error, loading, reload, watchlists };
}

export function componentScope(component: WorkspaceComponent): "desk" | "watchlist" | "symbol" {
    const declared = stringParam(component.props, ["scope"]) || stringParam(component.data?.params, ["scope"]);
    if (declared === "symbol" || declared === "watchlist" || declared === "desk") return declared;
    const symbol = stringParam(component.props, ["symbol"]) || stringParam(component.data?.params, ["symbol"]);
    const symbols = stringListParam(component.props, ["symbols"]).concat(
        stringListParam(component.data?.params, ["symbols", "instruments"])
    );
    if (stringParam(component.props, ["watchlistId", "watchlist_id"])) return "watchlist";
    if (symbol || (symbols.length > 0 && symbols.length <= 3)) return "symbol";
    return "desk";
}

export function universeSymbols(spec?: { universe?: { symbols?: string[] } } | null): string[] {
    return Array.from(
        new Set((spec?.universe?.symbols ?? []).map((item) => String(item).trim().toUpperCase()).filter(Boolean))
    ).slice(0, 40);
}

export function symbolsFromComponent(
    component: WorkspaceComponent,
    watchlist: Watchlist | null,
    deskSymbols: string[] = []
): string[] {
    const explicit = explicitSymbols(component);
    const scope = componentScope(component);
    if (scope === "symbol" && explicit.length) return explicit;
    if (scope === "desk") return deskSymbols.length ? deskSymbols : explicit;
    if (explicit.length && scope !== "watchlist") return Array.from(new Set(explicit));
    if (scope === "watchlist") {
        return watchlist?.items.map((item) => item.symbol.trim().toUpperCase()).filter(Boolean) ?? watchlist?.symbols ?? [];
    }
    return deskSymbols.length ? deskSymbols : explicit;
}

export function explicitSymbols(component: WorkspaceComponent): string[] {
    const single = stringParam(component.props, ["symbol"]) || stringParam(component.data?.params, ["symbol"]);
    const listed = stringListParam(component.props, ["symbols"]).concat(
        stringListParam(component.data?.params, ["symbols", "instruments"])
    );
    return Array.from(new Set([...(single ? [single.toUpperCase()] : []), ...listed]));
}

export function uniqueWatchlistSymbols(watchlists: Watchlist[]): Array<{ label: string; value: string }> {
    const seen = new Map<string, string>();
    for (const list of watchlists) {
        for (const item of list.items ?? []) {
            const symbol = String(item.symbol ?? "").trim().toUpperCase();
            if (!symbol || seen.has(symbol)) continue;
            const exchange = item.exchange || item.instrument_ref?.exchange || "";
            seen.set(symbol, exchange ? `${symbol} · ${exchange}` : symbol);
        }
        for (const symbol of list.symbols ?? []) {
            const next = String(symbol ?? "").trim().toUpperCase();
            if (next && !seen.has(next)) seen.set(next, next);
        }
    }
    return [...seen.entries()].map(([value, label]) => ({ label, value }));
}

export function instrumentForSymbol(
    watchlists: Watchlist[],
    symbol: string,
    component?: WorkspaceComponent
): { exchange?: string; symbol: string } & Record<string, unknown> {
    const needle = symbol.trim().toUpperCase();
    const params = component?.data?.params ?? {};
    if (isRecord(params.instrument) && typeof params.instrument.symbol === "string") {
        return { ...params.instrument, symbol: String(params.instrument.symbol).toUpperCase() };
    }
    for (const list of watchlists) {
        const match = (list.items ?? []).find((item) => String(item.symbol ?? "").trim().toUpperCase() === needle);
        if (match) {
            return {
                ...(match.instrument_ref ?? {}),
                exchange: match.exchange ?? match.instrument_ref?.exchange ?? "NSE",
                symbol: needle
            };
        }
    }
    return { exchange: "NSE", symbol: needle };
}

export function resolveWatchlist(
    watchlists: Watchlist[],
    component: WorkspaceComponent,
    defaultWatchlistId?: string
): Watchlist | null {
    if (!watchlists.length) return null;
    const params = component.data?.params ?? {};
    const props = component.props ?? {};
    const id =
        stringParam(props, ["watchlistId", "watchlist_id"]) ||
        stringParam(params, ["watchlist_id", "watchlistId"]) ||
        (defaultWatchlistId || "");
    const name = stringParam(props, ["watchlistName"]) || stringParam(params, ["name", "watchlist", "watchlist_name"]);
    if (id) {
        return watchlists.find((item) => item.id === id) ?? watchlists[0] ?? null;
    }
    if (name) {
        const needle = name.toLowerCase();
        return (
            watchlists.find((item) => item.name.toLowerCase() === needle) ??
            watchlists.find((item) => item.name.toLowerCase().includes(needle)) ??
            watchlists[0] ??
            null
        );
    }
    return [...watchlists].sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at))[0] ?? null;
}

export function useRefreshNonce() {
    const [nonce, setNonce] = useState(0);
    return { nonce, refresh: () => setNonce((value) => value + 1) };
}

export function widgetProp(component: WorkspaceComponent, key: string): unknown {
    return component.props?.[key] ?? component.data?.params?.[key];
}
