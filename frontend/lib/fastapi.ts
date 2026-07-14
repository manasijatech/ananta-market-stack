import "server-only";

import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getInternalApiBaseUrl, getPublicApiBaseUrl } from "@/lib/runtime-config";

const apiBaseUrl = getInternalApiBaseUrl();
const fallbackApiBaseUrl = getPublicApiBaseUrl();

function absoluteFallbackApiBaseUrl(): string | null {
    if (fallbackApiBaseUrl === apiBaseUrl) {
        return null;
    }

    try {
        const url = new URL(fallbackApiBaseUrl);
        return url.protocol === "http:" || url.protocol === "https:" ? fallbackApiBaseUrl : null;
    } catch {
        return null;
    }
}

async function fetchBackend(path: string, init: RequestInit): Promise<Response> {
    try {
        return await fetch(`${apiBaseUrl}${path}`, init);
    } catch (error) {
        const fallback = absoluteFallbackApiBaseUrl();
        if (!(error instanceof TypeError) || init.signal?.aborted || !fallback) {
            throw error;
        }
        return fetch(`${fallback}${path}`, init);
    }
}

/**
 * Builds headers for authenticated FastAPI requests.
 *
 * Forwards `X-User-Id`, `X-User-Email`, and `X-Market-Stack-Session` when a session exists.
 */
export async function getAuthenticatedBackendHeaders(): Promise<Headers> {
    const session = await auth.api.getSession({
        headers: await headers()
    });

    const requestHeaders = new Headers();
    requestHeaders.set("content-type", "application/json");

    if (session?.user) {
        requestHeaders.set("X-User-Id", session.user.id);
        requestHeaders.set("X-User-Email", session.user.email);
    }

    if (session?.session?.token) {
        requestHeaders.set("X-Market-Stack-Session", session.session.token);
    }

    return requestHeaders;
}

/**
 * Proxies a request to the internal FastAPI backend with session headers attached.
 *
 * @param path - API path (e.g. `/rbac/me`).
 */
export async function fetchFastApi(path: string, init: RequestInit = {}): Promise<Response> {
    const authHeaders = await getAuthenticatedBackendHeaders();
    const headersFromInit = new Headers(init.headers);

    headersFromInit.forEach((value, key) => {
        authHeaders.set(key, value);
    });

    return fetchBackend(path, {
        ...init,
        headers: authHeaders,
        cache: init.cache ?? "no-store"
    });
}

export async function fetchFastApiPublic(path: string, init: RequestInit = {}): Promise<Response> {
    return fetchBackend(path, {
        ...init,
        headers: init.headers,
        cache: init.cache ?? "no-store"
    });
}
