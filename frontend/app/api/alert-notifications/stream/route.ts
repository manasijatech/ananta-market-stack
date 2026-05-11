import { fetchFastApi } from "@/lib/fastapi";

export const runtime = "nodejs";

export async function GET() {
  const response = await fetchFastApi("/alert-notifications/stream", {
    headers: {
      accept: "text/event-stream"
    }
  });

  return new Response(response.body, {
    status: response.status,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive"
    }
  });
}
