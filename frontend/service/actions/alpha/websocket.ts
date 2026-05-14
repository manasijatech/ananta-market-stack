"use server";

import { getAuthenticatedBackendHeaders } from "@/lib/fastapi";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000/api/v1";

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
