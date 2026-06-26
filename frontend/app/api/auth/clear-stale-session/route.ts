import { NextResponse } from "next/server";

const sessionCookieNames = [
    "ananta-market-stack.session_token",
    "__Secure-ananta-market-stack.session_token",
    "ananta-market-stack-session_token",
    "__Secure-ananta-market-stack-session_token"
];

export async function POST() {
    const response = NextResponse.json({ ok: true });
    for (const name of sessionCookieNames) {
        response.cookies.delete(name);
    }
    return response;
}
