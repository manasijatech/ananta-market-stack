import "server-only";

import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getInternalApiBaseUrl } from "@/lib/runtime-config";

const apiBaseUrl = getInternalApiBaseUrl();

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

export async function fetchFastApi(path: string, init: RequestInit = {}): Promise<Response> {
    const authHeaders = await getAuthenticatedBackendHeaders();
    const headersFromInit = new Headers(init.headers);

    headersFromInit.forEach((value, key) => {
        authHeaders.set(key, value);
    });

    return fetch(`${apiBaseUrl}${path}`, {
        ...init,
        headers: authHeaders,
        cache: init.cache ?? "no-store"
    });
}

export async function fetchFastApiPublic(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`${apiBaseUrl}${path}`, {
        ...init,
        headers: init.headers,
        cache: init.cache ?? "no-store"
    });
}
