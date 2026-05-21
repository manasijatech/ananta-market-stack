export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const forwardedHeaders = [
    "accept-ranges",
    "content-length",
    "content-range",
    "content-type",
    "etag",
    "last-modified"
];

export async function GET(request: Request) {
    const requestUrl = new URL(request.url);
    const rawSource = requestUrl.searchParams.get("src");

    if (!rawSource) {
        return new Response("Missing audio source", { status: 400 });
    }

    let sourceUrl: URL;
    try {
        sourceUrl = new URL(rawSource);
    } catch {
        return new Response("Invalid audio source", { status: 400 });
    }

    if (!["http:", "https:"].includes(sourceUrl.protocol)) {
        return new Response("Unsupported audio source", { status: 400 });
    }

    const range = request.headers.get("range");
    const upstream = await fetch(sourceUrl, {
        headers: range ? { range } : undefined,
        signal: request.signal
    });

    const headers = new Headers();
    for (const header of forwardedHeaders) {
        const value = upstream.headers.get(header);
        if (value) headers.set(header, value);
    }
    headers.set("cache-control", "private, max-age=300");

    return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers
    });
}
