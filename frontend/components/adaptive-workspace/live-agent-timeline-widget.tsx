"use client";

import { LiveStatusBadge } from "@/components/adaptive-workspace/widget-kit";

export function LiveAgentTimelineWidget() {
    return (
        <div className="flex h-full min-h-0 flex-col p-3">
            <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">Run activity</p>
                <LiveStatusBadge label="Chat" tone="idle" />
            </div>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
                Tool calls and compose steps stay in the chat inspector. This widget no longer shows protocol dumps.
            </p>
        </div>
    );
}
