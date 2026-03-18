import { Hono } from "hono";
import { createLogger } from "@prometheus/logger";
import { createRedisConnection } from "@prometheus/queue";
import { getAuthContext } from "@prometheus/auth";

const logger = createLogger("api:sse");
const sseApp = new Hono();

// SSE endpoint for streaming agent session output
sseApp.get("/sessions/:sessionId/stream", async (c) => {
  const sessionId = c.req.param("sessionId");

  // Verify auth (token can be passed via query param for SSE)
  const token = c.req.query("token") ?? c.req.header("authorization")?.slice(7);
  if (token) {
    const auth = await getAuthContext(token);
    if (!auth) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    logger.info({ sessionId, userId: auth.userId }, "SSE stream started (authenticated)");
  } else {
    logger.info({ sessionId }, "SSE stream started (unauthenticated)");
  }

  const subscriber = createRedisConnection();
  const channel = `session:${sessionId}:events`;

  return c.newResponse(
    new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();

        // Send initial connection event
        controller.enqueue(
          encoder.encode(`event: connected\ndata: ${JSON.stringify({ sessionId })}\n\n`)
        );

        // Heartbeat every 15 seconds
        const heartbeatInterval = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(`: heartbeat\n\n`));
          } catch {
            clearInterval(heartbeatInterval);
          }
        }, 15000);

        // Subscribe to session events
        subscriber.subscribe(channel, (err) => {
          if (err) {
            logger.error({ sessionId, error: err.message }, "SSE Redis subscribe failed");
          }
        });

        subscriber.on("message", (_ch: string, message: string) => {
          try {
            const event = JSON.parse(message);
            const eventType = event.type ?? "message";
            const data = JSON.stringify(event.data ?? event);
            controller.enqueue(
              encoder.encode(`event: ${eventType}\ndata: ${data}\n\n`)
            );
          } catch (error) {
            logger.error({ sessionId, error }, "SSE parse error");
          }
        });

        // Cleanup on close
        c.req.raw.signal.addEventListener("abort", () => {
          clearInterval(heartbeatInterval);
          subscriber.unsubscribe(channel);
          subscriber.quit();
          controller.close();
          logger.info({ sessionId }, "SSE stream closed");
        });
      },
    }),
    {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      },
    }
  );
});

export { sseApp };
