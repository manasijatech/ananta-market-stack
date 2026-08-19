"use client";

import type { CustomToolRendererProps } from "@/components/agent-elements/types";
import { ToolCardShell } from "@/components/adaptive-workspace/tool-card-shell";
import { isRecord, unwrapToolOutput } from "@/lib/adaptive-workspace/tool-envelope";

function titleForHelper(name: string) {
    if (name === "workspace_get_authoring_docs") return "Workspace catalog";
    if (name === "workspace_get_current") return "Current desk";
    return "Workspace validate";
}

function pendingLabelForHelper(name: string) {
    if (name === "workspace_get_authoring_docs") return "Loading catalog";
    if (name === "workspace_get_current") return "Reading canvas";
    return "Validating WorkspaceSpec";
}

export function WorkspaceHelperCard({ name, output, status }: CustomToolRendererProps) {
    const pending = status === "pending" || status === "streaming";
    const payload = pending ? null : unwrapToolOutput(output);
    const valid = isRecord(payload) ? payload.valid : undefined;
    const types = isRecord(payload) && Array.isArray(payload.preferred_component_types)
        ? payload.preferred_component_types.filter((item): item is string => typeof item === "string")
        : [];
    const errors = isRecord(payload) && isRecord(payload.validation) && Array.isArray(payload.validation.errors)
        ? payload.validation.errors
        : [];
    const rejected = isRecord(payload) && (payload.ok === false || payload.valid === false);

    return (
        <ToolCardShell
            error={pending || !rejected ? null : name === "workspace_validate_spec" ? "WorkspaceSpec is invalid." : null}
            pending={pending}
            pendingLabel={pendingLabelForHelper(name)}
            title={titleForHelper(name)}
        >
            {name === "workspace_get_authoring_docs" ? (
                <p className="text-sm">
                    Catalog loaded
                    {types.length ? `: ${types.join(", ")}` : ". Use only listed component types."}
                </p>
            ) : null}
            {name === "workspace_get_current" ? (
                <p className="text-sm">
                    {isRecord(payload) && payload.empty
                        ? "The canvas is empty."
                        : `Current desk${isRecord(payload) && isRecord(payload.spec) && typeof payload.spec.title === "string" ? `: ${payload.spec.title}` : ""}.`}
                </p>
            ) : null}
            {name === "workspace_validate_spec" && valid === true ? (
                <p className="text-sm">WorkspaceSpec is valid. It has not been applied yet.</p>
            ) : null}
            {name === "workspace_validate_spec" && rejected ? (
                <ul className="list-disc space-y-1 pl-4 text-xs text-destructive">
                    {errors.flatMap((item, index) => {
                        if (!isRecord(item) || typeof item.message !== "string") {
                            return [];
                        }
                        const path = typeof item.path === "string" ? item.path : "";
                        return [
                            <li key={`${path}:${item.message}:${index}`}>
                                {path ? <span className="font-mono">{path}</span> : null}
                                {path ? ": " : null}
                                {item.message}
                            </li>
                        ];
                    })}
                </ul>
            ) : null}
        </ToolCardShell>
    );
}
