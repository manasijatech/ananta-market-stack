"use client";

function withTrailingSlash(value: string): string {
    return value.endsWith("/") ? value : `${value}/`;
}

function websocketUrl(apiRoot: string, userId: string): string | null {
    try {
        const url = new URL("live-streams/prices/ws", withTrailingSlash(apiRoot));
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        url.searchParams.set("user_id", userId);
        url.searchParams.set("scope", "client");
        return url.toString();
    } catch {
        return null;
    }
}

/**
 * Browser websocket candidates for the live price stream.
 *
 * Same-origin `/api/v1` is first so production nginx (which upgrades websockets)
 * keeps working. Local next-dev / standalone on :3004 cannot upgrade, so the
 * absolute `NEXT_PUBLIC_API_BASE_URL` backend is tried next.
 */
export function livePriceWebSocketCandidates(userId: string): string[] {
    const seen = new Set<string>();
    const urls: string[] = [];

    function add(apiRoot: string) {
        const next = websocketUrl(apiRoot, userId);
        if (!next || seen.has(next)) return;
        seen.add(next);
        urls.push(next);
    }

    add(`${window.location.origin}/api/v1`);
    const publicApi = (process.env.NEXT_PUBLIC_API_BASE_URL || "").trim();
    if (/^https?:\/\//i.test(publicApi)) {
        add(publicApi.replace(/\/+$/, ""));
    }
    return urls;
}
