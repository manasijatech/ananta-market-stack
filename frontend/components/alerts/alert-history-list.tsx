"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AlertNotification, AlertWorkflowRun } from "@/service/types/alerts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatIstDateTime } from "@/lib/datetime";
import { typography } from "@/lib/typography";
import { cn } from "@/lib/utils";

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

function alertSeverityBorder(level: string) {
    const normalized = level.toLowerCase();
    if (normalized === "critical" || normalized === "error" || normalized === "danger") {
        return "border-l-[3px] border-l-destructive";
    }
    if (normalized === "warning" || normalized === "warn") {
        return "border-l-[3px] border-l-warning";
    }
    return "border-l-[3px] border-l-info";
}

function levelBadgeVariant(level: string): "info" | "warning" | "error" | "secondary" {
    const normalized = level.toLowerCase();
    if (normalized === "critical" || normalized === "error" || normalized === "danger") return "error";
    if (normalized === "warning" || normalized === "warn") return "warning";
    if (normalized === "info") return "info";
    return "secondary";
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
        <div className="grid min-h-[120px] gap-0 min-[1024px]:grid-cols-2 min-[1024px]:divide-x min-[1024px]:divide-border">
            <section className="grid min-h-[120px] gap-3 min-[1024px]:pr-6">
                <p className="type-step-eyebrow">Recent alerts</p>
                <div className="grid max-h-[420px] gap-3 overflow-y-auto pr-1">
                    {alertList.rows.map((item) => (
                        <div
                            className={cn(
                                "min-h-[120px] rounded-lg border border-border bg-card p-4",
                                alertSeverityBorder(item.level)
                            )}
                            key={item.id}
                        >
                            <div className="type-label">{item.title}</div>
                            <div className="type-help mt-1">{item.message}</div>
                            {llmOutput(item.payload) ? (
                                <div className="type-help mt-2 border-l-2 border-border pl-2">
                                    {llmOutput(item.payload)}
                                </div>
                            ) : null}
                            <div className="mt-3 flex flex-wrap items-center gap-1.5">
                                {item.symbol ? (
                                    <Badge size="sm" variant="outline">
                                        {item.symbol}
                                    </Badge>
                                ) : null}
                                <Badge size="sm" variant={levelBadgeVariant(item.level)}>
                                    {item.level}
                                </Badge>
                                {(item.channels.length ? item.channels : ["in_app"]).map((channel) => (
                                    <Badge key={channel} size="sm" variant="secondary">
                                        {channel.replaceAll("_", " ")}
                                    </Badge>
                                ))}
                            </div>
                        </div>
                    ))}
                    {!notifications.length ? (
                        <div className="type-help flex min-h-[120px] items-center">
                            No alert notifications yet.
                        </div>
                    ) : null}
                    {alertList.hasMore ? <div className="h-4" ref={alertList.sentinelRef} /> : null}
                </div>
            </section>
            <section className="grid min-h-[120px] gap-3 min-[1024px]:pl-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <p className="type-step-eyebrow">Recent workflow runs</p>
                        <p className="type-help mt-1">
                            {runStats.total} loaded · {runStats.matched} matched · {runStats.unmatched} not matched
                            {runStats.latestAt ? ` · Last ${formatIstDateTime(runStats.latestAt)}` : ""}
                        </p>
                    </div>
                    <Button
                        className={cn(typography.small, "h-auto px-0 text-muted-foreground hover:text-foreground")}
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
                            <div className="min-h-[120px] rounded-lg border border-border bg-card p-4" key={item.id}>
                                <div className="type-label">
                                    {item.rendered_title || item.reason}
                                </div>
                                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                    <Badge size="sm" variant={item.matched ? "success" : "secondary"}>
                                        {item.matched ? "Matched" : "No match"}
                                    </Badge>
                                    {(item.channels.length ? item.channels : ["in_app"]).map((channel) => (
                                        <Badge key={channel} size="sm" variant="secondary">
                                            {channel.replaceAll("_", " ")}
                                        </Badge>
                                    ))}
                                </div>
                                {llmOutput(item.evaluation_payload) ? (
                                    <div className="type-help mt-2 border-l-2 border-border pl-2">
                                        {llmOutput(item.evaluation_payload)}
                                    </div>
                                ) : null}
                            </div>
                        ))}
                        {!runs.length ? (
                            <div className="type-help flex min-h-[120px] items-center">
                                No workflow runs yet.
                            </div>
                        ) : null}
                        {runList.hasMore ? <div className="h-4" ref={runList.sentinelRef} /> : null}
                    </div>
                ) : (
                    <div className="type-help flex min-h-[120px] items-center rounded-lg border border-border bg-card p-4">
                        Keep this collapsed for the summary view. Open details only when you want to inspect recent
                        evaluations.
                    </div>
                )}
            </section>
        </div>
    );
}
