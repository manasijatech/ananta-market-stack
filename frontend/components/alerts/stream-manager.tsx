"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type UIEvent } from "react";
import { getLivePricesWebSocketConfig, getLiveStreamsStatus, reconcileLiveSubscriptions } from "@/service/actions/alerts";
import type { LivePriceTick, LiveStreamsStatus } from "@/service/types/alerts";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

type SocketState = "connecting" | "connected" | "disconnected" | "error";
const LIVE_PRICE_PAGE_SIZE = 15;

function toNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function formatNumber(value: unknown, options: Intl.NumberFormatOptions = {}): string {
    const numeric = toNumber(value);
    if (numeric === null) return "-";
    return new Intl.NumberFormat("en-IN", options).format(numeric);
}

function formatPrice(value: unknown): string {
    return formatNumber(value, { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

function formatPercent(value: unknown): string {
    const numeric = toNumber(value);
    if (numeric === null) return "-";
    return `${numeric >= 0 ? "+" : ""}${formatNumber(numeric, { maximumFractionDigits: 2 })}%`;
}

function formatTime(value: string | null | undefined): string {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function tickKey(tick: LivePriceTick): string {
    return [tick.account_id || "", tick.broker_code || "", tick.symbol].join(":");
}

function hasLivePrice(tick: LivePriceTick | undefined): boolean {
    return toNumber(tick?.ltp ?? tick?.last_price) !== null;
}

function hasRenderableTick(tick: LivePriceTick | undefined): boolean {
    return Boolean(tick && (hasLivePrice(tick) || tick.unavailable_reason));
}

function LivePricesPanel({ status }: { status: LiveStreamsStatus }) {
    const [socketState, setSocketState] = useState<SocketState>("connecting");
    const [message, setMessage] = useState("");
    const [prices, setPrices] = useState<Record<string, LivePriceTick>>({});
    const [visibleCount, setVisibleCount] = useState(LIVE_PRICE_PAGE_SIZE);
    const pendingRef = useRef<Map<string, LivePriceTick>>(new Map());
    const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const socketRef = useRef<WebSocket | null>(null);

    const desiredRows = useMemo(
        () =>
            status.desired_subscriptions.map((subscription) => ({
                key: [subscription.account_id || "", subscription.broker_code || "", subscription.symbol].join(":"),
                symbol: subscription.symbol,
                exchange: subscription.exchange,
                broker_code: subscription.broker_code,
                account_id: subscription.account_id
            })),
        [status.desired_subscriptions]
    );

    const visibleRows = desiredRows.slice(0, Math.min(visibleCount, desiredRows.length));
    const displayRows = visibleRows.filter((row) => hasRenderableTick(prices[row.key]));
    const visibleAvailableCount = useMemo(
        () => visibleRows.reduce((count, row) => count + (hasLivePrice(prices[row.key]) ? 1 : 0), 0),
        [visibleRows, prices]
    );
    const pendingDisplayCount = Math.min(3, Math.max(visibleRows.length - displayRows.length, 0));
    const visibleRefKey = visibleRows.map((row) => row.key).join(",");

    useEffect(() => {
        setVisibleCount((current) => Math.min(Math.max(current, LIVE_PRICE_PAGE_SIZE), Math.max(desiredRows.length, LIVE_PRICE_PAGE_SIZE)));
    }, [desiredRows.length]);

    function loadMoreVisibleRows() {
        setVisibleCount((current) => Math.min(desiredRows.length, current + LIVE_PRICE_PAGE_SIZE));
    }

    function handleTableScroll(event: UIEvent<HTMLDivElement>) {
        const element = event.currentTarget;
        const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
        if (distanceFromBottom < 120 && visibleRows.length < desiredRows.length) {
            loadMoreVisibleRows();
        }
    }

    useEffect(() => {
        let cancelled = false;
        let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

        function flushPending() {
            flushTimerRef.current = null;
            if (!pendingRef.current.size) return;
            const updates = Array.from(pendingRef.current.entries());
            pendingRef.current.clear();
            setPrices((current) => {
                const next = { ...current };
                for (const [key, value] of updates) {
                    next[key] = value;
                }
                return next;
            });
        }

        function enqueue(rows: LivePriceTick[]) {
            for (const row of rows) {
                if (!row || !row.symbol) continue;
                pendingRef.current.set(tickKey(row), row);
            }
            if (!flushTimerRef.current) {
                flushTimerRef.current = setTimeout(flushPending, 200);
            }
        }

        async function connect() {
            if (!visibleRows.length) {
                setSocketState("disconnected");
                setMessage("");
                setPrices({});
                pendingRef.current.clear();
                return;
            }
            setSocketState("connecting");
            setMessage("");
            setPrices({});
            pendingRef.current.clear();
            try {
                const { url } = await getLivePricesWebSocketConfig(visibleRows);
                if (cancelled) return;
                const socket = new WebSocket(url);
                socketRef.current = socket;
                socket.onopen = () => {
                    setSocketState("connected");
                    setMessage("");
                };
                socket.onmessage = (event) => {
                    try {
                        const payload = JSON.parse(String(event.data)) as {
                            type?: string;
                            rows?: LivePriceTick[];
                            message?: string;
                            symbol_count?: number;
                        };
                        if (payload.type === "snapshot" || payload.type === "prices") {
                            enqueue(Array.isArray(payload.rows) ? payload.rows : []);
                        } else if (payload.type === "connected" || payload.type === "scope") {
                            setMessage(`${payload.symbol_count ?? 0} symbols in live scope`);
                        } else if (payload.type === "error") {
                            setSocketState("error");
                            setMessage(payload.message || "Live price stream failed.");
                        }
                    } catch {
                        setSocketState("error");
                        setMessage("Received an invalid live price payload.");
                    }
                };
                socket.onerror = () => {
                    setSocketState("error");
                    setMessage("Live price socket error.");
                };
                socket.onclose = () => {
                    if (socketRef.current === socket) {
                        socketRef.current = null;
                    }
                    if (cancelled) return;
                    setSocketState("disconnected");
                    reconnectTimer = setTimeout(connect, 2500);
                };
            } catch (error) {
                if (cancelled) return;
                setSocketState("error");
                setMessage(error instanceof Error ? error.message : "Could not open live price socket.");
                reconnectTimer = setTimeout(connect, 2500);
            }
        }

        connect();
        return () => {
            cancelled = true;
            if (reconnectTimer) clearTimeout(reconnectTimer);
            if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
            socketRef.current?.close();
            socketRef.current = null;
        };
    }, [visibleRefKey]);

    return (
        <section className="grid min-w-0 max-w-full gap-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <div className="type-section-title">Live prices</div>
                    <div className="type-help text-muted-foreground">
                        {visibleAvailableCount}/{visibleRows.length} visible rows have a live price snapshot.
                        {message ? ` ${message}.` : ""}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <div className="type-meta whitespace-nowrap text-muted-foreground">
                        Showing {displayRows.length} / {desiredRows.length}
                    </div>
                    <div
                        className={`type-meta border px-2.5 py-1 ${
                            socketState === "connected"
                                ? "border-[var(--success)] text-[var(--success)]"
                                : socketState === "error"
                                  ? "border-[var(--danger)] text-[var(--danger)]"
                                  : "border-border text-muted-foreground"
                        }`}
                    >
                        {socketState}
                    </div>
                </div>
            </div>
            <div
                className="relative left-1/2 max-h-[32rem] w-[70vw] max-w-[70vw] min-w-0 -translate-x-1/2 overflow-y-auto overflow-x-hidden border border-border bg-card shadow-sm"
                onScroll={handleTableScroll}
            >
                <table className="w-full table-fixed border-separate border-spacing-0 text-left text-xs">
                    <colgroup>
                        <col className="w-[18%]" />
                        <col className="w-[10%]" />
                        <col className="w-[8%]" />
                        <col className="w-[9%]" />
                        <col className="w-[9%]" />
                        <col className="w-[9%]" />
                        <col className="w-[11%]" />
                        <col className="w-[14%]" />
                        <col className="w-[12%]" />
                    </colgroup>
                    <thead className="sticky top-0 z-10">
                        <tr className="bg-secondary text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                            <th className="border-b border-r border-border px-3 py-2.5">Symbol</th>
                            <th className="border-b border-r border-border px-3 py-2.5 text-right">LTP</th>
                            <th className="border-b border-r border-border px-3 py-2.5 text-right">Change</th>
                            <th className="border-b border-r border-border px-3 py-2.5 text-right">Open</th>
                            <th className="border-b border-r border-border px-3 py-2.5 text-right">High</th>
                            <th className="border-b border-r border-border px-3 py-2.5 text-right">Low</th>
                            <th className="border-b border-r border-border px-3 py-2.5 text-right">Volume</th>
                            <th className="border-b border-r border-border px-3 py-2.5 text-right">Bid / Ask</th>
                            <th className="border-b border-border px-3 py-2.5 text-right">Time</th>
                        </tr>
                    </thead>
                    <tbody>
                        {displayRows.map((row) => {
                            const price = prices[row.key];
                            const change = toNumber(price?.change_pct ?? price?.day_change_perc);
                            const unavailableReason = !hasLivePrice(price) ? price?.unavailable_reason : "";
                            return (
                                <tr key={row.key}>
                                    <td className="border-b border-r border-border/80 px-3 py-2.5 align-middle">
                                        <div className="truncate text-sm font-semibold leading-5" title={row.symbol}>
                                            {row.symbol}
                                        </div>
                                        <div className="text-[11px] leading-4 text-muted-foreground">
                                            {row.exchange ?? "-"} · {row.broker_code ?? "-"}
                                        </div>
                                    </td>
                                    <td className="border-b border-r border-border/80 px-3 py-2.5 text-right font-mono font-semibold tabular-nums">
                                        {unavailableReason ? (
                                            <span className="text-xs font-medium text-[var(--danger)]" title={unavailableReason}>
                                                unavailable
                                            </span>
                                        ) : (
                                            formatPrice(price?.ltp ?? price?.last_price)
                                        )}
                                    </td>
                                    <td
                                        className={`border-b border-r border-border/80 px-3 py-2.5 text-right font-mono tabular-nums ${
                                            change === null
                                                ? "text-muted-foreground"
                                                : change >= 0
                                                  ? "text-[var(--success)]"
                                                  : "text-[var(--danger)]"
                                        }`}
                                    >
                                        {formatPercent(change)}
                                    </td>
                                    <td className="border-b border-r border-border/80 px-3 py-2.5 text-right font-mono tabular-nums">{formatPrice(price?.open)}</td>
                                    <td className="border-b border-r border-border/80 px-3 py-2.5 text-right font-mono tabular-nums">{formatPrice(price?.high)}</td>
                                    <td className="border-b border-r border-border/80 px-3 py-2.5 text-right font-mono tabular-nums">{formatPrice(price?.low)}</td>
                                    <td className="border-b border-r border-border/80 px-3 py-2.5 text-right font-mono tabular-nums">{formatNumber(price?.volume, { maximumFractionDigits: 0 })}</td>
                                    <td className="border-b border-r border-border/80 px-3 py-2.5 text-right font-mono tabular-nums">
                                        {formatPrice(price?.best_bid_price)} / {formatPrice(price?.best_ask_price)}
                                    </td>
                                    <td className="border-b border-border/80 px-3 py-2.5 text-right font-mono text-[11px] text-muted-foreground">{formatTime(price?.received_at)}</td>
                                </tr>
                            );
                        })}
                        {pendingDisplayCount > 0
                            ? Array.from({ length: pendingDisplayCount }).map((_, rowIndex) => (
                                  <tr key={`pending-${rowIndex}`}>
                                      <td className="border-b border-r border-border/80 px-3 py-2.5 align-middle">
                                          <Skeleton className="h-4 w-28" />
                                          <Skeleton className="mt-2 h-3 w-16" />
                                      </td>
                                      {Array.from({ length: 8 }).map((__, columnIndex) => (
                                          <td
                                              className="border-b border-r border-border/80 px-3 py-2.5"
                                              key={`pending-${rowIndex}-${columnIndex}`}
                                          >
                                              <Skeleton className="ml-auto h-3 w-16" />
                                          </td>
                                      ))}
                                  </tr>
                              ))
                            : null}
                    </tbody>
                </table>
                {!visibleRows.length ? (
                    <div className="type-body p-4 text-muted-foreground">No active desired symbols to display.</div>
                ) : null}
                {visibleRows.length < desiredRows.length ? (
                    <div className="border-t border-border p-3 text-center text-xs text-muted-foreground">
                        Scroll for more rows
                    </div>
                ) : null}
            </div>
        </section>
    );
}

export function StreamManager({ initialStatus }: { initialStatus: LiveStreamsStatus }) {
    const [status, setStatus] = useState(initialStatus);
    const [reconcileNotice, setReconcileNotice] = useState("");
    const [isPending, startTransition] = useTransition();

    function refresh() {
        startTransition(async () => {
            setStatus(await getLiveStreamsStatus());
        });
    }

    function reconcile() {
        startTransition(async () => {
            const report = await reconcileLiveSubscriptions();
            setReconcileNotice(
                `Reconciled ${report.desired} desired subscriptions · created ${report.created} · restored ${report.restored} · deactivated ${report.deactivated}`
            );
            setStatus(await getLiveStreamsStatus());
        });
    }

    return (
        <div className="grid min-w-0 max-w-full gap-6">
            <div className="flex flex-wrap items-center justify-between gap-3 border border-border p-4">
                <div>
                    <div className="type-section-title">{status.worker_mode}</div>
                    <div className="type-help text-muted-foreground">
                        Redis {status.redis_ok ? "connected" : "degraded"}{" "}
                        {status.redis_error ? `· ${status.redis_error}` : ""}
                    </div>
                </div>
                <Button disabled={isPending} onClick={refresh} type="button" variant="outline">
                    Refresh
                </Button>
                <Button disabled={isPending} onClick={reconcile} type="button" variant="outline">
                    Reconcile
                </Button>
            </div>
            {reconcileNotice ? (
                <div className="type-body border border-border px-4 py-3 text-muted-foreground">{reconcileNotice}</div>
            ) : null}

            <LivePricesPanel status={status} />

            <section className="grid gap-3">
                <div className="type-section-title">Broker readiness</div>
                {status.broker_statuses.map((broker) => (
                    <div className=" border border-border p-4" key={`${broker.account_id}-${broker.broker_code}`}>
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                                <div className="type-section-title">
                                    {broker.label} · {broker.broker_code}
                                </div>
                                <div className="type-help mt-1 text-muted-foreground">
                                    {broker.session_active ? "Ready to stream" : "Action required"} ·{" "}
                                    {broker.desired_symbol_count} desired symbols · {broker.active_worker_sessions}{" "}
                                    worker sessions
                                </div>
                            </div>
                            <div className="type-meta text-muted-foreground">
                                {broker.session_status ?? "pending"}
                                {broker.automation_mode ? ` · ${broker.automation_mode}` : ""}
                            </div>
                        </div>
                        <div className="type-help mt-3 text-muted-foreground">
                            {broker.session_active
                                ? "Stored broker session looks usable. Live workers can attach without re-verification from this status call."
                                : broker.guidance ||
                                  broker.last_error ||
                                  "Broker verification or token refresh is still required before live data can attach."}
                        </div>
                        {broker.last_error && !broker.session_active ? (
                            <div className="type-meta mt-2 text-[var(--danger)]">{broker.last_error}</div>
                        ) : null}
                    </div>
                ))}
                {!status.broker_statuses.length ? (
                    <div className="type-body text-muted-foreground">
                        No broker-linked subscriptions yet. Subscriptions can still exist before broker verification is
                        completed.
                    </div>
                ) : null}
            </section>

            <section className="grid gap-3">
                <div className="type-section-title">Worker sessions</div>
                {status.active_sessions.map((session) => (
                    <div
                        className=" border border-border p-4"
                        key={`${session.user_id}-${session.account_id}-${session.broker_code}-${session.connection_index}`}
                    >
                        <div className="type-section-title">
                            {session.broker_code} · {session.account_id} · Connection {session.connection_index}
                        </div>
                        <div className="type-help mt-1 text-muted-foreground">
                            {session.connected ? "Connected" : "Disconnected"} · {session.adapter} ·{" "}
                            {session.symbol_count}/{session.capacity} symbols
                        </div>
                        <div className="type-meta mt-2 text-muted-foreground">
                            Symbols: {session.symbols.join(", ") || "None"}
                        </div>
                    </div>
                ))}
                {!status.active_sessions.length ? (
                    <div className="type-body text-muted-foreground">No active worker sessions yet.</div>
                ) : null}
            </section>

            <section className="grid gap-3">
                <div className="type-section-title">Inactive subscriptions</div>
                <div className="type-help text-muted-foreground">
                    These do not consume stream-manager capacity. They remain visible only so ownership issues can be
                    reviewed or cleaned up.
                </div>
                {status.inactive_subscriptions.map((subscription) => (
                    <div className=" border border-border p-4" key={subscription.id}>
                        <div className="type-section-title">{subscription.symbol}</div>
                        <div className="type-meta text-muted-foreground">
                            {subscription.exchange ?? "-"} · {subscription.broker_code ?? "-"} · {subscription.status} ·{" "}
                            {subscription.source_kind}
                        </div>
                        <div className="type-help mt-1 text-muted-foreground">
                            {[
                                subscription.source_type,
                                subscription.source_label || subscription.source_id,
                                subscription.owner_kind,
                                subscription.health_status
                            ]
                                .filter(Boolean)
                                .join(" · ")}
                        </div>
                        {subscription.health_reason ? (
                            <div className="type-meta mt-1 text-[var(--danger)]">{subscription.health_reason}</div>
                        ) : null}
                    </div>
                ))}
                {!status.inactive_subscriptions.length ? (
                    <div className="type-body text-muted-foreground">No inactive or orphaned subscriptions.</div>
                ) : null}
            </section>
        </div>
    );
}
