import type { FieldErrors } from "@/service/types/broker";

export type ParsedActionError = {
    message: string;
    fieldErrors: FieldErrors;
    status?: number;
};

export function parseActionError(error: unknown): ParsedActionError {
    const fallback = error instanceof Error ? error.message : "Something went wrong.";
    if (!(error instanceof Error)) {
        return { message: fallback, fieldErrors: {} };
    }

    try {
        const parsed = JSON.parse(error.message) as unknown;
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            return { message: fallback, fieldErrors: {} };
        }
        const record = parsed as Record<string, unknown>;
        const fieldErrors =
            typeof record.fieldErrors === "object" && record.fieldErrors !== null
                ? Object.fromEntries(
                      Object.entries(record.fieldErrors as Record<string, unknown>).filter(
                          (entry): entry is [string, string] => typeof entry[1] === "string"
                      )
                  )
                : {};
        const message = typeof record.message === "string" ? record.message : fallback;
        if (message.trim().startsWith("{")) {
            const nested = parseActionError(new Error(message));
            return {
                message: nested.message || message,
                fieldErrors: Object.keys(nested.fieldErrors).length ? nested.fieldErrors : fieldErrors,
                status: nested.status ?? (typeof record.status === "number" ? record.status : undefined)
            };
        }
        return {
            message,
            fieldErrors,
            status: typeof record.status === "number" ? record.status : undefined
        };
    } catch {
        return { message: fallback, fieldErrors: {} };
    }
}
