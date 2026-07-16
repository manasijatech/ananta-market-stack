import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/** Better Auth session cookie names (plain and secure variants). */
const SESSION_COOKIE_NAMES = [
    "ananta-market-stack.session_token",
    "__Secure-ananta-market-stack.session_token",
    "ananta-market-stack-session_token",
    "__Secure-ananta-market-stack-session_token"
] as const;

/** Routes that require a session cookie before the request reaches the app. */
const PROTECTED_PREFIXES = [
    "/dashboard",
    "/broker-connections",
    "/watchlists",
    "/market-intelligence",
    "/heatmap",
    "/broker-chat",
    "/alerts-workspace",
    "/settings",
    "/llm-usage",
    "/onboarding",
    "/docs",
    "/system-config",
    "/alert-channels"
] as const;

const AUTH_ROUTES = ["/auth/sign-in", "/auth/sign-up", "/auth/onboarding"] as const;

function hasSessionCookie(request: NextRequest): boolean {
    return SESSION_COOKIE_NAMES.some((name) => Boolean(request.cookies.get(name)?.value));
}

function isProtectedRoute(pathname: string): boolean {
    return PROTECTED_PREFIXES.some(
        (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
    );
}

function redirectTo(request: NextRequest, pathname: string): NextResponse {
    return NextResponse.redirect(new URL(pathname, request.url));
}

/**
 * Edge proxy for coarse session routing.
 *
 * RBAC-aware redirects (active vs pending) are handled in server components via requireActiveWorkspace.
 */
export function proxy(request: NextRequest): NextResponse {
    const { pathname } = request.nextUrl;
    const hasSession = hasSessionCookie(request);

    if (pathname === "/") {
        return redirectTo(request, hasSession ? "/broker-connections" : "/auth/sign-in");
    }

    if (!hasSession && isProtectedRoute(pathname)) {
        return redirectTo(request, "/auth/sign-in");
    }

    if (hasSession && pathname === "/pending-approval") {
        return NextResponse.next();
    }

    if (hasSession && AUTH_ROUTES.includes(pathname as (typeof AUTH_ROUTES)[number])) {
        // Let server pages call redirectIfAuthenticated() for RBAC-aware routing.
        return NextResponse.next();
    }

    return NextResponse.next();
}

export const config = {
    matcher: [
        "/",
        "/pending-approval",
        "/auth/sign-in",
        "/auth/sign-up",
        "/auth/onboarding",
        "/onboarding",
        "/dashboard/:path*",
        "/broker-connections/:path*",
        "/watchlists/:path*",
        "/market-intelligence/:path*",
        "/heatmap/:path*",
        "/broker-chat/:path*",
        "/alerts-workspace/:path*",
        "/settings/:path*",
        "/llm-usage/:path*",
        "/onboarding/:path*",
        "/docs/:path*",
        "/system-config/:path*",
        "/alert-channels/:path*"
    ]
};
