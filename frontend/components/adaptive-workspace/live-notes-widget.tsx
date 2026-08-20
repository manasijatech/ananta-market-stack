"use client";

import { LiveStatusBadge } from "@/components/adaptive-workspace/widget-kit";
import type { WorkspaceComponent } from "@/service/types/adaptive-workspace";

type Props = {
    component: WorkspaceComponent;
};

export function LiveNotesWidget({ component }: Props) {
    const text = typeof component.props?.text === "string" ? component.props.text : "Add a short note. Plain text only.";
    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-center justify-between gap-2 px-3 pt-2">
                <p className="text-xs text-muted-foreground">Plain text</p>
                <LiveStatusBadge label="Local" tone="idle" />
            </div>
            <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-3 text-sm leading-6">{text}</pre>
        </div>
    );
}
