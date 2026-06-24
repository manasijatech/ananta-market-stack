import { NextRequest } from "next/server";
import { getAuthenticatedBackendHeaders } from "@/lib/fastapi";
import { getInternalApiBaseUrl } from "@/lib/runtime-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
    params: Promise<{ path?: string[] }>;
};

const BODYLESS_METHODS = new Set(["GET", "HEAD"]);
const HOP_BY_HOP_HEADERS = new Set([
    "connection",
    "content-length",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade"
]);

function shouldForwardHeader(name: string): boolean {
    return !HOP_BY_HOP_HEADERS.has(name.toLowerCase());
}

async function proxyApiRequest(request: NextRequest, context: RouteContext): Promise<Response> {
    const { path = [] } = await context.params;
    const requestUrl = new URL(request.url);
    const targetUrl = new URL(`${getInternalApiBaseUrl()}/${path.map(encodeURIComponent).join("/")}`);
    targetUrl.search = requestUrl.search;

    const headers = await getAuthenticatedBackendHeaders();
    request.headers.forEach((value, key) => {
        if (shouldForwardHeader(key)) {
            headers.set(key, value);
        }
    });
    if (BODYLESS_METHODS.has(request.method) && !request.headers.has("content-type")) {
        headers.delete("content-type");
    }

    const upstream = await fetch(targetUrl, {
        method: request.method,
        headers,
        body: BODYLESS_METHODS.has(request.method) ? undefined : await request.arrayBuffer(),
        cache: "no-store",
        signal: request.signal
    });

    const responseHeaders = new Headers();
    upstream.headers.forEach((value, key) => {
        if (shouldForwardHeader(key)) {
            responseHeaders.set(key, value);
        }
    });

    return new Response(request.method === "HEAD" ? null : upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders
    });
}

export function GET(request: NextRequest, context: RouteContext): Promise<Response> {
    return proxyApiRequest(request, context);
}

export function HEAD(request: NextRequest, context: RouteContext): Promise<Response> {
    return proxyApiRequest(request, context);
}

export function OPTIONS(request: NextRequest, context: RouteContext): Promise<Response> {
    return proxyApiRequest(request, context);
}

export function POST(request: NextRequest, context: RouteContext): Promise<Response> {
    return proxyApiRequest(request, context);
}

export function PUT(request: NextRequest, context: RouteContext): Promise<Response> {
    return proxyApiRequest(request, context);
}

export function PATCH(request: NextRequest, context: RouteContext): Promise<Response> {
    return proxyApiRequest(request, context);
}

export function DELETE(request: NextRequest, context: RouteContext): Promise<Response> {
    return proxyApiRequest(request, context);
}
