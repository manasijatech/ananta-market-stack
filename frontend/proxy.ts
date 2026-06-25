import { NextRequest, NextResponse } from "next/server";

function redirectTo(request: NextRequest, pathname: string) {
    return NextResponse.redirect(new URL(pathname, request.url));
}

export function proxy(request: NextRequest) {
    const pathname = request.nextUrl.pathname;

    if (pathname === "/") {
        return redirectTo(request, "/auth/sign-in");
    }

    return NextResponse.next();
}

export const config = {
    matcher: ["/", "/auth/sign-in", "/auth/sign-up"]
};
