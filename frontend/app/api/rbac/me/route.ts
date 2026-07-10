import { fetchFastApi } from "@/lib/fastapi";

export async function GET(): Promise<Response> {
    const response = await fetchFastApi("/rbac/me");
    const body = await response.text();
    return new Response(body, {
        status: response.status,
        headers: {
            "content-type": response.headers.get("content-type") ?? "application/json"
        }
    });
}
