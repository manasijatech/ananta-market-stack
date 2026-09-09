"use client";

import { useMemo } from "react";
import type { BrokerChatEvent, BrokerChatRun } from "@/service/types/broker-chat";

type Props = {
    eventsByRun: Record<string, BrokerChatEvent[]>;
    runs: BrokerChatRun[];
    sessionId: string;
};

function asNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatChars(chars: number): string {
    if (chars >= 1_000_000) return `${(chars / 1_000_000).toFixed(1)}M`;
    if (chars >= 1_000) return `${(chars / 1_000).toFixed(1)}k`;
    return String(chars);
}

/** Shows the latest server-reported model-context size for this chat session. */
export function ContextUsageIndicator({ eventsByRun, runs, sessionId }: Props) {
    const usage = useMemo(() => {
        const sessionRuns = runs.filter((run) => run.session_id === sessionId);
        for (const run of [...sessionRuns].reverse()) {
            const event = [...(eventsByRun[run.id] ?? [])]
                .reverse()
                .find((item) => item.event_type === "model_context_built");
            const chars = asNumber(event?.payload.char_count);
            if (chars !== null) return chars;
        }
        return null;
    }, [eventsByRun, runs, sessionId]);

    if (usage === null) return null;

    return (
        <span
            className="inline-flex h-7 items-center rounded-md border border-border/80 bg-secondary/40 px-2 text-[11px] font-semibold text-muted-foreground"
            title={`${usage.toLocaleString()} characters in the model context for the latest run`}
        >
            {formatChars(usage)} ctx
        </span>
    );
}
