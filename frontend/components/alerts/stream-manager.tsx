"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { getLivePricesWebSocketConfig, getLiveStreamsStatus, reconcileLiveSubscriptions } from "@/service/actions/alerts";
import type { LivePriceTick, LiveStreamsStatus } from "@/service/types/alerts";
import { Button } from "@/components/ui/button";

type SocketState = "connecting" | "connected" | "disconnected" | "error";

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

function LivePricesPanel({ status }: { status: LiveStreamsStatus }) {
    const [socketState, setSocketState] = useState<SocketState>("connecting");
    const [message, setMessage] = useState("");
    const [prices, setPrices] = useState<Record<string, LivePriceTick>>({});
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

    const availableCount = useMemo(
        () => desiredRows.reduce((count, row) => count + (prices[row.key] ? 1 : 0), 0),
        [desiredRows, prices]
    );

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
            setSocketState("connecting");
            setMessage("");
            try {
                const { url } = await getLivePricesWebSocketConfig();
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
    }, []);

    return (
        <section className="grid gap-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <div className="type-section-title">Live prices</div>
                    <div className="type-help text-muted-foreground">
                        {availableCount}/{desiredRows.length} desired symbols have a fresh Redis quote snapshot.
                        {message ? ` ${message}.` : ""}
                    </div>
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
            <div className="max-h-[34rem] overflow-auto border border-border">
                <table className="w-full min-w-[62rem] border-collapse text-left">
                    <thead className="sticky top-0 bg-background">
                        <tr className="type-meta border-b border-border text-muted-foreground">
                            <th className="px-4 py-3">Symbol</th>
                            <th className="px-4 py-3">LTP</th>
                            <th className="px-4 py-3">Change</th>
                            <th className="px-4 py-3">Open</th>
                            <th className="px-4 py-3">High</th>
                            <th className="px-4 py-3">Low</th>
                            <th className="px-4 py-3">Volume</th>
                            <th className="px-4 py-3">Bid / Ask</th>
                            <th className="px-4 py-3">Updated</th>
                        </tr>
                    </thead>
                    <tbody>
                        {desiredRows.map((row) => {
                            const price = prices[row.key];
                            const change = toNumber(price?.change_pct ?? price?.day_change_perc);
                            return (
                                <tr className="border-b border-border last:border-0" key={row.key}>
                                    <td className="px-4 py-3">
                                        <div className="type-section-title">{row.symbol}</div>
                                        <div className="type-meta text-muted-foreground">
                                            {row.exchange ?? "-"} · {row.broker_code ?? "-"}
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 font-semibold">{formatPrice(price?.ltp ?? price?.last_price)}</td>
                                    <td
                                        className={`px-4 py-3 ${
                                            change === null
                                                ? "text-muted-foreground"
                                                : change >= 0
                                                  ? "text-[var(--success)]"
                                                  : "text-[var(--danger)]"
                                        }`}
                                    >
                                        {formatPercent(change)}
                                    </td>
                                    <td className="px-4 py-3">{formatPrice(price?.open)}</td>
                                    <td className="px-4 py-3">{formatPrice(price?.high)}</td>
                                    <td className="px-4 py-3">{formatPrice(price?.low)}</td>
                                    <td className="px-4 py-3">{formatNumber(price?.volume, { maximumFractionDigits: 0 })}</td>
                                    <td className="px-4 py-3">
                                        {formatPrice(price?.best_bid_price)} / {formatPrice(price?.best_ask_price)}
                                    </td>
                                    <td className="px-4 py-3 text-muted-foreground">{formatTime(price?.received_at)}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
                {!desiredRows.length ? (
                    <div className="type-body p-4 text-muted-foreground">No active desired symbols to display.</div>
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
        <div className="grid gap-6">
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
                <div className="type-section-title">Desired subscriptions</div>
                <div className="type-help text-muted-foreground">
                    Only active subscriptions are tracked here and counted toward live worker capacity.
                </div>
                {status.desired_subscriptions.map((subscription) => (
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
                {!status.desired_subscriptions.length ? (
                    <div className="type-body text-muted-foreground">
                        No active subscriptions are currently being tracked.
                    </div>
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
