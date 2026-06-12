"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
    HEATMAP_FILTER_CHANGE_EVENT,
    HEATMAP_FILTER_COOKIE_KEY,
    HEATMAP_FILTER_STORAGE_KEY,
    isHeatmapScope,
    parseStoredHeatmapFilters,
    type StoredHeatmapFilters
} from "@/components/heatmap/heatmap-filter-state";
import { Select } from "@/components/ui/select";
import type { BrokerAccount } from "@/service/types/broker";
import type { HeatmapScope } from "@/service/types/heatmap";
import type { Watchlist } from "@/service/types/watchlist";

type Props = {
    accounts: BrokerAccount[];
    currentAccountId: string;
    currentScope: HeatmapScope;
    currentWatchlistId: string;
    watchlists: Watchlist[];
};

function labelForAccount(account: BrokerAccount) {
    return `${account.label} · ${account.broker_code}`;
}

function readStoredFilters(): StoredHeatmapFilters {
    try {
        return parseStoredHeatmapFilters(window.localStorage.getItem(HEATMAP_FILTER_STORAGE_KEY) ?? undefined);
    } catch {
        return {};
    }
}

function writeStoredFilters(filters: StoredHeatmapFilters) {
    const serialized = JSON.stringify(filters);
    window.localStorage.setItem(HEATMAP_FILTER_STORAGE_KEY, serialized);
    document.cookie = `${HEATMAP_FILTER_COOKIE_KEY}=${encodeURIComponent(serialized)}; path=/; max-age=31536000; samesite=lax`;
    window.dispatchEvent(new Event(HEATMAP_FILTER_CHANGE_EVENT));
}

export function HeatmapFilters({
    accounts,
    currentAccountId,
    currentScope,
    currentWatchlistId,
    watchlists
}: Props) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const serializedSearchParams = searchParams.toString();
    const accountIds = accounts.map((account) => account.id).join("|");
    const watchlistIds = watchlists.map((watchlist) => watchlist.id).join("|");

    useEffect(() => {
        const params = new URLSearchParams(serializedSearchParams);
        const stored = readStoredFilters();
        const storedScope = isHeatmapScope(stored.scope) ? stored.scope : null;
        const hasScope = params.has("scope");
        const nextScope = hasScope ? currentScope : storedScope;

        if (!nextScope || hasScope) {
            writeStoredFilters({
                accountId: currentAccountId || undefined,
                scope: currentScope,
                watchlistId: currentWatchlistId || undefined
            });
            return;
        }

        params.set("scope", nextScope);
        if (nextScope === "watchlist") {
            const watchlistId = watchlists.some((watchlist) => watchlist.id === stored.watchlistId)
                ? stored.watchlistId
                : watchlists[0]?.id;
            if (watchlistId) params.set("watchlist_id", watchlistId);
            params.delete("account_id");
        } else if (nextScope === "portfolio_holdings") {
            const accountId = accounts.some((account) => account.id === stored.accountId) ? stored.accountId : accounts[0]?.id;
            if (accountId) params.set("account_id", accountId);
            params.delete("watchlist_id");
        } else {
            params.delete("account_id");
            params.delete("watchlist_id");
        }

        const next = params.toString();
        router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
    }, [
        accountIds,
        currentAccountId,
        currentScope,
        currentWatchlistId,
        pathname,
        router,
        serializedSearchParams,
        watchlistIds
    ]);

    function replaceSearch(mutator: (params: URLSearchParams) => void) {
        const params = new URLSearchParams(searchParams.toString());
        mutator(params);
        const next = params.toString();
        router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
    }

    return (
        <section className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <div className="grid min-w-[9.5rem] flex-[0_1_13rem] gap-1">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Heatmap source
                </span>
                <Select
                    aria-label="Select heatmap source"
                    className="h-8 border-border bg-background px-2 text-xs font-semibold"
                    onChange={(event) => {
                        const nextScope = event.target.value as HeatmapScope;
                        replaceSearch((params) => {
                            params.set("scope", nextScope);
                            if (nextScope === "watchlist") {
                                const stored = readStoredFilters();
                                const watchlistId = watchlists.some((watchlist) => watchlist.id === stored.watchlistId)
                                    ? stored.watchlistId
                                    : watchlists[0]?.id;
                                if (watchlistId) {
                                    params.set("watchlist_id", watchlistId);
                                } else {
                                    params.delete("watchlist_id");
                                }
                                params.delete("account_id");
                            } else if (nextScope === "portfolio_holdings") {
                                const stored = readStoredFilters();
                                const accountId = accounts.some((account) => account.id === stored.accountId) ? stored.accountId : accounts[0]?.id;
                                if (accountId) {
                                    params.set("account_id", accountId);
                                } else {
                                    params.delete("account_id");
                                }
                                params.delete("watchlist_id");
                            } else {
                                params.delete("watchlist_id");
                                params.delete("account_id");
                            }
                            writeStoredFilters({
                                accountId: params.get("account_id") || currentAccountId || undefined,
                                scope: nextScope,
                                watchlistId: params.get("watchlist_id") || currentWatchlistId || undefined
                            });
                        });
                    }}
                    value={currentScope}
                >
                    <option value="tracked">Tracked symbols</option>
                    <option value="watchlist">Watchlist</option>
                    <option value="portfolio_holdings">Portfolio holdings</option>
                </Select>
            </div>

            {currentScope === "watchlist" ? (
                <div className="grid min-w-[12rem] flex-[1_1_18rem] gap-1">
                    <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        Watchlist
                    </span>
                    <Select
                        aria-label="Select watchlist"
                        className="h-8 border-border bg-background px-2 text-xs font-semibold"
                        disabled={!watchlists.length}
                        onChange={(event) => {
                            replaceSearch((params) => {
                                params.set("watchlist_id", event.target.value);
                                writeStoredFilters({
                                    accountId: currentAccountId || undefined,
                                    scope: currentScope,
                                    watchlistId: event.target.value || undefined
                                });
                            });
                        }}
                        value={currentWatchlistId}
                    >
                        {watchlists.length ? (
                            watchlists.map((watchlist) => (
                                <option key={watchlist.id} value={watchlist.id}>
                                    {watchlist.name} ({watchlist.items.length || watchlist.symbols.length})
                                </option>
                            ))
                        ) : (
                            <option value="">No watchlists available</option>
                        )}
                    </Select>
                </div>
            ) : null}

            {currentScope === "portfolio_holdings" ? (
                <div className="grid min-w-[12rem] flex-[1_1_18rem] gap-1">
                    <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        Broker account
                    </span>
                    <Select
                        aria-label="Select broker account"
                        className="h-8 border-border bg-background px-2 text-xs font-semibold"
                        disabled={!accounts.length}
                        onChange={(event) => {
                            replaceSearch((params) => {
                                params.set("account_id", event.target.value);
                                writeStoredFilters({
                                    accountId: event.target.value || undefined,
                                    scope: currentScope,
                                    watchlistId: currentWatchlistId || undefined
                                });
                            });
                        }}
                        value={currentAccountId}
                    >
                        {accounts.length ? (
                            accounts.map((account) => (
                                <option key={account.id} value={account.id}>
                                    {labelForAccount(account)}
                                </option>
                            ))
                        ) : (
                            <option value="">No broker accounts available</option>
                        )}
                    </Select>
                </div>
            ) : null}

        </section>
    );
}
