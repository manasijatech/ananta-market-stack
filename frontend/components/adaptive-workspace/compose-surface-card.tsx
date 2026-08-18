"use client";

import type { CustomToolRendererProps } from "@/components/agent-elements/types";
import { ToolCardShell } from "@/components/adaptive-workspace/tool-card-shell";
import { isRecord, unwrapToolOutput } from "@/lib/adaptive-workspace/tool-envelope";

function componentCount(output: unknown) {
    const payload = unwrapToolOutput(output);
    if (!isRecord(payload) || !isRecord(payload.spec) || !Array.isArray(payload.spec.components)) {
        return 0;
    }
    return payload.spec.components.length;
}

function titleFromOutput(output: unknown, fallback: string) {
    const payload = unwrapToolOutput(output);
    if (isRecord(payload) && isRecord(payload.spec) && typeof payload.spec.title === "string") {
        return payload.spec.title;
    }
    return fallback;
}

export function ComposeSurfaceCard({ name, output, status }: CustomToolRendererProps) {
    const pending = status === "pending" || status === "streaming";
    const payload = pending ? null : unwrapToolOutput(output);
    const ok = isRecord(payload) && payload.ok !== false;
    const count = componentCount(output);

    return (
        <ToolCardShell
            error={pending || ok ? null : "WorkspaceSpec was rejected."}
            pending={pending}
            pendingLabel={name === "patch_surface" ? "Patching canvas" : "Composing canvas"}
            title={name === "patch_surface" ? "Canvas patch" : "Canvas compose"}
        >
            <p className="text-sm">
                Applied <span className="font-semibold">{titleFromOutput(output, "desk")}</span>
                {count ? ` with ${count} widget${count === 1 ? "" : "s"}` : ""}. The canvas is the source of truth.
            </p>
        </ToolCardShell>
    );
}
