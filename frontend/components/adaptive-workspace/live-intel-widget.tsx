"use client";

import { useEffect, useMemo, useState } from "react";
import { LiveStatusBadge, WidgetState } from "@/components/adaptive-workspace/widget-kit";
import { WidgetScopeBar, scopeHint } from "@/components/adaptive-workspace/widget-scope-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SimpleSelect } from "@/components/ui/simple-select";
import { resolveWatchlist, stringParam, symbolsFromComponent, useDeskWatchlists } from "@/hooks/use-desk-data";
import { useOptionalAdaptiveDeskPrefs } from "@/components/adaptive-workspace/desk-prefs";
import { isRecord, stringFrom } from "@/lib/adaptive-workspace/tool-envelope";
import { getCachedAlphaFeed, type AlphaFeedProduct } from "@/service/actions/alpha/feeds";
import type { WorkspaceComponent } from "@/service/types/adaptive-workspace";

const PRODUCTS: Array<{ label: string; value: AlphaFeedProduct }> = [
    { label: "News", value: "news" },
    { label: "Announcements", value: "announcements" },
    { label: "Earnings", value: "earnings" },
    { label: "Concalls", value: "concalls" },
    { label: "Alpha alerts", value: "alerts" }
];

type Props = {
    component: WorkspaceComponent;
    onPatch: (props: Record<string, unknown>) => void;
    refreshNonce: number;
};

function headlineFrom(item: Record<string, unknown>): string {
    return stringFrom(item, ["headline", "specific_title", "title", "summary", "reason"], "Untitled item");
}

export function LiveIntelWidget({ component, onPatch, refreshNonce }: Props) {
    const { watchlists, loading: listsLoading } = useDeskWatchlists();
    const prefs = useOptionalAdaptiveDeskPrefs();
    const watchlist = resolveWatchlist(watchlists, component, prefs?.defaultWatchlistId);
    const symbols = symbolsFromComponent(component, watchlist);
    const product = (stringParam(component.props, ["product"]) ||
        stringParam(component.data?.params, ["product"]) ||
        prefs?.intelProduct ||
        "news") as AlphaFeedProduct;
    const [items, setItems] = useState<Record<string, unknown>[]>([]);
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(false);
    const [fromCache, setFromCache] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const symbolKey = symbols.join(",");

    useEffect(() => {
        setPage(1);
        setItems([]);
    }, [product, symbolKey, refreshNonce]);

    useEffect(() => {
        if (!symbols.length) {
            setLoading(false);
            setItems([]);
            return;
        }
        let cancelled = false;
        const firstPage = page === 1;
        if (firstPage) setLoading(true);
        else setLoadingMore(true);
        void getCachedAlphaFeed(product, { limit: 20, page, symbols, force_refresh: firstPage && refreshNonce > 0 })
            .then((result) => {
                if (cancelled) return;
                const next = Array.isArray(result.data) ? result.data.filter(isRecord) : [];
                setItems((current) => (page === 1 ? next : [...current, ...next]));
                setHasMore(Boolean(result.has_next));
                setFromCache(Boolean(result.from_cache));
                setError(null);
            })
            .catch((caught) => {
                if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not load market intelligence.");
            })
            .finally(() => {
                if (cancelled) return;
                setLoading(false);
                setLoadingMore(false);
            });
        return () => {
            cancelled = true;
        };
    }, [page, product, refreshNonce, symbolKey]);

    useEffect(() => {
        if (!symbols.length) return;
        const handle = window.setInterval(() => {
            void getCachedAlphaFeed(product, { limit: 20, page: 1, symbols }).then((result) => {
                const next = Array.isArray(result.data) ? result.data.filter(isRecord) : [];
                setItems((current) => (page === 1 ? next : current));
                setFromCache(Boolean(result.from_cache));
            }).catch(() => undefined);
        }, 30_000);
        return () => window.clearInterval(handle);
    }, [page, product, symbolKey]);

    const rows = useMemo(
        () =>
            items.map((item, index) => ({
                headline: headlineFrom(item),
                id: `${stringFrom(item, ["symbol"], "item")}-${index}`,
                published: stringFrom(item, ["published_at", "publishedAt"], ""),
                symbol: stringFrom(item, ["symbol"], "")
            })),
        [items]
    );

    return (
        <WidgetState error={error} loading={loading || listsLoading} loadingLabel="Loading market intelligence">
            <div className="flex items-center gap-2 border-b border-border/70 px-2 py-2">
                <SimpleSelect
                    aria-label="Intelligence product"
                    className="h-7 w-[9.5rem]"
                    onValueChange={(next) => {
                        onPatch({ product: next });
                        setPage(1);
                    }}
                    options={PRODUCTS.map((item) => ({ label: item.label, value: item.value }))}
                    size="sm"
                    value={product}
                />
                <WidgetScopeBar
                    component={component}
                    onPatch={onPatch}
                    selectedWatchlist={watchlist}
                    symbol={symbols[0] || ""}
                    watchlists={watchlists}
                />
                <LiveStatusBadge label={fromCache ? "Cached" : "Feed"} tone={fromCache ? "cached" : "live"} />
            </div>
            <p className="px-3 pt-2 text-[11px] text-muted-foreground">{scopeHint(component, watchlist?.name)}</p>
            {rows.length ? (
                <ul className="grid gap-2 p-2">
                    {rows.map((row) => (
                        <li className="rounded-md border border-border/70 px-2.5 py-2" key={row.id}>
                            <div className="flex flex-wrap items-center gap-1.5">
                                {row.symbol ? (
                                    <Badge size="sm" variant="outline">
                                        {row.symbol}
                                    </Badge>
                                ) : null}
                                {row.published ? <span className="text-[11px] text-muted-foreground">{row.published}</span> : null}
                            </div>
                            <p className="mt-1 text-sm leading-5">{row.headline}</p>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="p-3 text-sm text-muted-foreground">No {product} items for these symbols yet.</p>
            )}
            {hasMore ? (
                <div className="p-2">
                    <Button disabled={loadingMore} onClick={() => setPage((value) => value + 1)} size="xs" type="button" variant="outline">
                        {loadingMore ? "Loading…" : "Load more"}
                    </Button>
                </div>
            ) : null}
        </WidgetState>
    );
}
