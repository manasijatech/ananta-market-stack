"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AlertNotification, AlertWorkflowRun } from "@/service/types/alerts";

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
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        setVisibleCount((current) => Math.min(rows.length, current + pageSize));
      }
    }, { rootMargin: "160px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [pageSize, rows.length]);

  return {
    rows: rows.slice(0, visibleCount),
    hasMore: visibleCount < rows.length,
    sentinelRef
  };
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
        <div className="text-sm font-bold">Recent alerts</div>
        <div className="grid max-h-[420px] gap-3 overflow-y-auto pr-1">
          {alertList.rows.map((item) => (
            <div className="rounded-lg border border-border p-4" key={item.id}>
              <div className="text-sm font-bold">{item.title}</div>
              <div className="mt-1 text-xs text-muted-foreground">{item.message}</div>
              <div className="mt-2 text-xs text-muted-foreground">
                {item.symbol ?? "-"} · {item.level} · {item.channels.join(", ") || "in_app"}
              </div>
            </div>
          ))}
          {!notifications.length ? <div className="text-sm text-muted-foreground">No alert notifications yet.</div> : null}
          {alertList.hasMore ? <div className="h-4" ref={alertList.sentinelRef} /> : null}
        </div>
      </section>
      <section className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-bold">Recent workflow runs</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {runStats.total} loaded · {runStats.matched} matched · {runStats.unmatched} not matched
              {runStats.latestAt ? ` · Last ${new Date(runStats.latestAt).toLocaleString()}` : ""}
            </div>
          </div>
          <button
            className="text-xs font-semibold text-muted-foreground hover:text-foreground"
            onClick={() => setShowRuns((current) => !current)}
            type="button"
          >
            {showRuns ? "Hide details" : "View details"}
          </button>
        </div>
        {showRuns ? (
          <div className="grid max-h-[420px] gap-3 overflow-y-auto pr-1">
            {runList.rows.map((item) => (
              <div className="rounded-lg border border-border p-4" key={item.id}>
                <div className="text-sm font-bold">{item.rendered_title || item.reason}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {item.matched ? "Matched" : "No match"} · {item.channels.join(", ") || "in_app"}
                </div>
              </div>
            ))}
            {!runs.length ? <div className="text-sm text-muted-foreground">No workflow runs yet.</div> : null}
            {runList.hasMore ? <div className="h-4" ref={runList.sentinelRef} /> : null}
          </div>
        ) : (
          <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
            Keep this collapsed for the summary view. Open details only when you want to inspect recent evaluations.
          </div>
        )}
      </section>
    </div>
  );
}
