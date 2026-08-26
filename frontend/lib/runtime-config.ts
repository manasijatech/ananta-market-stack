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
