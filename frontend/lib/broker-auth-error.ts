export function isBrokerAuthFailure(message: string, status?: number): boolean {
    if (status === 401 || status === 403) return true;
    const blob = message.toLowerCase();
    return (
        /\b401\b/.test(blob) ||
        /\b403\b/.test(blob) ||
        blob.includes("unauthorized") ||
        blob.includes("token expired") ||
        blob.includes("invalid token") ||
        blob.includes("access token") ||
        blob.includes("subscription expired") ||
        blob.includes("not subscribed") ||
        blob.includes("forbidden")
    );
}

export function brokerReconnectCopy(raw: string): string {
    const trimmed = raw.replace(/^(dhan|groww|upstox|zerodha|angel|kotak|indmoney|arrow)\s+api error:\s*/i, "").trim();
    return trimmed
        ? `${trimmed} Reconnect or renew this broker from Broker connections — retrying will not restore live data.`
        : "This broker is connected but live data is unavailable (expired key, unpaid plan, or revoked session). Reconnect or renew it from Broker connections.";
}
