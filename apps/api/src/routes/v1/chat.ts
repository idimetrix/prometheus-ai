import type { AuthContext } from "@prometheus/auth";
import type { Database } from "@prometheus/db";
import {
  organizations,
  projects,
  sessionMessages,
  sessions,
  tasks,
} from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { agentTaskQueue } from "@prometheus/queue";
import { generateId } from "@prometheus/utils";
import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  callModelRouter,
  callModelRouterStream,
} from "../../lib/model-router-client";

const logger = createLogger("api:v1:chat");

type PlanTier = "hobby" | "starter" | "pro" | "team" | "studio" | "enterprise";

async function getOrgPlanTier(db: Database, orgId: string): Promise<PlanTier> {
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
    columns: { planTier: true },
  });
  return (org?.planTier ?? "hobby") as PlanTier;
}

interface V1Env {
  Variables: {
    apiKeyAuth: AuthContext;
    apiKeyId: string;
    db: Database;
    orgId: string;
    userId: string;
  };
}

/**
 * Patterns that indicate the query requires tool use / agent loop.
 * If any pattern matches, the request is routed to the orchestrator pipeline.
 */
const COMPLEX_QUERY_PATTERNS = [
  // File operations
  /\b(create|write|edit|modify|delete|rename|move)\s+(a\s+)?(file|directory|folder)/i,
  /\b(add|remove|update)\s+(to|from|in)\s+/i,
  // Git operations
  /\bgit\s+(commit|push|pull|merge|rebase|branch|checkout|stash)/i,
  /\b(commit|push|merge)\s+(the|this|my|these)\s+/i,
  // Terminal / shell commands
  /\b(run|execute|install|npm|pnpm|yarn|pip|cargo|make|docker)\b/i,
  // Explicit task keywords
  /\b(implement|build|fix|refactor|deploy|migrate)\s+(this|the|a|an)\b/i,
  // Multi-step work
  /\b(step[s]?\s+\d|first.*then|after\s+that)/i,
];

/**
 * Determine whether a user message is a "simple" query that can be answered
 * directly by the LLM without tools, or a "complex" query that needs the
 * full orchestrator pipeline.
 */
function isSimpleQuery(message: string): boolean {
  if (message.length < 20) {
    return true;
  }

  for (const pattern of COMPLEX_QUERY_PATTERNS) {
    if (pattern.test(message)) {
      return false;
    }
  }

  return true;
}

const FAST_PATH_SYSTEM_PROMPT =
  "You are Prometheus, an AI engineering assistant. Answer the user's question clearly and concisely. You do not have access to tools in this mode.";

interface ChatRequestBody {
  forceOrchestrator?: boolean;
  message: string;
  mode?: "ask" | "task" | "plan";
  model?: string;
  projectId?: string;
  sessionId?: string;
  stream?: boolean;
}

/**
 * Handle a fast-path streaming chat request via model-router.
 */
async function handleFastPathStream(
  body: ChatRequestBody,
  orgId: string,
  userId: string
): Promise<Response> {
  const requestStart = performance.now();
  const messages = [
    { role: "system", content: FAST_PATH_SYSTEM_PROMPT },
    { role: "user", content: body.message },
  ];

  const { stream, latencyMs } = await callModelRouterStream({
    slot: "fastLoop",
    messages,
    options: { model: body.model, orgId, userId },
  });

  const totalMs = Math.round(performance.now() - requestStart);
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "X-Response-Time": `${totalMs}ms`,
      "X-Model-Latency": `${latencyMs}ms`,
      "X-Fast-Path": "true",
    },
  });
}

/**
 * Handle a fast-path non-streaming chat request via model-router.
 */
async function handleFastPathComplete(
  body: ChatRequestBody,
  orgId: string,
  userId: string,
  sessionId: string,
  db: Database,
  c: Context
): Promise<Response> {
  const requestStart = performance.now();
  const messages = [
    { role: "system", content: FAST_PATH_SYSTEM_PROMPT },
    { role: "user", content: body.message },
  ];

  const { response, latencyMs } = await callModelRouter({
    slot: "fastLoop",
    messages,
    options: { model: body.model, orgId, userId },
  });

  const content = response.choices[0]?.message?.content ?? "";

  const assistantMsgId = generateId("msg");
  await db.insert(sessionMessages).values({
    id: assistantMsgId,
    sessionId,
    role: "assistant",
    content,
  });

  const totalMs = Math.round(performance.now() - requestStart);

  return c.json(
    {
      id: sessionId,
      sessionId,
      status: "completed",
      message: { role: "assistant", content },
      model: response.model,
      responseTimeMs: totalMs,
      modelLatencyMs: latencyMs,
      fastPath: true,
    },
    200,
    {
      "X-Response-Time": `${totalMs}ms`,
      "X-Fast-Path": "true",
    }
  );
}

/**
 * Enqueue a task in the orchestrator pipeline and return the response.
 */
async function handleOrchestratorPipeline(
  c: Context,
  db: Database,
  body: ChatRequestBody & { projectId: string },
  orgId: string,
  userId: string,
  mode: "ask" | "task" | "plan",
  sessionId: string
): Promise<Response> {
  const userMsgId = generateId("msg");
  await db.insert(sessionMessages).values({
    id: userMsgId,
    sessionId,
    role: "user",
    content: body.message,
  });

  const taskId = generateId("task");
  const planTier = await getOrgPlanTier(db, orgId);

  await db.insert(tasks).values({
    id: taskId,
    sessionId,
    projectId: body.projectId,
    orgId,
    title: body.message.slice(0, 200),
    description: body.message,
    status: "pending",
    priority: 50,
    agentRole: null,
    creditsReserved: 0,
    creditsConsumed: 0,
  });

  await agentTaskQueue.add(
    "agent-task",
    {
      taskId,
      sessionId,
      projectId: body.projectId,
      orgId,
      userId,
      title: body.message.slice(0, 200),
      description: body.message,
      mode,
      agentRole: null,
      planTier,
      creditsReserved: 0,
    },
    { priority: 50 }
  );

  logger.info(
    { taskId, sessionId, orgId, stream: body.stream },
    "Chat message submitted via REST API v1"
  );

  if (!body.stream) {
    return pollForCompletion(c, db, taskId, sessionId);
  }

  return streamTaskEvents(c, db, taskId, sessionId);
}

/**
 * Poll for task completion (non-streaming) up to 120s timeout.
 */
async function pollForCompletion(
  c: Context,
  db: Database,
  taskId: string,
  sessionId: string
): Promise<Response> {
  const timeout = 120_000;
  const pollInterval = 2000;
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const current = await db.query.tasks.findFirst({
      where: eq(tasks.id, taskId),
      columns: { status: true },
    });

    if (
      current?.status === "completed" ||
      current?.status === "failed" ||
      current?.status === "cancelled"
    ) {
      const assistantMsg = await db.query.sessionMessages.findFirst({
        where: and(
          eq(sessionMessages.sessionId, sessionId),
          eq(sessionMessages.role, "assistant")
        ),
        orderBy: (m, { desc }) => [desc(m.createdAt)],
      });

      return c.json({
        id: taskId,
        sessionId,
        status: current.status,
        message: {
          role: "assistant",
          content: assistantMsg?.content ?? null,
        },
      });
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  return c.json({
    id: taskId,
    sessionId,
    status: "pending",
    message: null,
    hint: "Task did not complete within timeout. Use GET /v1/tasks/:id to poll.",
  });
}

/**
 * Stream task events via SSE until task completes.
 */
function streamTaskEvents(
  c: Context,
  db: Database,
  taskId: string,
  sessionId: string
): Response {
  return streamSSE(c, async (stream) => {
    const terminalStatuses = ["completed", "failed", "cancelled"];
    const maxDuration = 5 * 60 * 1000;
    const start = Date.now();

    await stream.writeSSE({
      event: "chat_started",
      data: JSON.stringify({ taskId, sessionId }),
    });

    let lastMsgId: string | undefined;

    while (Date.now() - start < maxDuration) {
      const messages = await db.query.sessionMessages.findMany({
        where: and(
          eq(sessionMessages.sessionId, sessionId),
          eq(sessionMessages.role, "assistant")
        ),
        orderBy: (m, { desc }) => [desc(m.createdAt)],
        limit: 5,
      });

      for (const msg of messages.reverse()) {
        if (lastMsgId && msg.id <= lastMsgId) {
          continue;
        }
        await stream.writeSSE({
          id: msg.id,
          event: "message",
          data: JSON.stringify({
            role: "assistant",
            content: msg.content,
          }),
        });
        lastMsgId = msg.id;
      }

      const current = await db.query.tasks.findFirst({
        where: eq(tasks.id, taskId),
        columns: { status: true },
      });

      if (current && terminalStatuses.includes(current.status)) {
        await stream.writeSSE({
          event: "chat_complete",
          data: JSON.stringify({ status: current.status }),
        });
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }) as unknown as Response;
}

const chatV1 = new Hono<V1Env>();

/**
 * POST /api/v1/chat/fast - Fast-path chat that bypasses the orchestrator.
 * Routes simple queries directly to the model-router for low-latency responses.
 * Complex queries are rejected with a hint to use the standard endpoint.
 */
chatV1.post("/fast", async (c) => {
  const auth = c.get("apiKeyAuth");
  const orgId = c.get("orgId");
  const db = c.get("db");

  const body = await c.req.json<ChatRequestBody>();

  if (!body.message) {
    return c.json(
      { error: "Bad Request", message: "'message' is required" },
      400
    );
  }

  if (!isSimpleQuery(body.message)) {
    return c.json(
      {
        error: "Complex Query",
        message: "This query requires tool use. Use POST /api/v1/chat instead.",
        redirect: "/api/v1/chat",
        isComplex: true,
      },
      422
    );
  }

  if (body.projectId) {
    const project = await db.query.projects.findFirst({
      where: and(eq(projects.id, body.projectId), eq(projects.orgId, orgId)),
      columns: { id: true },
    });
    if (!project) {
      return c.json({ error: "Not Found", message: "Project not found" }, 404);
    }
  }

  const sessionId = body.sessionId;
  if (sessionId) {
    const userMsgId = generateId("msg");
    await db.insert(sessionMessages).values({
      id: userMsgId,
      sessionId,
      role: "user",
      content: body.message,
    });
  }

  logger.info(
    {
      orgId,
      userId: auth.userId,
      model: body.model,
      sessionId,
      fastPath: true,
    },
    "Fast-path chat request"
  );

  try {
    return await handleFastPathStream(body, orgId, auth.userId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(
      { error: msg, userId: auth.userId },
      "Fast-path chat stream failed"
    );
    return c.json({ error: "Failed to stream chat response" }, 500);
  }
});

/**
 * POST /api/v1/chat/fast/complete - Non-streaming fast-path chat.
 * Returns the full response at once for simple queries.
 */
chatV1.post("/fast/complete", async (c) => {
  const auth = c.get("apiKeyAuth");
  const orgId = c.get("orgId");
  const db = c.get("db");

  const body = await c.req.json<ChatRequestBody>();

  if (!body.message) {
    return c.json(
      { error: "Bad Request", message: "'message' is required" },
      400
    );
  }

  if (!isSimpleQuery(body.message)) {
    return c.json(
      {
        error: "Complex Query",
        message: "This query requires tool use. Use POST /api/v1/chat instead.",
        redirect: "/api/v1/chat",
        isComplex: true,
      },
      422
    );
  }

  if (body.projectId) {
    const project = await db.query.projects.findFirst({
      where: and(eq(projects.id, body.projectId), eq(projects.orgId, orgId)),
      columns: { id: true },
    });
    if (!project) {
      return c.json({ error: "Not Found", message: "Project not found" }, 404);
    }
  }

  const sessionId = body.sessionId ?? generateId("ses");
  if (body.sessionId) {
    const userMsgId = generateId("msg");
    await db.insert(sessionMessages).values({
      id: userMsgId,
      sessionId,
      role: "user",
      content: body.message,
    });
  }

  try {
    return await handleFastPathComplete(
      body,
      orgId,
      auth.userId,
      sessionId,
      db,
      c
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(
      { error: msg, userId: auth.userId },
      "Fast-path chat complete failed"
    );
    return c.json({ error: "Failed to complete chat request" }, 500);
  }
});

/**
 * POST /api/v1/chat - Stateless chat completion.
 * Creates an ephemeral session, sends the message, and returns
 * the result. Optionally streams via SSE.
 *
 * Automatically detects simple queries and routes them to the fast path
 * when mode is "ask" and no explicit orchestrator routing is requested.
 */
chatV1.post("/", async (c) => {
  const auth = c.get("apiKeyAuth");
  const orgId = c.get("orgId");
  const db = c.get("db");

  const body = await c.req.json<ChatRequestBody & { projectId: string }>();

  if (!(body.projectId && body.message)) {
    return c.json(
      {
        error: "Bad Request",
        message: "projectId and message are required",
      },
      400
    );
  }

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, body.projectId), eq(projects.orgId, orgId)),
    columns: { id: true },
  });
  if (!project) {
    return c.json({ error: "Not Found", message: "Project not found" }, 404);
  }

  const mode = body.mode ?? "ask";

  // Auto-detect fast path for simple "ask" queries
  if (
    mode === "ask" &&
    !body.forceOrchestrator &&
    isSimpleQuery(body.message)
  ) {
    const fastPathResult = await tryFastPath(c, db, body, orgId, auth, mode);
    if (fastPathResult) {
      return fastPathResult;
    }
  }

  // Orchestrator pipeline
  let sessionId = body.sessionId;
  if (!sessionId) {
    sessionId = generateId("ses");
    await db.insert(sessions).values({
      id: sessionId,
      projectId: body.projectId,
      userId: auth.userId,
      status: "active",
      mode,
    });
  }

  return handleOrchestratorPipeline(
    c,
    db,
    body,
    orgId,
    auth.userId,
    mode,
    sessionId
  );
});

/**
 * Attempt fast-path routing for a simple query.
 * Returns a Response if successful, or null to fall through to orchestrator.
 */
async function tryFastPath(
  c: Context,
  db: Database,
  body: ChatRequestBody & { projectId: string },
  orgId: string,
  auth: AuthContext,
  mode: "ask" | "task" | "plan"
): Promise<Response | null> {
  logger.info(
    { orgId, userId: auth.userId, mode },
    "Auto-routing to fast path"
  );

  let sessionId = body.sessionId;
  if (!sessionId) {
    sessionId = generateId("ses");
    await db.insert(sessions).values({
      id: sessionId,
      projectId: body.projectId,
      userId: auth.userId,
      status: "active",
      mode,
    });
  }

  const userMsgId = generateId("msg");
  await db.insert(sessionMessages).values({
    id: userMsgId,
    sessionId,
    role: "user",
    content: body.message,
  });

  try {
    if (body.stream) {
      return await handleFastPathStream(body, orgId, auth.userId);
    }
    return await handleFastPathComplete(
      body,
      orgId,
      auth.userId,
      sessionId,
      db,
      c
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(
      { error: msg },
      "Fast path failed, falling through to orchestrator"
    );
    return null;
  }
}

export { chatV1 };
