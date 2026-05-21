"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AlertWorkflowRun } from "@/service/types/alerts";
import { Button } from "@/components/ui/button";
import { AlertLlmMarkdown } from "@/components/alerts/llm-output-markdown";
import { formatIstDateTime } from "@/lib/datetime";

const PAGE_SIZE = 20;

function useIncrementalRows<T>(rows: T[], pageSize = PAGE_SIZE) {
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
        visibleRows: rows.slice(0, visibleCount),
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

export function ExecutionHistory({ runs }: { runs: AlertWorkflowRun[] }) {
    const { visibleRows, hasMore, sentinelRef } = useIncrementalRows(runs);
    const [expandedRaw, setExpandedRaw] = useState<Record<string, boolean>>({});

    const stats = useMemo(() => {
        const matched = runs.filter((row) => row.matched).length;
        return { total: runs.length, matched, unmatched: runs.length - matched };
    }, [runs]);

    return (
        <section className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <div className="type-section-title">Recent execution history</div>
                    <div className="type-help mt-1 text-muted-foreground">
                        {stats.total} loaded · {stats.matched} matched · {stats.unmatched} not matched
                    </div>
                </div>
            </div>
            <div className="grid max-h-[520px] gap-3 overflow-y-auto pr-1">
                {visibleRows.map((run) => {
                    const isExpanded = expandedRaw[run.id] ?? false;
                    return (
                        <div className=" border border-border p-4" key={run.id}>
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="type-section-title">{run.rendered_title || run.reason}</div>
                                <div className="type-meta">{formatIstDateTime(run.created_at)}</div>
                            </div>
                            <div className="type-help mt-1 text-muted-foreground">
                                {run.rendered_message || run.reason}
                            </div>
                            {llmOutput(run.evaluation_payload) ? (
                                <AlertLlmMarkdown className="mt-3 border-l-2 border-primary pl-3 text-xs text-muted-foreground">
                                    {llmOutput(run.evaluation_payload)}
                                </AlertLlmMarkdown>
                            ) : null}
                            <div className="type-meta mt-3 grid gap-2 text-muted-foreground min-[900px]:grid-cols-4">
                                <span>Matched: {run.matched ? "Yes" : "No"}</span>
                                <span>Reason: {run.reason || "-"}</span>
                                <span>Channels: {run.channels.join(", ") || "-"}</span>
                                <span>Notification: {run.notification_id ?? "-"}</span>
                            </div>
                            <div className="mt-3 flex items-center justify-between">
                                <div className="type-meta">
                                    LTP: {String(run.tick.ltp ?? "-")} · Symbol: {String(run.tick.symbol ?? "-")}
                                </div>
                                <Button
                                    className="h-auto px-0 text-xs font-semibold text-muted-foreground hover:text-foreground"
                                    onClick={() => setExpandedRaw((current) => ({ ...current, [run.id]: !isExpanded }))}
                                    size="sm"
                                    type="button"
                                    variant="link"
                                >
                                    {isExpanded ? "Hide raw" : "View raw"}
                                </Button>
                            </div>
                            {isExpanded ? (
                                <pre className="type-meta mt-3 max-h-[180px] overflow-auto bg-secondary/50 p-3">
                                    {JSON.stringify(run.tick, null, 2)}
                                </pre>
                            ) : null}
                        </div>
                    );
                })}
                {!runs.length ? <div className="type-body text-muted-foreground">No execution history yet.</div> : null}
                {hasMore ? <div className="h-4" ref={sentinelRef} /> : null}
            </div>
        </section>
    );
}
