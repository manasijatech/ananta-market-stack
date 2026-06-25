export const ALPHA_CREDIT_WARNING_EVENT = "ananta-market-stack:alpha-credit-warning";

export const DEFAULT_ALPHA_CREDIT_WARNING_MESSAGE =
    "Insufficient Drishti API credits. Add credits or update the Drishti API key before using market intelligence data.";

type ParsedError = {
    message?: string;
    status?: number;
};

function parseErrorPayload(value: unknown): ParsedError | null {
    if (value instanceof Error) {
        return parseErrorPayload(value.message) ?? { message: value.message };
    }

    if (typeof value === "string") {
        try {
            return parseErrorPayload(JSON.parse(value) as unknown) ?? { message: value };
        } catch {
            return { message: value };
        }
    }

    if (typeof value !== "object" || value === null) return null;

    const record = value as Record<string, unknown>;

    if (record.status === "rejected" && "reason" in record) {
        return parseErrorPayload(record.reason);
    }

    const detail = parseErrorPayload(record.detail);
    const error = parseErrorPayload(record.error);

    return {
        message:
            typeof record.message === "string"
                ? record.message
                : detail?.message ?? error?.message ?? (typeof record.reason === "string" ? record.reason : undefined),
        status:
            typeof record.status === "number"
                ? record.status
                : typeof record.statusCode === "number"
                  ? record.statusCode
                  : detail?.status ?? error?.status
    };
}

export function getAlphaCreditWarningMessage(...values: unknown[]): string | null {
    for (const value of values) {
        const parsed = parseErrorPayload(value);
        if (!parsed) continue;
        const message = parsed.message ?? "";
        if (parsed.status === 402 || /insufficient\s+credits/i.test(message)) {
            return message || DEFAULT_ALPHA_CREDIT_WARNING_MESSAGE;
        }
    }
    return null;
}

export function notifyAlphaCreditWarning(...values: unknown[]) {
    if (typeof window === "undefined") return;
    const message = values.length ? getAlphaCreditWarningMessage(...values) : DEFAULT_ALPHA_CREDIT_WARNING_MESSAGE;
    if (!message) return;
    window.dispatchEvent(new CustomEvent(ALPHA_CREDIT_WARNING_EVENT, { detail: { message } }));
}
