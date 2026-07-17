import { NextResponse } from "next/server";

export const dynamic = "force-static";

export function GET() {
    return NextResponse.json(
        { status: "ok" },
        {
            headers: {
                "cache-control": "no-store"
            }
        }
    );
}
