import type { WorkspaceAccountMeta, WorkspaceProvenance } from "@/service/types/adaptive-workspace";

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function unwrapToolOutput(output: unknown): unknown {
    if (!output) {
        return output;
    }
    if (Array.isArray(output)) {
        const textParts = output
            .filter((block): block is { text: string; type: string } => isRecord(block) && typeof block.text === "string")
            .map((block) => block.text);
        if (textParts.length) {
            const combined = textParts.join("");
            try {
                return JSON.parse(combined) as unknown;
            } catch {
                return combined;
            }
        }
        return output;
    }
    if (isRecord(output) && output.type === "text" && typeof output.text === "string") {
        try {
            return JSON.parse(output.text) as unknown;
        } catch {
            return output.text;
        }
    }
    if (typeof output === "string") {
        try {
            return JSON.parse(output) as unknown;
        } catch {
            return output;
        }
    }
    return output;
}

export function asToolEnvelope(output: unknown): Record<string, unknown> | null {
    const unwrapped = unwrapToolOutput(output);
    return isRecord(unwrapped) ? unwrapped : null;
}

export function toolEnvelopeOk(envelope: Record<string, unknown> | null): boolean {
    return Boolean(envelope && envelope.ok === true);
}

export function toolEnvelopeMessage(envelope: Record<string, unknown> | null, fallback = "This broker tool did not return data."): string {
    if (!envelope) {
        return fallback;
    }
    if (typeof envelope.message === "string" && envelope.message.trim()) {
        return envelope.message;
    }
    if (typeof envelope.code === "string" && envelope.code.trim()) {
        return envelope.code;
    }
    return fallback;
}

export function toolAccountMeta(envelope: Record<string, unknown> | null): WorkspaceAccountMeta | null {
    const account = envelope && isRecord(envelope.account) ? envelope.account : null;
    if (!account) {
        return null;
    }
    return {
        account_id: typeof account.account_id === "string" ? account.account_id : null,
        broker_code: typeof account.broker_code === "string" ? account.broker_code : null,
        label: typeof account.label === "string" ? account.label : null
    };
}

export function numberFrom(source: Record<string, unknown>, keys: string[]): number | null {
    for (const key of keys) {
        const value = source[key];
        if (typeof value === "number" && Number.isFinite(value)) {
            return value;
        }
        if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
            return Number(value);
        }
    }
    return null;
}

export function stringFrom(source: Record<string, unknown>, keys: string[], fallback = ""): string {
    for (const key of keys) {
        const value = source[key];
        if (typeof value === "string" && value.trim()) {
            return value;
        }
        if (typeof value === "number" && Number.isFinite(value)) {
            return String(value);
        }
    }
    return fallback;
}

export function provenanceFromEnvelope(
    envelope: Record<string, unknown> | null,
    toolName: string,
    source: WorkspaceProvenance["source"] = "live"
): WorkspaceProvenance {
    return {
        account: toolAccountMeta(envelope),
        asOf: new Date().toISOString(),
        freshnessLabel: source === "cached" ? "Cached snapshot" : "Live broker data",
        source,
        toolName
    };
}
