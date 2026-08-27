"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useOptionalAdaptiveDeskPrefs } from "@/components/adaptive-workspace/desk-prefs";
import { getBrokerAccountsResult, getBrokerDataDefaultConfigResult } from "@/service/actions/broker";
import { getWatchlistsResult } from "@/service/actions/watchlist";
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
            return uniqueCashSymbols(
                value.map((item) => (typeof item === "string" ? item : isRecord(item) ? String(item.symbol ?? "") : ""))
            );
        }
        if (typeof value === "string" && value.trim()) {
            return uniqueCashSymbols(value.split(","));
        }
    }
    return [];
}

const EXCHANGE_TOKENS = new Set(["NSE", "BSE", "NFO", "BFO", "MCX", "NCDEX", "CDS", "BSEFO", "NSECM", "BSECM"]);

export function cashEquitySymbol(value: string): string {
    const item = value.trim().toUpperCase().replace(".NS", "").replace(".BO", "");
    if (!item || EXCHANGE_TOKENS.has(item)) return "";
    const parts = item
        .replaceAll("/", ":")
        .split(":")
        .map((part) => part.trim())
        .filter((part) => part && !EXCHANGE_TOKENS.has(part));
    return parts[0] ?? "";
}

export function uniqueCashSymbols(values: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const value of values) {
        const symbol = cashEquitySymbol(value);
        if (!symbol || seen.has(symbol)) continue;
        seen.add(symbol);
        out.push(symbol);
    }
    return out;
}

function isReadySession(status?: string | null) {
    const value = (status ?? "").toLowerCase();
    return value === "active" || value === "connected" || value === "automation_ready";
}

export function useDeskAccounts() {
    const prefs = useOptionalAdaptiveDeskPrefs();
    const [accounts, setAccounts] = useState<BrokerAccount[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [settingsDefaultId, setSettingsDefaultId] = useState("");

    const reload = useCallback(async () => {
        const result = await getBrokerAccountsResult();
        if (result.ok) {
            setAccounts((result.data ?? []).filter((item) => item.is_active));
            setError(null);
        } else {
            setAccounts([]);
            setError(result.error || "Could not load broker accounts.");
        }
        setLoading(false);
    }, []);

    useEffect(() => {
        void reload();
    }, [reload]);

    useEffect(() => {
        void getBrokerDataDefaultConfigResult().then((result) => {
            const config = result.data;
            if (!config) return;
            setSettingsDefaultId(config.effective_default_account_id || config.preferred_default_account_id || "");
        });
    }, []);

    const defaultAccountId = prefs?.defaultAccountId || settingsDefaultId;
    const account = useMemo(() => {
        const preferred = defaultAccountId ? accounts.find((item) => item.id === defaultAccountId) : undefined;
        if (preferred) return preferred;
        return accounts.find((item) => isReadySession(item.session_status)) ?? accounts[0] ?? null;
    }, [accounts, defaultAccountId]);

    return { account, accounts, error, loading, reload };
}

export function useDeskWatchlists() {
    const [watchlists, setWatchlists] = useState<Watchlist[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    const reload = useCallback(async () => {
        setLoading(true);
        const result = await getWatchlistsResult();
        if (result.ok) {
            setWatchlists(result.data);
            setError(null);
        } else {
            setWatchlists([]);
            setError(result.error || "Could not load watchlists.");
        }
        setLoading(false);
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
    return uniqueCashSymbols(spec?.universe?.symbols ?? []).slice(0, 40);
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
