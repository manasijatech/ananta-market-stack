import { NextRequest, NextResponse } from "next/server";
import { getDevPasswordResetLink, devResetLinksEnabled } from "@/lib/dev-password-reset-links";

export async function GET(request: NextRequest) {
    if (!devResetLinksEnabled()) {
        return NextResponse.json({ enabled: false, url: null }, { status: 404 });
    }

    const email = request.nextUrl.searchParams.get("email") ?? "";
    const url = email ? getDevPasswordResetLink(email) : null;

    return NextResponse.json(
        { enabled: true, url },
        {
            headers: {
                "Cache-Control": "no-store"
            }
        }
    );
}
