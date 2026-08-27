import { NextResponse } from "next/server";

/**
 * Better Auth cookie names (plain + `__Secure-` variants, including chunked
 * session_data payloads). Clearing must use `path: "/"` so host-only cookies
 * set during sign-in are actually removed.
 */
const AUTH_COOKIE_BASES = [
    "ananta-market-stack.session_token",
    "ananta-market-stack.session_data",
    "ananta-market-stack-session_token",
    "ananta-market-stack-session_data"
] as const;

function cookieNamesToClear(requestCookieHeader: string | null): string[] {
    const names = new Set<string>();
    for (const base of AUTH_COOKIE_BASES) {
        names.add(base);
        names.add(`__Secure-${base}`);
    }
    if (!requestCookieHeader) {
        return Array.from(names);
    }
    for (const part of requestCookieHeader.split(";")) {
        const name = part.split("=")[0]?.trim();
        if (!name) continue;
        if (
            name.startsWith("ananta-market-stack.") ||
            name.startsWith("__Secure-ananta-market-stack.") ||
            name.startsWith("ananta-market-stack-") ||
            name.startsWith("__Secure-ananta-market-stack-")
        ) {
            names.add(name);
        }
    }
    return Array.from(names);
}

function expireCookie(response: NextResponse, name: string) {
    response.cookies.set({
        name,
        value: "",
        path: "/",
        maxAge: 0,
        expires: new Date(0),
        httpOnly: true,
        sameSite: "lax",
        secure: name.startsWith("__Secure-")
    });
}

export async function POST(request: Request) {
    const response = NextResponse.json({ ok: true });
    for (const name of cookieNamesToClear(request.headers.get("cookie"))) {
        expireCookie(response, name);
    }
    return response;
}
