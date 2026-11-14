import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { subscribeEvents } from "@/lib/events";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = requireAuth(req, { requireCsrf: false });
  if ("error" in auth) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // Stream closed
        }
      };

      send(`event: connected\ndata: ${JSON.stringify({ ok: true, timestamp: Date.now() })}\n\n`);

      const unsubscribe = subscribeEvents((event) => {
        send(`event: workspace\ndata: ${JSON.stringify(event)}\n\n`);
      });

      const heartbeat = setInterval(() => {
        send(`: ping ${Date.now()}\n\n`);
      }, 25_000);

      cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
      };

      req.signal.addEventListener("abort", () => {
        cleanup?.();
        try {
          controller.close();
        } catch {
          // Already closed
        }
      });
    },
    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
