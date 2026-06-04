import { parseActionError } from "@/components/brokers/action-error";

export function formatUserFacingError(error: unknown, fallback = "Could not load this data right now."): string {
    const parsed = parseActionError(error);
    const message = parsed.message || fallback;

    if (parsed.status && parsed.status >= 500) {
        return "Services are still starting or temporarily unavailable. Refresh in a moment.";
    }

    if (/fetch failed|ECONNREFUSED|network|Failed to fetch/i.test(message)) {
        return "Could not reach the backend API yet. Wait a few seconds and refresh.";
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
