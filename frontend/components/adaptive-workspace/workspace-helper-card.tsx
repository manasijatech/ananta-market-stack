"use client";

import type { CustomToolRendererProps } from "@/components/agent-elements/types";
import { ToolCardShell } from "@/components/adaptive-workspace/tool-card-shell";
import { isRecord, unwrapToolOutput } from "@/lib/adaptive-workspace/tool-envelope";

function titleForHelper(name: string) {
    if (name === "workspace_get_authoring_docs") return "Workspace catalog";
    if (name === "workspace_get_current") return "Current desk";
    if (name === "workspace_evaluate_request") return "Request coverage";
    if (name === "workspace_export_a2ui") return "A2UI export";
    if (name === "workspace_validate_a2ui") return "A2UI validate";
    if (name === "workspace_export_agui") return "AG-UI snapshot";
    if (name === "workspace_get_micro_app") return "Micro-app registry";
    return "Workspace validate";
}

function pendingLabelForHelper(name: string) {
    if (name === "workspace_get_authoring_docs") return "Loading catalog";
    if (name === "workspace_get_current") return "Reading canvas";
    if (name === "workspace_evaluate_request") return "Evaluating request";
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
            {name === "workspace_evaluate_request" && isRecord(payload) ? (
                <div className="grid gap-1 text-sm">
                    <p>
                        {payload.complements_query === true ? "Desk complements the request." : "Coverage still incomplete."}
                    </p>
                    {Array.isArray(payload.intents) ? (
                        <p className="text-xs text-muted-foreground">Intents: {payload.intents.filter((item): item is string => typeof item === "string").join(", ") || "none"}</p>
                    ) : null}
                    {Array.isArray(payload.missing_from_spec) && payload.missing_from_spec.length ? (
                        <p className="text-xs text-muted-foreground">
                            Missing: {payload.missing_from_spec.filter((item): item is string => typeof item === "string").join(", ")}
                        </p>
                    ) : null}
                </div>
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
