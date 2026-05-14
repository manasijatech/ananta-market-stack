"use server";

import { alphaBaseUrl, getAlphaApiKey } from "@/service/actions/alpha/shared";

export async function getAlphaWebSocketConfig() {
 const apiKey = await getAlphaApiKey();
 const url = new URL(alphaBaseUrl());
 url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
 url.pathname = "/v1/ws";
 url.search = "";
 url.searchParams.set("api_key", apiKey);
 return { url: url.toString() };
}
