export function getPublicAppUrl(): string {
    return (
        process.env.NEXT_PUBLIC_APP_URL ??
        process.env.MARKET_STACK_PUBLIC_APP_URL ??
        "http://localhost:3000"
    ).replace(/\/+$/, "");
}

export function getPublicApiBaseUrl(): string {
    return (
        process.env.NEXT_PUBLIC_API_BASE_URL ??
        process.env.MARKET_STACK_API_BASE_URL ??
        process.env.MARKET_STACK_PUBLIC_API_BASE_URL ??
        "http://127.0.0.1:8000/api/v1"
    ).replace(/\/+$/, "");
}

/**
 * Builds a browser-reachable WebSocket URL under the public API prefix.
 *
 * Native development serves Next.js and FastAPI on different ports, so a
 * same-origin `/api/v1` socket would hit Next.js, whose route handler only
 * proxies HTTP. Deployments can set NEXT_PUBLIC_WS_BASE_URL when their public
 * WebSocket endpoint differs from NEXT_PUBLIC_API_BASE_URL.
 */
export function getPublicApiWebSocketUrl(path: string): URL {
    const browserOrigin = typeof window === "undefined" ? getPublicAppUrl() : window.location.origin;
    const configuredBase = process.env.NEXT_PUBLIC_WS_BASE_URL ?? getPublicApiBaseUrl();
    const url = new URL(configuredBase, browserOrigin);
    url.protocol = url.protocol === "https:" || url.protocol === "wss:" ? "wss:" : "ws:";
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
    url.search = "";
    url.hash = "";
    return url;
}

export function getInternalApiBaseUrl(): string {
    const configured = (
        process.env.MARKET_STACK_API_INTERNAL_URL ??
        process.env.MARKET_STACK_API_BASE_URL ??
        process.env.NEXT_PUBLIC_API_BASE_URL ??
        process.env.MARKET_STACK_PUBLIC_API_BASE_URL ??
        "http://127.0.0.1:8000/api/v1"
    ).replace(/\/+$/, "");
    try {
        const url = new URL(configured);
        if (url.hostname === "localhost" || url.hostname === "127.0.1.1") {
            url.hostname = "127.0.0.1";
            return url.toString().replace(/\/+$/, "");
        }
    } catch {
        return configured;
    }
    return configured;
}
