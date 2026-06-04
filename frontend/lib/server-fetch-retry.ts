import { parseActionError } from "@/components/brokers/action-error";

function isRetryableError(error: unknown): boolean {
    const parsed = parseActionError(error);
    if (parsed.status && parsed.status >= 500) {
        return true;
    }
    const message = parsed.message || "";
    return /fetch failed|ECONNREFUSED|network|Failed to fetch|temporarily unavailable/i.test(message);
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

export async function withServerFetchRetry<T>(
    label: string,
    fn: () => Promise<T>,
    options?: { attempts?: number; baseDelayMs?: number }
): Promise<T> {
    const attempts = options?.attempts ?? 4;
    const baseDelayMs = options?.baseDelayMs ?? 600;
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            if (!isRetryableError(error) || attempt >= attempts) {
                throw error;
            }
            await delay(baseDelayMs * attempt);
        }
    }

    throw lastError ?? new Error(`${label} failed`);
}
