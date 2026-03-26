import { getAuthContext } from "@prometheus/auth";
import { db, projects, sessions } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import {
  createRedisConnection,
  EventPublisher,
  EventStream,
} from "@prometheus/queue";
import { eq } from "drizzle-orm";
import { Hono } from "hono";

const logger = createLogger("api:sse");
const sseApp = new Hono();
const publisher = new EventPublisher();

/**
 * Supported SSE event types for agent session streaming.
 */
const VALID_EVENT_TYPES = new Set([
  "agent_output",
  "agent_status",
  "file_change",
  "file_diff",
  "code_change",
  "plan_update",
  "plan_step_update",
  "task_status",
  "task_progress",
  "credit_update",
  "checkpoint",
  "error",
  "reasoning",
  "terminal_output",
  "session_complete",
  "session_resume",
  "browser_screenshot",
  "pr_created",
  "queue_position",
  "tool_call",
  "tool_result",
  // Canonical agent streaming events (GAP-P0-08)
  "agent:thinking",
  "agent:terminal",
  "agent:file-change",
  "agent:progress",
  "task:complete",
  "task:created",
  "session:checkpoint",
  "session:error",
  "human_input_request",
  "human_input_resolved",
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
  const authHeader = c.req.header("authorization");
  const token =
    c.req.query("token") ??
    (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined);

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
  // Support Last-Event-ID header (standard SSE reconnection) and query param
  const lastEventId =
    c.req.header("last-event-id") ?? c.req.query("lastEventId");

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

        // Replay missed events from Redis Streams if lastEventId is provided
        if (lastEventId) {
          const eventStream = new EventStream();
          eventStream
            .readAfter(sessionId, lastEventId)
            .then((missedEvents) => {
              logger.info(
                { sessionId, lastEventId, replayed: missedEvents.length },
                "Replaying missed SSE events"
              );
              for (const missed of missedEvents) {
                const eventType = missed.type ?? "message";
                const data = JSON.stringify(missed.data ?? missed);
                // Use sequence as the SSE event ID so clients can resume
                // from the same cursor on subsequent reconnections.
                const seqId = missed.sequence
                  ? String(missed.sequence)
                  : (missed.id ?? "");
                const idField = seqId ? `id: ${seqId}\n` : "";
                enqueue(`${idField}event: ${eventType}\ndata: ${data}\n\n`);
              }
            })
            .catch((err: unknown) => {
              const msg = err instanceof Error ? err.message : String(err);
              logger.error(
                { sessionId, lastEventId, error: msg },
                "Failed to replay missed events"
              );
            });
        }

        // Heartbeat every 15 seconds to keep connection alive.
        // Sent as a named event so the client EventSource can listen via
        // addEventListener("heartbeat", ...) for timeout detection.
        const heartbeatInterval = setInterval(() => {
          enqueue(
            `event: heartbeat\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`
          );
        }, 15_000);

        // Subscribe to session events for live updates
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

        // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: SSE event routing requires handling many event types
        subscriber.on("message", (_ch: string, message: string) => {
          try {
            const event = JSON.parse(message) as {
              type?: string;
              data?: Record<string, unknown>;
              id?: string;
              sequence?: number;
              agentRole?: string;
              [key: string]: unknown;
            };

            const eventType = event.type ?? "message";
            const eventData = event.data ?? event;
            const seqId = event.sequence
              ? String(event.sequence)
              : (event.id ?? "");
            const idField = seqId ? `id: ${seqId}\n` : "";

            // Only forward recognized event types (plus generic "message")
            if (eventType !== "message" && !VALID_EVENT_TYPES.has(eventType)) {
              logger.warn(
                { sessionId, eventType },
                "Unknown SSE event type received"
              );
            }

            const data = JSON.stringify(eventData);

            // Emit the raw event
            enqueue(`${idField}event: ${eventType}\ndata: ${data}\n\n`);

            // Also emit canonical agent streaming events for new UI consumers
            switch (eventType) {
              case "agent_output": {
                if (
                  typeof eventData === "object" &&
                  eventData !== null &&
                  (eventData as Record<string, unknown>).streaming
                ) {
                  enqueue(`${idField}event: agent:thinking\ndata: ${data}\n\n`);
                }
                break;
              }
              case "terminal_output":
                enqueue(`${idField}event: agent:terminal\ndata: ${data}\n\n`);
                break;
              case "file_change":
                enqueue(
                  `${idField}event: agent:file-change\ndata: ${data}\n\n`
                );
                break;
              case "session_complete":
                enqueue(`${idField}event: task:complete\ndata: ${data}\n\n`);
                break;
              case "checkpoint":
                enqueue(
                  `${idField}event: session:checkpoint\ndata: ${data}\n\n`
                );
                break;
              case "error":
                enqueue(`${idField}event: session:error\ndata: ${data}\n\n`);
                break;
              default:
                break;
            }
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

/**
 * POST /sessions/:sessionId/events
 *
 * Internal endpoint for other services (orchestrator, queue-worker, sandbox)
 * to publish events to a session's SSE stream via Redis pub/sub.
 *
 * Expects JSON body: { type: string, data: Record<string, unknown> }
 *
 * No user auth — protected by network-level access (internal service mesh).
 * Include X-Internal-Secret header in production for service-to-service auth.
 */
sseApp.post("/sessions/:sessionId/events", async (c) => {
  const sessionId = c.req.param("sessionId");

  // Lightweight service-to-service auth via shared secret
  const internalSecret = process.env.INTERNAL_SERVICE_SECRET;
  if (internalSecret) {
    const provided = c.req.header("x-internal-secret");
    if (provided !== internalSecret) {
      return c.json({ error: "Forbidden" }, 403);
    }
  }

  try {
    const body = (await c.req.json()) as {
      type?: string;
      data?: Record<string, unknown>;
    };

    if (!body.type) {
      return c.json({ error: "Missing 'type' field" }, 400);
    }

    if (!VALID_EVENT_TYPES.has(body.type)) {
      logger.warn(
        { sessionId, type: body.type },
        "Publishing unrecognized event type"
      );
    }

    await publisher.publishSessionEvent(sessionId, {
      type: body.type,
      data: body.data ?? {},
      timestamp: new Date().toISOString(),
    });

    return c.json({ ok: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ sessionId, error: msg }, "Failed to publish SSE event");
    return c.json({ error: "Internal server error" }, 500);
  }
});

/**
 * POST /sessions/:sessionId/events/batch
 *
 * Batch publish multiple events in a single request.
 * Useful for replaying file changes or plan updates.
 */
sseApp.post("/sessions/:sessionId/events/batch", async (c) => {
  const sessionId = c.req.param("sessionId");

  const internalSecret = process.env.INTERNAL_SERVICE_SECRET;
  if (internalSecret) {
    const provided = c.req.header("x-internal-secret");
    if (provided !== internalSecret) {
      return c.json({ error: "Forbidden" }, 403);
    }
  }

  try {
    const body = (await c.req.json()) as {
      events?: Array<{ type: string; data: Record<string, unknown> }>;
    };

    if (!Array.isArray(body.events) || body.events.length === 0) {
      return c.json({ error: "Missing or empty 'events' array" }, 400);
    }

    const timestamp = new Date().toISOString();
    const publishPromises = body.events.map((evt) =>
      publisher.publishSessionEvent(sessionId, {
        type: evt.type,
        data: evt.data ?? {},
        timestamp,
      })
    );

    await Promise.all(publishPromises);

    return c.json({ ok: true, published: body.events.length });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(
      { sessionId, error: msg },
      "Failed to batch publish SSE events"
    );
    return c.json({ error: "Internal server error" }, 500);
  }
});

export { sseApp };
