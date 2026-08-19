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

function validationErrors(output: unknown): Array<{ path: string; message: string }> {
    const payload = unwrapToolOutput(output);
    if (!isRecord(payload) || !isRecord(payload.validation) || !Array.isArray(payload.validation.errors)) {
        return [];
    }
    return payload.validation.errors.flatMap((item) => {
        if (!isRecord(item) || typeof item.message !== "string") {
            return [];
        }
        return [{ path: typeof item.path === "string" ? item.path : "", message: item.message }];
    });
}

function surfaceAccepted(output: unknown): boolean {
    const payload = unwrapToolOutput(output);
    if (!isRecord(payload) || payload.ok === false) {
        return false;
    }
    if (payload.applied === false || payload.valid === false) {
        return false;
    }
    return true;
}

export function ComposeSurfaceCard({ name, output, status }: CustomToolRendererProps) {
    const pending = status === "pending" || status === "streaming";
    const accepted = pending ? false : surfaceAccepted(output);
    const count = componentCount(output);
    const errors = pending ? [] : validationErrors(output);
    const payload = pending ? null : unwrapToolOutput(output);
    const hint = isRecord(payload) && typeof payload.hint === "string" ? payload.hint : null;

    return (
        <ToolCardShell
            error={pending || accepted ? null : "WorkspaceSpec was rejected."}
            pending={pending}
            pendingLabel={name === "patch_surface" ? "Patching canvas" : "Composing canvas"}
            title={name === "patch_surface" ? "Canvas patch" : "Canvas compose"}
        >
            {accepted ? (
                <p className="text-sm">
                    Applied <span className="font-semibold">{titleFromOutput(output, "desk")}</span>
                    {count ? ` with ${count} widget${count === 1 ? "" : "s"}` : ""}. The canvas is the source of truth.
                </p>
            ) : (
                <div className="grid gap-2">
                    {errors.length ? (
                        <ul className="list-disc space-y-1 pl-4 text-xs text-destructive">
                            {errors.map((item) => (
                                <li key={`${item.path}:${item.message}`}>
                                    {item.path ? <span className="font-mono">{item.path}</span> : null}
                                    {item.path ? ": " : null}
                                    {item.message}
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="text-xs text-muted-foreground">
                            Check catalog types (holdings-table, quote-ticker, price-chart, broker-health) and grid rules.
                        </p>
                    )}
                    {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
                </div>
            )}
        </ToolCardShell>
    );
}
