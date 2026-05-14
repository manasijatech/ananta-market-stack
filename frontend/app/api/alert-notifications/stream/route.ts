import { fetchFastApi } from "@/lib/fastapi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const response = await fetchFastApi("/alert-notifications/stream", {
    signal: request.signal,
    headers: {
      accept: "text/event-stream"
    }
  });

  if (!response.body) {
    return new Response(null, {
      status: response.status,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no"
      }
    });
  }

  const reader = response.body.getReader();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch {
        controller.close();
      }
    },
    async cancel() {
      try {
        await reader.cancel();
      } catch {
        return;
      }
    }
  });

  return new Response(stream, {
    status: response.status,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no"
    }
  });
}
