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
import { SimpleSelect } from "@/components/ui/simple-select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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

const SOURCE_OPTIONS: readonly { value: HeatmapScope; label: string }[] = [
    { value: "tracked", label: "Tracked" },
    { value: "watchlist", label: "Watchlist" },
    { value: "portfolio_holdings", label: "Holdings" }
];

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

    function applyScope(nextScope: HeatmapScope) {
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
    }

    return (
        <section className="flex min-w-0 flex-1 flex-wrap items-end gap-2">
            <div className="grid min-w-[15rem] flex-[0_1_auto] gap-1">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Heatmap source
                </span>
                <ToggleGroup
                    aria-label="Select heatmap source"
                    className="flex-wrap"
                    onValueChange={(next) => {
                        if (next.length === 1 && isHeatmapScope(next[0])) {
                            applyScope(next[0]);
                        }
                    }}
                    size="sm"
                    value={[currentScope]}
                    variant="outline"
                >
                    {SOURCE_OPTIONS.map((option) => (
                        <ToggleGroupItem
                            aria-label={`Show ${option.label.toLowerCase()} heatmap`}
                            className="min-w-20 px-3 text-xs font-semibold"
                            key={option.value}
                            value={option.value}
                        >
                            {option.label}
                        </ToggleGroupItem>
                    ))}
                </ToggleGroup>
            </div>

            {currentScope === "watchlist" ? (
                <div className="grid min-w-[12rem] flex-[1_1_18rem] gap-1">
                    <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        Watchlist
                    </span>
                    <SimpleSelect
                        aria-label="Select watchlist"
                        className="h-8 border-border bg-background px-2 text-xs font-semibold"
                        disabled={!watchlists.length}
                        onValueChange={(watchlistId) => {
                            replaceSearch((params) => {
                                params.set("watchlist_id", watchlistId);
                                writeStoredFilters({
                                    accountId: currentAccountId || undefined,
                                    scope: currentScope,
                                    watchlistId: watchlistId || undefined
                                });
                            });
                        }}
                        options={
                            watchlists.length
                                ? watchlists.map((watchlist) => ({
                                      value: watchlist.id,
                                      label: `${watchlist.name} (${watchlist.items.length || watchlist.symbols.length})`
                                  }))
                                : [{ value: "", label: "No watchlists available", disabled: true }]
                        }
                        placeholder="Select watchlist"
                        size="sm"
                        value={currentWatchlistId}
                    />
                </div>
            ) : null}

            {currentScope === "portfolio_holdings" ? (
                <div className="grid min-w-[12rem] flex-[1_1_18rem] gap-1">
                    <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        Broker account
                    </span>
                    <SimpleSelect
                        aria-label="Select broker account"
                        className="h-8 border-border bg-background px-2 text-xs font-semibold"
                        disabled={!accounts.length}
                        onValueChange={(accountId) => {
                            replaceSearch((params) => {
                                params.set("account_id", accountId);
                                writeStoredFilters({
                                    accountId: accountId || undefined,
                                    scope: currentScope,
                                    watchlistId: currentWatchlistId || undefined
                                });
                            });
                        }}
                        options={
                            accounts.length
                                ? accounts.map((account) => ({
                                      value: account.id,
                                      label: labelForAccount(account)
                                  }))
                                : [{ value: "", label: "No broker accounts available", disabled: true }]
                        }
                        placeholder="Select account"
                        size="sm"
                        value={currentAccountId}
                    />
                </div>
            ) : null}

        </section>
    );
}
