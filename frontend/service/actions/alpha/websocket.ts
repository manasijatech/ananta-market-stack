"use server";

import { getAuthenticatedBackendHeaders } from "@/lib/fastapi";
import { getPublicApiBaseUrl } from "@/lib/runtime-config";

const apiBaseUrl = getPublicApiBaseUrl();

export async function getAlphaWebSocketConfig(products: string[] = []) {
    const headers = await getAuthenticatedBackendHeaders();
    const userId = headers.get("X-User-Id") || "local-dev-user";
    const url = new URL(apiBaseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/alpha/ws`;
    url.search = "";
    url.searchParams.set("user_id", userId);
    if (products.length) url.searchParams.set("products", products.join(","));
    return { url: url.toString() };
}
