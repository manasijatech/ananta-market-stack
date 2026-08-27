import { isRecord, unwrapToolOutput } from "@/lib/adaptive-workspace/tool-envelope";
import type { WorkspaceSpec, WorkspaceWidgetOutput } from "@/service/types/adaptive-workspace";

export type ExtractedToolOutput = {
    input: Record<string, unknown>;
    output: unknown;
    toolName: string;
};

function toolNameFromPartType(type: string): string | null {
    const mcp = type.match(/tool-mcp__broker__(.+)$/);
    if (mcp?.[1]) return mcp[1];
    if (type.startsWith("tool-") && !type.includes("Thinking")) {
        const name = type.slice("tool-".length);
        return name || null;
    }
    return null;
}

function stableParams(value: Record<string, unknown> | undefined): string {
    if (!value) return "";
    try {
        return JSON.stringify(value);
    } catch {
        return "";
    }
}

export function toolOutputsFromMessages(messages: Array<{ parts?: unknown[]; role?: string }>): ExtractedToolOutput[] {
    const items: ExtractedToolOutput[] = [];
    for (const message of messages) {
        if (message.role !== "assistant" || !Array.isArray(message.parts)) continue;
        for (const part of message.parts) {
            if (!isRecord(part)) continue;
            const type = typeof part.type === "string" ? part.type : "";
            const toolName = toolNameFromPartType(type);
            if (!toolName) continue;
            if (part.state && part.state !== "output-available") continue;
            if (!Object.prototype.hasOwnProperty.call(part, "output")) continue;
            const input = isRecord(part.input) ? part.input : {};
            items.push({ input, output: part.output, toolName });
        }
    }
    return items;
}

function paramsOverlap(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
    const keys = Object.keys(left);
    if (!keys.length) return true;
    return keys.every((key) => {
        if (!Object.prototype.hasOwnProperty.call(right, key)) return true;
        try {
            return JSON.stringify(left[key]) === JSON.stringify(right[key]);
        } catch {
            return left[key] === right[key];
        }
    });
}

export function outputsForSpec(
    spec: WorkspaceSpec,
    extracted: ExtractedToolOutput[]
): Record<string, WorkspaceWidgetOutput> {
    const bound: Record<string, WorkspaceWidgetOutput> = {};
    for (const component of spec.components) {
        const toolName = component.data?.tool;
        if (!toolName) continue;
        const params = component.data?.params ?? {};
        const candidates = extracted.filter((item) => item.toolName === toolName);
        if (!candidates.length) continue;
        const matched =
            [...candidates].reverse().find((item) => paramsOverlap(params, item.input) || paramsOverlap(item.input, params)) ??
            candidates[candidates.length - 1];
        const unwrapped = unwrapToolOutput(matched.output);
        bound[component.id] = {
            input: Object.keys(params).length ? params : matched.input,
            output: unwrapped,
            toolName
        };
    }
    return bound;
}

export function fingerprintOutputs(outputs: Record<string, WorkspaceWidgetOutput>): string {
    return stableParams(
        Object.fromEntries(
            Object.entries(outputs).map(([id, value]) => [id, { toolName: value.toolName, output: value.output }])
        )
    );
}
