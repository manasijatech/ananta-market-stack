export function isTransientChatStreamError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error || "");
    const name = error instanceof Error ? error.name : "";
    if (name === "AbortError") {
        return true;
    }
    return /failed to fetch|networkerror|load failed|fetch failed|econnrefused|econnreset|socket hang up|temporarily unavailable/i.test(
        message
    );
}
