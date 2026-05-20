"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AlertNotification, AlertWorkflowRun } from "@/service/types/alerts";
import { Button } from "@/components/ui/button";

const PAGE_SIZE = 12;

function useInfiniteSlice<T>(rows: T[], pageSize = PAGE_SIZE) {
    const [visibleCount, setVisibleCount] = useState(pageSize);
    const sentinelRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        setVisibleCount(pageSize);
    }, [rows, pageSize]);

    useEffect(() => {
        const sentinel = sentinelRef.current;
        if (!sentinel) return;
        const observer = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    if (!entry.isIntersecting) continue;
                    setVisibleCount((current) => Math.min(rows.length, current + pageSize));
                }
            },
            { rootMargin: "160px" }
        );
        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [pageSize, rows.length]);

    return {
        rows: rows.slice(0, visibleCount),
        hasMore: visibleCount < rows.length,
        sentinelRef
    };
}

function llmOutput(payload: Record<string, unknown>) {
    const analysis = payload.llm_analysis;
    if (!analysis || typeof analysis !== "object" || Array.isArray(analysis)) return "";
    const output = (analysis as Record<string, unknown>).output;
    return typeof output === "string" ? output : "";
}

export function AlertHistoryList({
    notifications,
    runs
}: {
    notifications: AlertNotification[];
    runs: AlertWorkflowRun[];
}) {
    const alertList = useInfiniteSlice(notifications);
    const runList = useInfiniteSlice(runs);
    const [showRuns, setShowRuns] = useState(false);

    const runStats = useMemo(() => {
        const matched = runs.filter((item) => item.matched).length;
        return {
            total: runs.length,
            matched,
            unmatched: runs.length - matched,
            latestAt: runs[0]?.created_at ?? null
        };
    }, [runs]);

    return (
        <div className="grid gap-6 min-[1100px]:grid-cols-2">
            <section className="grid gap-3">
                <div className="type-section-title">Recent alerts</div>
                <div className="grid max-h-[420px] gap-3 overflow-y-auto pr-1">
                    {alertList.rows.map((item) => (
                        <div className=" border border-border p-4" key={item.id}>
                            <div className="type-section-title">{item.title}</div>
                            <div className="type-help mt-1 text-muted-foreground">{item.message}</div>
                            {llmOutput(item.payload) ? (
                                <div className="type-help mt-2 border-l-2 border-primary pl-2 text-muted-foreground">
                                    {llmOutput(item.payload)}
                                </div>
                            ) : null}
                            <div className="type-meta mt-2 text-muted-foreground">
                                {item.symbol ?? "-"} · {item.level} · {item.channels.join(", ") || "in_app"}
                            </div>
                        </div>
                    ))}
                    {!notifications.length ? (
                        <div className="type-body text-muted-foreground">No alert notifications yet.</div>
                    ) : null}
                    {alertList.hasMore ? <div className="h-4" ref={alertList.sentinelRef} /> : null}
                </div>
            </section>
            <section className="grid gap-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <div className="type-section-title">Recent workflow runs</div>
                        <div className="type-help mt-1 text-muted-foreground">
                            {runStats.total} loaded · {runStats.matched} matched · {runStats.unmatched} not matched
                            {runStats.latestAt ? ` · Last ${new Date(runStats.latestAt).toLocaleString()}` : ""}
                        </div>
                    </div>
                    <Button
                        className="h-auto px-0 text-xs font-semibold text-muted-foreground hover:text-foreground"
                        onClick={() => setShowRuns((current) => !current)}
                        size="sm"
                        type="button"
                        variant="link"
                    >
                        {showRuns ? "Hide details" : "View details"}
                    </Button>
                </div>
                {showRuns ? (
                    <div className="grid max-h-[420px] gap-3 overflow-y-auto pr-1">
                        {runList.rows.map((item) => (
                            <div className=" border border-border p-4" key={item.id}>
                                <div className="type-section-title">{item.rendered_title || item.reason}</div>
                                <div className="type-meta mt-1 text-muted-foreground">
                                    {item.matched ? "Matched" : "No match"} · {item.channels.join(", ") || "in_app"}
                                </div>
                                {llmOutput(item.evaluation_payload) ? (
                                    <div className="type-help mt-2 border-l-2 border-primary pl-2 text-muted-foreground">
                                        {llmOutput(item.evaluation_payload)}
                                    </div>
                                ) : null}
                            </div>
                        ))}
                        {!runs.length ? (
                            <div className="type-body text-muted-foreground">No workflow runs yet.</div>
                        ) : null}
                        {runList.hasMore ? <div className="h-4" ref={runList.sentinelRef} /> : null}
                    </div>
                ) : (
                    <div className="type-body border border-border p-4 text-muted-foreground">
                        Keep this collapsed for the summary view. Open details only when you want to inspect recent
                        evaluations.
                    </div>
                )}
            </section>
        </div>
    );
}
