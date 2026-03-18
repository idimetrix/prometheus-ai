import { getAuthContext } from "@prometheus/auth";
import { db, projects, sessions } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { createRedisConnection } from "@prometheus/queue";
import { eq } from "drizzle-orm";
import { Hono } from "hono";

const logger = createLogger("api:sse");
const sseApp = new Hono();

/**
 * Supported SSE event types for agent session streaming.
 */
const VALID_EVENT_TYPES = new Set([
  "agent_output",
  "file_change",
  "plan_update",
  "task_status",
  "credit_update",
  "checkpoint",
  "error",
  "reasoning",
  "terminal_output",
  "browser_screenshot",
  "pr_created",
  "queue_position",
]);

/**
 * GET /sessions/:sessionId/stream
 *
 * SSE endpoint for streaming real-time agent session events.
 * Subscribes to Redis pub/sub channel `session:{id}:events` and
 * forwards events to the client as text/event-stream.
 *
 * Auth: Clerk JWT via Authorization header or `token` query param.
 * RLS: Verifies the authenticated user belongs to the org that owns the session.
 */
sseApp.get("/sessions/:sessionId/stream", async (c) => {
  const sessionId = c.req.param("sessionId");

  // --- Authentication ---
  const token = c.req.query("token") ?? c.req.header("authorization")?.slice(7);

  if (!token) {
    return c.json({ error: "Unauthorized: token required" }, 401);
  }

  const auth = await getAuthContext(token);
  if (!auth) {
    return c.json({ error: "Unauthorized: invalid token" }, 401);
  }

  if (!auth.orgId) {
    return c.json({ error: "Forbidden: organization context required" }, 403);
  }

  // --- RLS: verify user has access to this session's org ---
  const session = await db
    .select({
      id: sessions.id,
      projectId: sessions.projectId,
    })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1)
    .then((rows) => rows[0] ?? null);

  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }

  const project = await db
    .select({ orgId: projects.orgId })
    .from(projects)
    .where(eq(projects.id, session.projectId))
    .limit(1)
    .then((rows) => rows[0] ?? null);

  if (!project || project.orgId !== auth.orgId) {
    return c.json(
      { error: "Forbidden: session belongs to a different organization" },
      403
    );
  }

  logger.info(
    { sessionId, userId: auth.userId, orgId: auth.orgId },
    "SSE stream started"
  );

  // --- Redis subscriber (dedicated connection for SUBSCRIBE mode) ---
  const subscriber = createRedisConnection();
  const channel = `session:${sessionId}:events`;

  return c.newResponse(
    new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();

        const enqueue = (chunk: string) => {
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            // Stream already closed; cleanup will happen via abort handler
          }
        };

        // Send initial connection event
        enqueue(
          `event: connected\ndata: ${JSON.stringify({ sessionId, userId: auth.userId })}\n\n`
        );

        // Heartbeat every 15 seconds to keep connection alive
        const heartbeatInterval = setInterval(() => {
          enqueue(": heartbeat\n\n");
        }, 15_000);

        // Subscribe to session events
        subscriber.subscribe(channel, (err) => {
          if (err) {
            logger.error(
              { sessionId, error: err.message },
              "SSE Redis subscribe failed"
            );
            enqueue(
              `event: error\ndata: ${JSON.stringify({ message: "Failed to subscribe to session events" })}\n\n`
            );
          }
        });

        subscriber.on("message", (_ch: string, message: string) => {
          try {
            const event = JSON.parse(message) as {
              type?: string;
              data?: Record<string, unknown>;
              [key: string]: unknown;
            };

            const eventType = event.type ?? "message";

            // Only forward recognized event types (plus generic "message")
            if (eventType !== "message" && !VALID_EVENT_TYPES.has(eventType)) {
              logger.warn(
                { sessionId, eventType },
                "Unknown SSE event type received"
              );
            }

            const data = JSON.stringify(event.data ?? event);
            enqueue(`event: ${eventType}\ndata: ${data}\n\n`);
          } catch (error) {
            logger.error({ sessionId, error }, "SSE message parse error");
          }
        });

        // Cleanup on client disconnect
        c.req.raw.signal.addEventListener("abort", () => {
          clearInterval(heartbeatInterval);
          subscriber.unsubscribe(channel).catch(() => {
            /* cleanup */
          });
          subscriber.quit().catch(() => {
            /* cleanup */
          });
          try {
            controller.close();
          } catch {
            // Already closed
          }
          logger.info({ sessionId, userId: auth.userId }, "SSE stream closed");
        });
      },
    }),
    {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    }
  );
});

export { sseApp };
