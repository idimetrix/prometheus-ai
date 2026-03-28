/**
 * API V2 Routes — GAP-073
 *
 * V2 introduces:
 * - Streaming responses by default (SSE)
 * - Simplified task creation (single endpoint)
 * - Structured error responses
 * - Pagination via cursor (not offset)
 * - Webhook-first architecture
 */

import { createLogger } from "@prometheus/logger";
import { Hono } from "hono";

const logger = createLogger("api:v2");

const v2 = new Hono();

// Deprecation notice middleware — V1 routes get deprecation headers
export function addDeprecationHeaders(version: string) {
  return async (
    c: { header: (name: string, value: string) => void },
    next: () => Promise<void>
  ) => {
    if (version === "v1") {
      c.header("Deprecation", "true");
      c.header("Sunset", "2027-01-01T00:00:00Z");
      c.header("Link", '</api/v2>; rel="successor-version"');
    }
    await next();
  };
}

/**
 * POST /api/v2/tasks — Create and execute a task (streaming response)
 */
v2.post("/tasks", async (c) => {
  const body = (await c.req.json()) as {
    prompt: string;
    projectId: string;
    mode?: "task" | "ask" | "plan";
    stream?: boolean;
    model?: string;
    maxCredits?: number;
  };

  if (!(body.prompt && body.projectId)) {
    return c.json(
      {
        error: {
          code: "INVALID_INPUT",
          message: "prompt and projectId are required",
        },
      },
      { status: 400 }
    );
  }

  logger.info(
    { projectId: body.projectId, mode: body.mode ?? "task" },
    "V2 task creation"
  );

  // For now, return a placeholder — full implementation delegates to task router
  return c.json({
    id: `tsk_${Date.now()}`,
    status: "queued",
    prompt: body.prompt,
    projectId: body.projectId,
    mode: body.mode ?? "task",
    createdAt: new Date().toISOString(),
    _links: {
      self: `/api/v2/tasks/tsk_${Date.now()}`,
      session: "/api/v2/sessions/placeholder",
      stream: `/api/v2/tasks/tsk_${Date.now()}/stream`,
    },
  });
});

/**
 * GET /api/v2/tasks/:id/stream — Stream task execution via SSE
 */
v2.get("/tasks/:id/stream", (c) => {
  const taskId = c.req.param("id");
  logger.info({ taskId }, "V2 task stream requested");

  return new Response(
    new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ event: "connected", taskId })}\n\n`
          )
        );
        // In production, this would subscribe to Redis pub/sub for the task's session
        controller.close();
      },
    }),
    {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    }
  );
});

/**
 * GET /api/v2/projects — List projects with cursor pagination
 */
v2.get("/projects", (c) => {
  const cursor = c.req.query("cursor");
  const limit = Number.parseInt(c.req.query("limit") ?? "20", 10);

  logger.info({ cursor, limit }, "V2 project list");

  return c.json({
    data: [],
    pagination: {
      cursor: null,
      hasMore: false,
      limit,
    },
  });
});

/**
 * GET /api/v2/health — API health check
 */
v2.get("/health", (c) => {
  return c.json({
    status: "ok",
    version: "2.0.0",
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /api/v2/migration — Migration guide from V1 to V2
 */
v2.get("/migration", (c) => {
  return c.json({
    guide: {
      breaking_changes: [
        "Task creation now returns immediately with streaming URL",
        "Pagination uses cursor instead of offset",
        "Error responses use structured format { error: { code, message } }",
        "All list endpoints return { data, pagination } wrapper",
      ],
      new_features: [
        "SSE streaming by default for all long-running operations",
        "Webhook subscriptions for async notifications",
        "Batch operations for fleet task management",
      ],
      deprecated_v1_endpoints: [
        "POST /api/v1/tasks → POST /api/v2/tasks",
        "GET /api/v1/sessions → GET /api/v2/sessions",
        "POST /api/v1/completions → POST /api/v2/completions",
      ],
      sunset_date: "2027-01-01",
    },
  });
});

export { v2 as v2Routes };
