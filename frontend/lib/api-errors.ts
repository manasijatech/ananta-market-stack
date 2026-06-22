import { parseActionError } from "@/components/brokers/action-error";

export function isHttpStatus(error: unknown, status: number): boolean {
    return parseActionError(error).status === status;
}

export function isPermissionDeniedError(error: unknown): boolean {
    const parsed = parseActionError(error);
    if (parsed.status === 403) {
        return true;
    }
    return /insufficient permissions|pending admin approval|forbidden|not allowed/i.test(parsed.message);
}

export function isMissingOrInaccessibleError(error: unknown): boolean {
    const parsed = parseActionError(error);
    if (parsed.status === 404) {
        return true;
    }
    return /not found|broker account not found/i.test(parsed.message);
}

export function formatUserFacingError(error: unknown, fallback = "Could not load this data right now."): string {
    const parsed = parseActionError(error);
    const message = parsed.message || fallback;

    if (parsed.status && parsed.status >= 500) {
        return "Services are still starting or temporarily unavailable. Refresh in a moment.";
    }

    if (/fetch failed|ECONNREFUSED|network|Failed to fetch/i.test(message)) {
        return "Could not reach the backend API yet. Wait a few seconds and refresh.";
    }

    if (parsed.status === 403) {
        return "You do not have permission to open this view yet.";
    }

    return message;
}

export function formatStoredLoadError(error: string | undefined, fallback = "Could not load this API."): string {
    if (!error) {
        return fallback;
    }

    try {
        return formatUserFacingError(new Error(error), fallback);
    } catch {
        return error;
    }
}
