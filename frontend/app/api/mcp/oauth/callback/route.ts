import { NextResponse, type NextRequest } from "next/server";
import { fetchFastApi } from "@/lib/fastapi";
import { getPublicAppUrl } from "@/lib/runtime-config";

async function parseResponse(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) {
        return null;
    }
    try {
        return JSON.parse(text) as unknown;
    } catch {
        return { detail: text };
    }
}

function errorMessage(payload: unknown, fallback: string): string {
    if (payload && typeof payload === "object" && "detail" in payload && typeof payload.detail === "string") {
        return payload.detail;
    }
    return fallback;
}

function redirectOrigin(request: NextRequest, callbackUrl: URL): string {
    const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    const host = forwardedHost ?? request.headers.get("host") ?? "";
    const forwardedProto =
        request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? callbackUrl.protocol.replace(":", "");

    if (host) {
        const origin = new URL(`${forwardedProto}://${host}`);
        if (origin.hostname === "0.0.0.0" || origin.hostname === "::") {
            origin.hostname = "localhost";
        }
        if (!origin.port && callbackUrl.port) {
            origin.port = callbackUrl.port;
        }
        return origin.origin;
    }

    if (callbackUrl.hostname === "0.0.0.0" || callbackUrl.hostname === "::") {
        callbackUrl.hostname = "localhost";
        return callbackUrl.origin;
    }

    return getPublicAppUrl();
}

function settingsRedirectUrl(request: NextRequest, callbackUrl: URL): URL {
    const redirectUrl = new URL("/settings", redirectOrigin(request, callbackUrl));
    redirectUrl.hash = "mcp";
    return redirectUrl;
}

export async function GET(request: NextRequest) {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const oauthError = url.searchParams.get("error");
    const redirectUrl = settingsRedirectUrl(request, url);

    if (oauthError) {
        redirectUrl.searchParams.set("mcp_auth", "error");
        redirectUrl.searchParams.set("message", oauthError);
        return NextResponse.redirect(redirectUrl);
    }

    if (!code || !state) {
        redirectUrl.searchParams.set("mcp_auth", "error");
        redirectUrl.searchParams.set("message", "The MCP authorization server did not return code and state.");
        return NextResponse.redirect(redirectUrl);
    }

    const response = await fetchFastApi("/system-config/mcp/oauth/complete", {
        method: "POST",
        body: JSON.stringify({ code, state })
    });
    const payload = await parseResponse(response);

    if (!response.ok) {
        redirectUrl.searchParams.set("mcp_auth", "error");
        redirectUrl.searchParams.set("message", errorMessage(payload, "Could not complete MCP authentication."));
        return NextResponse.redirect(redirectUrl);
    }

    redirectUrl.searchParams.set("mcp_auth", "success");
    return NextResponse.redirect(redirectUrl);
}
