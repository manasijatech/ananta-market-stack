import { NextRequest, NextResponse } from "next/server";
import { getInternalApiBaseUrl } from "@/lib/runtime-config";

export async function POST(request: NextRequest) {
    let payload: unknown;

    try {
        payload = await request.json();
    } catch {
        return NextResponse.json({ ok: false, message: "Invalid JSON payload." }, { status: 400 });
    }

    const response = await fetch(`${getInternalApiBaseUrl()}/broker-accounts/sessions/upstox/notifier`, {
        method: "POST",
        headers: {
            "content-type": "application/json"
        },
        body: JSON.stringify(payload),
        cache: "no-store"
    });

    const text = await response.text();
    const contentType = response.headers.get("content-type") || "application/json";

    return new NextResponse(text, {
        status: response.status,
        headers: {
            "content-type": contentType
        }
    });
}
