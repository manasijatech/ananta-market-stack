import { NextRequest, NextResponse } from "next/server";

const sessionCookieNames = [
    "ananta-market-stack.session_token",
    "__Secure-ananta-market-stack.session_token",
    "ananta-market-stack-session_token",
    "__Secure-ananta-market-stack-session_token"
];

function hasSessionCookie(request: NextRequest) {
    return sessionCookieNames.some((name) => Boolean(request.cookies.get(name)?.value));
}

function redirectTo(request: NextRequest, pathname: string) {
    return NextResponse.redirect(new URL(pathname, request.url));
}

export function proxy(request: NextRequest) {
    const pathname = request.nextUrl.pathname;
    const hasSession = hasSessionCookie(request);

    if (pathname === "/") {
        return redirectTo(request, hasSession ? "/dashboard" : "/auth/sign-in");
    }

    if (hasSession && (pathname === "/auth/sign-in" || pathname === "/auth/sign-up")) {
        return redirectTo(request, "/dashboard");
    }

    return NextResponse.next();
}

export const config = {
    matcher: ["/", "/auth/sign-in", "/auth/sign-up"]
};
