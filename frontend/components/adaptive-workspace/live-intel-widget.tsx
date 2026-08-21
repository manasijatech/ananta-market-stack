"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LiveStatusBadge, WidgetState } from "@/components/adaptive-workspace/widget-kit";
import { WidgetScopeBar, scopeHint } from "@/components/adaptive-workspace/widget-scope-bar";
import { useAdaptiveWorkspace } from "@/components/adaptive-workspace/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SimpleSelect } from "@/components/ui/simple-select";
import { useOptionalAdaptiveDeskPrefs } from "@/components/adaptive-workspace/desk-prefs";
import { formatIstDateTime, parseApiDate } from "@/lib/datetime";
import { isRecord, stringFrom } from "@/lib/adaptive-workspace/tool-envelope";
import {
    resolveWatchlist,
    stringListParam,
    stringParam,
    symbolsFromComponent,
    uniqueCashSymbols,
    universeSymbols,
    useDeskWatchlists
} from "@/hooks/use-desk-data";
import { getCachedAlphaFeed, type AlphaFeedProduct } from "@/service/actions/alpha/feeds";
import type { WorkspaceComponent } from "@/service/types/adaptive-workspace";

const PRODUCTS: Array<{ label: string; value: AlphaFeedProduct }> = [
    { label: "News", value: "news" },
    { label: "Announcements", value: "announcements" },
    { label: "Earnings", value: "earnings" },
    { label: "Concalls", value: "concalls" },
    { label: "Alpha alerts", value: "alerts" }
];

const PRODUCT_VALUES = new Set<string>(PRODUCTS.map((item) => item.value));

type Props = {
    component: WorkspaceComponent;
    onPatch: (props: Record<string, unknown>) => void;
    refreshNonce: number;
};

type TaggedItem = Record<string, unknown> & { product: AlphaFeedProduct };

function asFeedProduct(value: string): AlphaFeedProduct | null {
    const normalized = value.trim().toLowerCase();
    return PRODUCT_VALUES.has(normalized) ? (normalized as AlphaFeedProduct) : null;
}

function uniqueProducts(values: string[]): AlphaFeedProduct[] {
    const seen = new Set<AlphaFeedProduct>();
    const products: AlphaFeedProduct[] = [];
    for (const value of values) {
        const product = asFeedProduct(value);
        if (!product || seen.has(product)) continue;
        seen.add(product);
        products.push(product);
    }
    return products;
}

function listedProducts(component: WorkspaceComponent): AlphaFeedProduct[] {
    return uniqueProducts([
        ...stringListParam(component.props, ["products"]),
        ...stringListParam(component.data?.params, ["products"])
    ]);
}

function resolveProducts(component: WorkspaceComponent, intelProduct?: string): AlphaFeedProduct[] {
    const listed = listedProducts(component);
    if (listed.length > 1) return listed;
    const single =
        asFeedProduct(stringParam(component.props, ["product"])) ||
        asFeedProduct(stringParam(component.data?.params, ["product"])) ||
        listed[0] ||
        asFeedProduct(intelProduct || "") ||
        "news";
    return [single];
}

function hiddenProductList(component: WorkspaceComponent, allowed: AlphaFeedProduct[]): AlphaFeedProduct[] {
    const allowedSet = new Set(allowed);
    return uniqueProducts(stringListParam(component.props, ["hiddenProducts"])).filter((product) =>
        allowedSet.has(product)
    );
}

function headlineFrom(item: Record<string, unknown>): string {
    const native = stringFrom(item, ["headline", "specific_title", "title"], "");
    if (native) return native;
    const company = stringFrom(item, ["company_name"], "");
    const quarter = stringFrom(item, ["quarter"], "");
    if (company && quarter) return `${company} ${quarter.replaceAll("_", " ")} earnings`;
    if (company) return `${company} earnings`;
    return stringFrom(item, ["summary", "reason"], "Untitled item");
}

function publishedRaw(item: Record<string, unknown>): string {
    return stringFrom(item, ["published_at", "publishedAt", "date", "timestamp", "datetime", "announcement_date", "created_at"], "");
}

function productLabel(product: AlphaFeedProduct): string {
    return PRODUCTS.find((item) => item.value === product)?.label ?? product;
}

function joinProductNames(products: AlphaFeedProduct[]): string {
    if (!products.length) return "intel";
    if (products.length === 1) return products[0];
    if (products.length === 2) return `${products[0]} or ${products[1]}`;
    return `${products.slice(0, -1).join(", ")}, or ${products[products.length - 1]}`;
}

function publishedMs(item: Record<string, unknown>): number {
    const raw = publishedRaw(item);
    if (!raw) return 0;
    const ms = parseApiDate(raw).getTime();
    return Number.isNaN(ms) ? 0 : ms;
}

function itemIdentity(item: TaggedItem, index: number): string {
    const native = stringFrom(
        item,
        ["id", "_id", "event_id", "news_id", "announcement_id", "concall_id", "alert_id"],
        ""
    );
    if (native) return `${item.product}:${native}`;
    return `${item.product}:${stringFrom(item, ["symbol"], "item")}:${headlineFrom(item)}:${index}`;
}

async function loadCombinedFeed(
    products: AlphaFeedProduct[],
    params: { force_refresh?: boolean; limit: number; page: number; symbols: string[] }
): Promise<{
    emptyProducts: AlphaFeedProduct[];
    fromCache: boolean;
    hasMore: boolean;
    items: TaggedItem[];
}> {
    const pages = await Promise.all(
        products.map(async (product) => ({ product, result: await getCachedAlphaFeed(product, params) }))
    );
    const items: TaggedItem[] = [];
    const emptyProducts: AlphaFeedProduct[] = [];
    let hasMore = false;
    let cachedCount = 0;
    for (const { product, result } of pages) {
        const rows = Array.isArray(result.data) ? result.data.filter(isRecord) : [];
        if (!rows.length) emptyProducts.push(product);
        for (const row of rows) {
            items.push({ ...row, product });
        }
        if (result.has_next) hasMore = true;
        if (result.from_cache) cachedCount += 1;
    }
    items.sort((left, right) => publishedMs(right) - publishedMs(left));
    return {
        emptyProducts,
        fromCache: pages.length > 0 && cachedCount === pages.length,
        hasMore,
        items
    };
}

export function LiveIntelWidget({ component, onPatch, refreshNonce }: Props) {
    const { spec } = useAdaptiveWorkspace();
    const deskSymbols = universeSymbols(spec);
    const { watchlists, loading: listsLoading } = useDeskWatchlists();
    const prefs = useOptionalAdaptiveDeskPrefs();
    const watchlist = resolveWatchlist(watchlists, component, prefs?.defaultWatchlistId);
    const symbols = symbolsFromComponent(component, watchlist, deskSymbols);
    const products = resolveProducts(component, prefs?.intelProduct);
    const hiddenProducts = hiddenProductList(component, products);
    const combined = products.length > 1;
    const product = products[0] ?? "news";
    const [items, setItems] = useState<TaggedItem[]>([]);
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(false);
    const [fromCache, setFromCache] = useState(false);
    const [emptyProducts, setEmptyProducts] = useState<AlphaFeedProduct[]>([]);
    const [freshPull, setFreshPull] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const symbolKey = symbols.join(",");
    const productKey = products.join(",");
    const hiddenKey = hiddenProducts.join(",");
    const visibleProducts = products.filter((item) => !hiddenProducts.includes(item));
    const visibleKey = visibleProducts.join(",");
    const didFreshLoad = useRef(false);
    const lastFetchKey = useRef("");
    const fetchKey = `${visibleKey || productKey}|${symbolKey}`;

    useEffect(() => {
        setPage(1);
        setItems([]);
        setEmptyProducts([]);
    }, [productKey, symbolKey, visibleKey, refreshNonce]);

    useEffect(() => {
        if (!symbols.length) {
            setLoading(false);
            setItems([]);
            setEmptyProducts(products);
            setFreshPull(false);
            return;
        }
        if (lastFetchKey.current !== fetchKey) {
            didFreshLoad.current = false;
            lastFetchKey.current = fetchKey;
        }
        let cancelled = false;
        const firstPage = page === 1;
        const forceRefresh = firstPage && (refreshNonce > 0 || !didFreshLoad.current);
        if (firstPage) setLoading(true);
        else setLoadingMore(true);
        void loadCombinedFeed(visibleProducts.length ? visibleProducts : products, {
            limit: 20,
            page,
            symbols: uniqueCashSymbols(symbols),
            force_refresh: forceRefresh
        })
            .then((result) => {
                if (cancelled) return;
                if (firstPage) didFreshLoad.current = true;
                setItems((current) => {
                    if (page === 1) return result.items;
                    const seen = new Set(current.map((item, index) => itemIdentity(item, index)));
                    const appended = result.items.filter((item, index) => !seen.has(itemIdentity(item, index)));
                    return [...current, ...appended].sort((left, right) => publishedMs(right) - publishedMs(left));
                });
                setHasMore(result.hasMore);
                setFromCache(result.fromCache);
                if (firstPage) {
                    setEmptyProducts(result.emptyProducts);
                    setFreshPull(forceRefresh);
                }
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
    }, [fetchKey, page, productKey, refreshNonce, symbolKey, visibleKey]);

    useEffect(() => {
        if (!symbols.length) return;
        const handle = window.setInterval(() => {
            void loadCombinedFeed(visibleProducts.length ? visibleProducts : products, {
                limit: 20,
                page: 1,
                symbols: uniqueCashSymbols(symbols)
            }).then((result) => {
                setItems((current) => (page === 1 ? result.items : current));
                setFromCache(result.fromCache);
                if (page === 1) setEmptyProducts(result.emptyProducts);
            }).catch(() => undefined);
        }, 30_000);
        return () => window.clearInterval(handle);
    }, [page, productKey, symbolKey, visibleKey]);

    const hiddenSet = useMemo(() => new Set(hiddenProducts), [hiddenKey]);
    const rows = useMemo(
        () =>
            items
                .filter((item) => !hiddenSet.has(item.product))
                .map((item, index) => ({
                    headline: headlineFrom(item),
                    id: itemIdentity(item, index),
                    product: item.product,
                    published: publishedRaw(item),
                    symbol: stringFrom(item, ["symbol"], "")
                })),
        [hiddenSet, items]
    );

    const emptyMessage = (() => {
        if (!visibleProducts.length) {
            return "No product is selected. Click News, Earnings, or another chip to show items.";
        }
        if (items.length && !rows.length) {
            const names = joinProductNames(visibleProducts);
            return freshPull
                ? `No ${names} items after a fresh pull for these symbols.`
                : `No ${names} items for these symbols yet.`;
        }
        const vacant = emptyProducts.length ? emptyProducts : visibleProducts;
        const names = joinProductNames(vacant);
        if (freshPull) {
            return `No ${names} items after a fresh pull for these symbols.`;
        }
        return `No ${names} items for these symbols yet.`;
    })();

    const toggleHidden = (nextProduct: AlphaFeedProduct) => {
        const isolating =
            visibleProducts.length === 1 && visibleProducts[0] === nextProduct && hiddenProducts.length > 0;
        if (isolating) {
            onPatch({ hiddenProducts: [] });
            return;
        }
        onPatch({ hiddenProducts: products.filter((item) => item !== nextProduct) });
    };

    return (
        <WidgetState error={error} loading={loading || listsLoading} loadingLabel="Loading market intelligence">
            <div className="flex items-center gap-2 border-b border-border/70 px-2 py-2">
                {combined ? null : (
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
                )}
                <WidgetScopeBar
                    allowDesk
                    component={component}
                    extraSymbols={deskSymbols}
                    onPatch={onPatch}
                    selectedWatchlist={watchlist}
                    symbol={symbols[0] || ""}
                    watchlists={watchlists}
                />
                <LiveStatusBadge
                    label={fromCache ? "Cached" : freshPull ? "Fresh" : "Feed"}
                    tone={fromCache ? "cached" : "live"}
                />
            </div>
            {combined ? (
                <div className="flex flex-wrap gap-1 border-b border-border/70 px-2 py-1.5">
                    {products.map((item) => {
                        const hidden = hiddenSet.has(item);
                        return (
                            <button
                                aria-pressed={!hidden}
                                className="rounded-md"
                                key={item}
                                onClick={() => toggleHidden(item)}
                                type="button"
                            >
                                <Badge size="sm" variant={hidden ? "outline" : "secondary"}>
                                    {productLabel(item)}
                                </Badge>
                            </button>
                        );
                    })}
                </div>
            ) : null}
            <p className="px-3 pt-1 text-[11px] text-muted-foreground">{scopeHint(component, watchlist?.name, deskSymbols.length)}</p>
            <div className="min-h-0 flex-1 overflow-auto">
            {rows.length ? (
                <ul className="grid gap-2 p-2">
                    {rows.map((row) => (
                        <li className="rounded-md border border-border/70 px-2.5 py-2" key={row.id}>
                            <div className="flex flex-wrap items-center gap-1.5">
                                {combined ? (
                                    <Badge size="sm" variant="secondary">
                                        {productLabel(row.product)}
                                    </Badge>
                                ) : null}
                                {row.symbol ? (
                                    <Badge size="sm" variant="outline">
                                        {row.symbol}
                                    </Badge>
                                ) : null}
                                {row.published ? (
                                    <span className="text-[11px] text-muted-foreground">
                                        {formatIstDateTime(row.published, row.published)}
                                    </span>
                                ) : null}
                            </div>
                            <p className="mt-1 text-sm leading-5">{row.headline}</p>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="p-3 text-sm text-muted-foreground">{emptyMessage}</p>
            )}
            {hasMore ? (
                <div className="p-2">
                    <Button disabled={loadingMore} onClick={() => setPage((value) => value + 1)} size="xs" type="button" variant="outline">
                        {loadingMore ? "Loading…" : "Load more"}
                    </Button>
                </div>
            ) : null}
            </div>
        </WidgetState>
    );
}
