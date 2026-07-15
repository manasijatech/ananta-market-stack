import Link from "next/link";
import { cookies } from "next/headers";
import { Activity, ArrowRight, Grid2X2, Minus, RadioTower, TrendingDown, TrendingUp, type LucideIcon } from "lucide-react";
import {
    HEATMAP_FILTER_COOKIE_KEY,
    isHeatmapScope,
    parseStoredHeatmapFilters
} from "@/components/heatmap/heatmap-filter-state";
import { HeatmapFilters } from "@/components/heatmap/heatmap-filters";
import { HeatmapMeasuredGrid } from "@/components/heatmap/heatmap-measured-grid";
import { brokerNames } from "@/components/brokers/ui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardDescription, CardHeader, CardPanel, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { formatUserFacingError } from "@/lib/api-errors";
import { typography } from "@/lib/typography";
import { cn } from "@/lib/utils";
import { getBrokerAccounts } from "@/service/actions/broker";
import { getLiveHeatmap } from "@/service/actions/heatmap";
import { getWatchlists } from "@/service/actions/watchlist";
import type { BrokerAccount, BrokerCode } from "@/service/types/broker";
import type { HeatmapResponse, HeatmapScope, HeatmapSymbol } from "@/service/types/heatmap";
import type { Watchlist } from "@/service/types/watchlist";

const DEFAULT_DAYS = 30;
const DEFAULT_LIMIT = 100;

type SearchParamsInput = Promise<Record<string, string | string[] | undefined>>;

function readFirst(value: string | string[] | undefined): string {
    return Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");
}

function isScope(value: string): value is HeatmapScope {
    return isHeatmapScope(value);
}

function formatNumber(value?: number | null) {
    if (value === null || value === undefined || Number.isNaN(value)) return "-";
    return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(value);
}

function formatCompact(value?: number | string | null) {
    if (value === null || value === undefined || value === "") return "-";
    if (typeof value === "string" && Number.isNaN(Number(value))) return value;
    const numeric = Number(value);
    if (Number.isNaN(numeric)) return String(value);
    return new Intl.NumberFormat("en-IN", {
        notation: "compact",
        maximumFractionDigits: 2
    }).format(numeric);
}

function formatPercent(value?: number | null) {
    if (value === null || value === undefined || Number.isNaN(value)) return "-";
    return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function heatTone(value?: number | null) {
    const magnitude = Math.abs(value ?? 0);
    if ((value ?? 0) > 0) {
        if (magnitude >= 8) return { backgroundColor: "hsl(148 78% 24%)", borderColor: "rgba(187, 247, 208, 0.24)" };
        if (magnitude >= 5) return { backgroundColor: "hsl(149 72% 30%)", borderColor: "rgba(187, 247, 208, 0.24)" };
        if (magnitude >= 3) return { backgroundColor: "hsl(150 64% 37%)", borderColor: "rgba(187, 247, 208, 0.24)" };
        if (magnitude >= 1) return { backgroundColor: "hsl(151 50% 45%)", borderColor: "rgba(187, 247, 208, 0.24)" };
        return { backgroundColor: "hsl(151 36% 55%)", borderColor: "rgba(187, 247, 208, 0.22)" };
    }
    if ((value ?? 0) < 0) {
        if (magnitude >= 8) return { backgroundColor: "hsl(0 74% 30%)", borderColor: "rgba(254, 202, 202, 0.24)" };
        if (magnitude >= 5) return { backgroundColor: "hsl(0 70% 37%)", borderColor: "rgba(254, 202, 202, 0.24)" };
        if (magnitude >= 3) return { backgroundColor: "hsl(0 66% 45%)", borderColor: "rgba(254, 202, 202, 0.24)" };
        if (magnitude >= 1) return { backgroundColor: "hsl(0 58% 54%)", borderColor: "rgba(254, 202, 202, 0.24)" };
        return { backgroundColor: "hsl(0 42% 62%)", borderColor: "rgba(254, 202, 202, 0.22)" };
    }
    return {
        backgroundColor: "hsl(220 8% 42% / 0.72)",
        borderColor: "rgba(226, 232, 240, 0.22)"
    };
}

function heatmapTileClass(index: number, value?: number | null, dense = false) {
    const magnitude = Math.abs(value ?? 0);
    if (dense) {
        if (index === 0) return "sm:col-span-2 sm:row-span-2";
        if (index === 1 || index === 2) return "lg:col-span-2";
        return "";
    }
    if (index === 0 || magnitude >= 7) return "sm:col-span-2 sm:row-span-2";
    if (index === 1 || index === 2 || magnitude >= 4) return "lg:col-span-2";
    return "";
}

function symbolInitials(symbol: string) {
    return symbol.trim().toUpperCase().slice(0, 2) || "--";
}

function trendLabel(value?: number | null) {
    if ((value ?? 0) > 0) return "Advancing";
    if ((value ?? 0) < 0) return "Declining";
    return "Flat";
}

function breadthPercent(count: number, total: number) {
    if (!total) return "0%";
    return `${Math.round((count / total) * 100)}%`;
}

function symbolCountLabel(watchlist: Watchlist) {
    return watchlist.items.length || watchlist.symbols.length;
}

function sourceEmptyMessage(scope: HeatmapScope) {
    if (scope === "watchlist") return "Create a watchlist first to view a watchlist heatmap.";
    if (scope === "portfolio_holdings") return "Connect a broker account first to view holdings as a heatmap.";
    return "No tracked symbols are available for the current broker selection.";
}

function isBrokerCode(value?: string | null): value is BrokerCode {
    return Boolean(value && value in brokerNames);
}

function brokerDisplayName(value?: string | null) {
    if (isBrokerCode(value)) return brokerNames[value];
    return value ? value.toUpperCase() : "your current broker";
}

function noQuotableSymbolsTitle(scope: HeatmapScope, scopeLabel: string) {
    if (scope === "watchlist") return `Live heatmap is not available for ${scopeLabel} on this broker.`;
    if (scope === "portfolio_holdings") return "Live heatmap is not available for these holdings on this broker.";
    return "Live heatmap is not available for the current broker.";
}

function HeatmapCard({ dense = false, index, item }: { dense?: boolean; index: number; item: HeatmapSymbol }) {
    const tone = heatTone(item.day_change_perc);
    const percent = formatPercent(item.day_change_perc);
    const detailRows = [
        ["LTP", formatNumber(item.ltp)],
        ["Change", formatNumber(item.day_change)],
        ["Volume", formatCompact(item.volume)],
        ["Mcap", formatCompact(item.market_cap)],
        ["Alpha", formatNumber(item.alpha_event_summary.total_count)],
        ["Exchange", item.exchange || "-"]
    ];

    return (
        <article
            aria-label={`${item.symbol} ${percent} ${trendLabel(item.day_change_perc)}`}
            className={`group relative isolate flex h-full min-h-0 min-w-0 overflow-visible rounded-lg border text-white shadow-sm outline-none transition-transform duration-150 hover:z-20 ${dense ? "p-1" : "p-1.5"} ${heatmapTileClass(index, item.day_change_perc, dense)}`}
            data-heatmap-tile
            style={tone}
            tabIndex={0}
        >
            <div className="pointer-events-none absolute inset-0 rounded-lg bg-[linear-gradient(180deg,rgba(255,255,255,0.1),rgba(0,0,0,0.1))]" />
            <div className="pointer-events-none absolute inset-0 rounded-lg opacity-0 ring-2 ring-white/40 transition-opacity group-hover:opacity-100" />

            <div className={`relative flex min-h-0 w-full flex-col justify-between overflow-hidden transition-opacity duration-150 group-hover:opacity-0 ${dense ? "gap-1" : "gap-1.5"}`}>
                <div className="flex min-h-0 items-start justify-between gap-1.5">
                    <div className="min-w-0">
                        <h2 className={`truncate font-extrabold leading-none ${dense ? "text-[11px] min-[1180px]:text-xs" : "text-[13px] min-[1180px]:text-[15px]"}`}>
                            {item.symbol}
                        </h2>
                        {!dense ? (
                            <p className="mt-0.5 line-clamp-1 text-[9px] font-semibold leading-tight text-white/76 min-[1180px]:text-[10px]">
                                {item.company_name || item.industry || item.exchange || "Live market data"}
                            </p>
                        ) : null}
                    </div>
                    {item.logo ? (
                        <img alt="" className={`${dense ? "size-4" : "size-6"} shrink-0 object-contain`} draggable={false} src={item.logo} />
                    ) : (
                        <div className={`flex shrink-0 items-center justify-center rounded-lg border border-white/24 bg-black/12 ${dense ? "size-5" : "size-6"}`}>
                            <span className="font-mono text-[8px] font-bold text-white/88">{symbolInitials(item.symbol)}</span>
                        </div>
                    )}
                </div>

                <div className="min-h-0">
                    {!dense ? <p className="font-mono text-[8px] font-semibold uppercase text-white/66">{trendLabel(item.day_change_perc)}</p> : null}
                    <div className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                        <p className={`font-extrabold leading-none ${dense ? "text-[14px] min-[1180px]:text-base" : "text-[17px] min-[1180px]:text-xl"}`}>
                            {percent}
                        </p>
                        <p className={`font-mono font-semibold text-white/84 ${dense ? "hidden text-[8px] min-[1180px]:inline" : "text-[9px]"}`}>
                            LTP {formatCompact(item.ltp)}
                        </p>
                    </div>
                </div>

                <div aria-hidden="true" className="min-h-1" />
            </div>

            <div
                className="pointer-events-none absolute left-[var(--heatmap-hover-left,0px)] top-[var(--heatmap-hover-top,0px)] z-10 flex min-h-[var(--heatmap-hover-min-height,100%)] w-[var(--heatmap-hover-width,100%)] flex-col overflow-visible rounded-lg border border-white/30 bg-inherit p-3 opacity-0 shadow-2xl ring-1 ring-black/25 transition-[opacity,left,top] duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
                data-heatmap-hover-card
            >
                <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.12),rgba(0,0,0,0.12))]" />
                <div className="relative flex min-w-0 items-start justify-between gap-2">
                    <div className="min-w-0">
                        <p className="truncate text-xl font-extrabold leading-none">{item.symbol}</p>
                        <p className="mt-1 line-clamp-2 text-sm font-semibold leading-tight text-white/82">
                            {item.company_name || item.industry || item.exchange || "Live market data"}
                        </p>
                    </div>
                    {item.logo ? (
                        <img alt="" className="size-9 shrink-0 object-contain" draggable={false} src={item.logo} />
                    ) : (
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-white/24 bg-black/14">
                            <span className="font-mono text-xs font-bold text-white/90">{symbolInitials(item.symbol)}</span>
                        </div>
                    )}
                </div>

                <div className="relative mt-3 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                    <p className="text-3xl font-extrabold leading-none">{percent}</p>
                    <p className="font-mono text-sm font-semibold uppercase text-white/74">{trendLabel(item.day_change_perc)}</p>
                </div>

                <dl className="relative mt-3 grid grid-cols-2 gap-x-5 gap-y-2.5 text-sm text-white/88">
                    {detailRows.map(([label, value]) => (
                        <div className="min-w-0" key={label}>
                            <dt className="font-mono text-[10px] font-semibold uppercase text-white/58">{label}</dt>
                            <dd className="mt-0.5 truncate font-bold leading-tight">{value}</dd>
                        </div>
                    ))}
                </dl>

                <div className="relative mt-auto flex flex-wrap gap-1.5 pt-3 text-xs font-semibold text-white/84">
                    {item.sector ? <span className="rounded-lg border border-white/22 bg-black/16 px-2 py-1">{item.sector}</span> : null}
                    {item.industry ? <span className="rounded-lg border border-white/22 bg-black/16 px-2 py-1">{item.industry}</span> : null}
                    {item.theme ? <span className="rounded-lg border border-white/22 bg-black/16 px-2 py-1">{item.theme}</span> : null}
                    {item.source_kinds.slice(0, 2).map((sourceKind) => (
                        <span className="rounded-lg border border-white/22 bg-black/16 px-2 py-1" key={sourceKind}>
                            {sourceKind}
                        </span>
                    ))}
                </div>
            </div>
        </article>
    );
}

function BreadthCell({
    count,
    icon: Icon,
    label,
    tone,
    total
}: {
    count: number;
    icon: LucideIcon;
    label: string;
    tone: string;
    total: number;
}) {
    return (
        <div className="min-w-0 px-3 py-2">
            <p className={cn("flex items-center gap-1.5 font-semibold", tone)}>
                <Icon className="size-3.5" aria-hidden="true" />
                <span className="truncate">
                    {count} {label}
                </span>
            </p>
            <p className="mt-1 font-mono text-[10px] text-muted-foreground">{breadthPercent(count, total)}</p>
        </div>
    );
}

export default async function HeatmapPage({
    searchParams
}: {
    searchParams: SearchParamsInput;
}) {
    const params = await searchParams;
    const cookieStore = await cookies();
    const storedFilters = parseStoredHeatmapFilters(cookieStore.get(HEATMAP_FILTER_COOKIE_KEY)?.value);
    const rawScope = readFirst(params.scope);
    const storedScope = isHeatmapScope(storedFilters.scope) ? storedFilters.scope : null;
    const scope: HeatmapScope = isScope(rawScope) ? rawScope : storedScope || "tracked";
    const limit = Number(readFirst(params.limit)) || DEFAULT_LIMIT;
    const days = Number(readFirst(params.days)) || DEFAULT_DAYS;

    let accounts: BrokerAccount[] = [];
    let watchlists: Watchlist[] = [];
    let loadError = "";

    const [accountsResult, watchlistsResult] = await Promise.allSettled([getBrokerAccounts(), getWatchlists()]);
    if (accountsResult.status === "fulfilled") {
        accounts = accountsResult.value;
    } else {
        loadError = accountsResult.reason instanceof Error ? accountsResult.reason.message : "Could not load broker accounts.";
    }
    if (watchlistsResult.status === "fulfilled") {
        watchlists = watchlistsResult.value;
    } else if (!loadError) {
        loadError = watchlistsResult.reason instanceof Error ? watchlistsResult.reason.message : "Could not load watchlists.";
    }

    const rawWatchlistId = readFirst(params.watchlist_id);
    const rawAccountId = readFirst(params.account_id);
    const storedWatchlistId = watchlists.some((watchlist) => watchlist.id === storedFilters.watchlistId)
        ? storedFilters.watchlistId
        : "";
    const storedAccountId = accounts.some((account) => account.id === storedFilters.accountId) ? storedFilters.accountId : "";
    const effectiveWatchlistId = rawWatchlistId || storedWatchlistId || watchlists[0]?.id || "";
    const effectiveAccountId = rawAccountId || storedAccountId || accounts[0]?.id || "";

    let heatmap: HeatmapResponse | null = null;
    let heatmapError = "";
    const canLoadHeatmap =
        scope === "tracked" ||
        (scope === "watchlist" && Boolean(effectiveWatchlistId)) ||
        (scope === "portfolio_holdings" && Boolean(effectiveAccountId));

    if (!loadError && canLoadHeatmap) {
        try {
            heatmap = await getLiveHeatmap({
                limit,
                days,
                scope,
                watchlist_id: scope === "watchlist" ? effectiveWatchlistId : null,
                account_id: scope === "portfolio_holdings" ? effectiveAccountId : null
            });
        } catch (caught) {
            heatmapError = formatUserFacingError(caught, "Could not load heatmap.");
        }
    }

    const cards = [...(heatmap?.items ?? [])].sort(
        (a, b) => Math.abs(b.day_change_perc ?? 0) - Math.abs(a.day_change_perc ?? 0) || a.symbol.localeCompare(b.symbol)
    );
    const hasPartialData = Boolean(heatmap && heatmap.returned_count < heatmap.tracked_symbol_count);
    const advancingCount = cards.filter((item) => (item.day_change_perc ?? 0) > 0).length;
    const decliningCount = cards.filter((item) => (item.day_change_perc ?? 0) < 0).length;
    const neutralCount = Math.max(cards.length - advancingCount - decliningCount, 0);
    const strongestMove = cards[0]?.day_change_perc ?? null;
    const isDenseHeatmap = cards.length > 72;
    const selectedBrokerCode =
        heatmap?.broker_code || accounts.find((account) => account.id === (heatmap?.account_id || effectiveAccountId))?.broker_code || null;
    const selectedBrokerName = brokerDisplayName(selectedBrokerCode);
    const hasConnectedBroker = accounts.some((account) => account.is_active);

    return (
        <>
            <div className="flex h-[calc(100dvh-8.25rem)] min-h-0 min-w-0 flex-1 flex-col overflow-hidden min-[980px]:h-auto">
                <header className={`shrink-0 border-b border-border ${isDenseHeatmap ? "mb-2 pb-2" : "mb-3 pb-3"}`}>
                    <h1 className={cn(typography.pageTitle, "truncate")}>Heatmap</h1>
                </header>

                <section className="mb-2 grid min-w-0 shrink-0 gap-2 min-[1120px]:grid-cols-[minmax(0,1fr)_minmax(20rem,24rem)]">
                    <Card className="min-w-0 border-border/80 bg-card/95 shadow-xs">
                        <CardPanel className="flex min-w-0 flex-col gap-3 p-3">
                            <HeatmapFilters
                                accounts={accounts}
                                currentAccountId={effectiveAccountId}
                                currentScope={scope}
                                currentWatchlistId={effectiveWatchlistId}
                                watchlists={watchlists}
                            />
                            <div className="flex min-w-0 flex-wrap items-center gap-1.5 border-t border-border/70 pt-2 text-xs font-medium text-muted-foreground">
                                <span className="min-w-0">Default broker</span>
                                <Badge className="max-w-44 truncate" variant="outline">
                                    {selectedBrokerName}
                                </Badge>
                                <Button asChild className="h-6 px-2 text-xs" size="xs" variant="ghost">
                                    <Link href="/settings">Change in Settings</Link>
                                </Button>
                            </div>
                        </CardPanel>
                    </Card>
                    {heatmap ? (
                        <Card className="min-w-0 border-border/80 bg-card/95 shadow-xs">
                            <CardHeader className="grid-cols-[minmax(0,1fr)_auto] gap-2 p-3 pb-2">
                                <CardTitle className="truncate font-mono text-xs uppercase tracking-[0.12em]">{heatmap.scope_label}</CardTitle>
                                <CardDescription className="text-xs">
                                    {heatmap.returned_count}/{heatmap.tracked_symbol_count} live
                                </CardDescription>
                                <CardAction className="self-center">
                                    <Badge variant="outline">
                                        <RadioTower className="size-3" aria-hidden="true" />
                                        {heatmap.broker_code ? `${heatmap.broker_code} · ${days}d` : `${days}d`}
                                    </Badge>
                                </CardAction>
                            </CardHeader>
                            <CardPanel className="p-0">
                                <div className="grid grid-cols-3 overflow-hidden border-t border-border/70 text-xs">
                                    <BreadthCell
                                        count={advancingCount}
                                        icon={TrendingUp}
                                        label="up"
                                        tone="text-[var(--success)]"
                                        total={cards.length}
                                    />
                                    <div className="border-x border-border/70">
                                        <BreadthCell
                                            count={decliningCount}
                                            icon={TrendingDown}
                                            label="down"
                                            tone="text-[var(--danger)]"
                                            total={cards.length}
                                        />
                                    </div>
                                    <div className="min-w-0 px-3 py-2">
                                        <p className="flex items-center gap-1.5 font-semibold text-muted-foreground">
                                            <Minus className="size-3.5" aria-hidden="true" />
                                            <span className="truncate">{neutralCount} flat</span>
                                        </p>
                                        <p className="mt-1 font-mono text-[10px] text-muted-foreground">max {formatPercent(strongestMove)}</p>
                                    </div>
                                </div>
                            </CardPanel>
                        </Card>
                    ) : null}
                </section>

                {loadError ? (
                    <Alert className="mb-2 shrink-0 px-3 py-2 text-xs" variant="warning">
                        <AlertDescription>{loadError}</AlertDescription>
                    </Alert>
                ) : null}

                {!loadError && !canLoadHeatmap ? (
                    <Empty className="min-h-0 rounded-lg border border-dashed border-border bg-card/40">
                        <EmptyHeader>
                            <EmptyMedia variant="icon">
                                <Grid2X2 aria-hidden="true" />
                            </EmptyMedia>
                            <EmptyTitle>{sourceEmptyMessage(scope)}</EmptyTitle>
                            <EmptyDescription>
                                {scope === "watchlist" ? "Watchlists become available after you add symbols." : null}
                                {scope === "portfolio_holdings" ? "Broker holdings appear after the broker session is active." : null}
                            </EmptyDescription>
                        </EmptyHeader>
                        <EmptyContent>
                            <Button asChild variant="outline">
                                <Link href={scope === "watchlist" ? "/watchlists" : "/broker-connections"}>
                                    {scope === "watchlist" ? "Open Watchlists" : "Open Broker Connections"}
                                    <ArrowRight className="size-4" aria-hidden="true" />
                                </Link>
                            </Button>
                        </EmptyContent>
                    </Empty>
                ) : null}

                {heatmapError ? (
                    <Alert className="mb-2 shrink-0 px-3 py-2 text-xs" variant="warning">
                        <AlertDescription>{heatmapError}</AlertDescription>
                    </Alert>
                ) : null}

                {heatmap ? (
                    <Card className="min-h-0 flex-1 border-border/80 bg-card/95 shadow-xs">
                        <CardPanel className="flex min-h-0 flex-1 flex-col gap-2 p-2">
                            {hasPartialData ? (
                                <Alert className={`shrink-0 rounded-md border-warning/35 bg-warning/8 px-3 text-xs ${isDenseHeatmap ? "py-1.5" : "py-2"}`} variant="warning">
                                    <AlertDescription>
                                        Showing {heatmap.returned_count} symbols with usable pricing data; some symbols could not be quoted live.
                                    </AlertDescription>
                                </Alert>
                            ) : null}

                            {!cards.length ? (
                                <Empty className="min-h-0 rounded-lg border border-dashed border-border bg-card/40">
                                    <EmptyHeader className="max-w-2xl">
                                        <EmptyMedia variant="icon">
                                            <Grid2X2 aria-hidden="true" />
                                        </EmptyMedia>
                                        <EmptyTitle>{noQuotableSymbolsTitle(scope, heatmap.scope_label)}</EmptyTitle>
                                        <EmptyDescription className="leading-6">
                                            {hasConnectedBroker
                                                ? `${selectedBrokerName} is connected, but it did not return live prices for this heatmap selection. This usually means the instruments are not available through the current default broker plan, the market-data entitlement is limited, or this broker does not support these symbols for live heatmap data. Upgrade the broker data plan or try a different connected broker.`
                                                : "Connect an active broker account with live market-data access, then try loading the heatmap again."}
                                        </EmptyDescription>
                                    </EmptyHeader>
                                    <EmptyContent className="flex-row flex-wrap justify-center">
                                        <Button asChild variant="outline">
                                            <Link href="/broker-connections">
                                                Try another broker
                                                <ArrowRight className="size-4" aria-hidden="true" />
                                            </Link>
                                        </Button>
                                        {scope === "watchlist" ? (
                                            <Button asChild variant="ghost">
                                                <Link href="/watchlists">Review watchlist</Link>
                                            </Button>
                                        ) : null}
                                    </EmptyContent>
                                </Empty>
                            ) : (
                                <>
                                    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 text-xs">
                                        <div className="flex items-center gap-1.5 text-muted-foreground">
                                            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">Heat scale</span>
                                            {[
                                                ["<-5%", "hsl(0 70% 37%)"],
                                                ["-1%", "hsl(0 58% 54%)"],
                                                ["0", "hsl(220 8% 42% / 0.72)"],
                                                ["+1%", "hsl(151 50% 45%)"],
                                                [">+5%", "hsl(149 72% 30%)"]
                                            ].map(([label, color]) => (
                                                <span className="inline-flex items-center gap-1" key={label}>
                                                    <span className="size-2.5 rounded-sm border border-border" style={{ backgroundColor: color }} />
                                                    <span>{label}</span>
                                                </span>
                                            ))}
                                        </div>
                                        <p className="font-medium text-muted-foreground">
                                            Sorted by absolute intraday move, then symbol.
                                        </p>
                                    </div>
                                    <HeatmapMeasuredGrid dense={isDenseHeatmap}>
                                        {cards.map((item, index) => (
                                            <HeatmapCard dense={isDenseHeatmap} index={index} item={item} key={`${item.symbol}:${item.exchange ?? ""}`} />
                                        ))}
                                    </HeatmapMeasuredGrid>
                                </>
                            )}
                        </CardPanel>
                    </Card>
                ) : null}

                {scope === "watchlist" && watchlists.length ? (
                    <p className="mt-2 shrink-0 truncate border-l-2 border-border pl-3 text-xs text-muted-foreground">
                        <Activity className="mr-1 inline size-4 align-[-3px]" aria-hidden="true" />
                        Available watchlists:{" "}
                        {watchlists.map((watchlist) => `${watchlist.name} (${symbolCountLabel(watchlist)})`).join(" · ")}
                    </p>
                ) : null}
            </div>
        </>
    );
}
