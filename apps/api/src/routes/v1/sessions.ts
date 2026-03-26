import type { AuthContext } from "@prometheus/auth";
import { getInternalAuthHeaders } from "@prometheus/auth";
import type { Database } from "@prometheus/db";
import {
  organizations,
  projects,
  sessionEvents,
  sessionMessages,
  sessions,
  tasks,
} from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { agentTaskQueue } from "@prometheus/queue";
import { generateId } from "@prometheus/utils";
import { and, desc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

const logger = createLogger("api:v1:sessions");

const ORCHESTRATOR_URL =
  process.env.ORCHESTRATOR_URL ?? "http://localhost:4002";

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

const sessionsV1 = new Hono<V1Env>();

// GET /api/v1/sessions - List sessions
sessionsV1.get("/", async (c) => {
  const orgId = c.get("orgId");
  const db = c.get("db");

  const projectId = c.req.query("projectId");
  const status = c.req.query("status");
  const limit = Math.min(Number(c.req.query("limit") ?? "50"), 100);
  const offset = Number(c.req.query("offset") ?? "0");

  // Get org project IDs for RLS
  const orgProjects = await db.query.projects.findMany({
    where: eq(projects.orgId, orgId),
    columns: { id: true },
  });
  const projectIds = orgProjects.map((p) => p.id);

  if (projectIds.length === 0) {
    return c.json({ sessions: [], hasMore: false, total: 0 });
  }

  const conditions = [inArray(sessions.projectId, projectIds)];
  if (projectId) {
    conditions.push(eq(sessions.projectId, projectId));
  }
  if (status) {
    conditions.push(
      eq(
        sessions.status,
        status as "active" | "paused" | "completed" | "cancelled" | "failed"
      )
    );
  }

  const results = await db.query.sessions.findMany({
    where: and(...conditions),
    orderBy: [desc(sessions.startedAt)],
    limit: limit + 1,
    offset,
  });

  const hasMore = results.length > limit;
  const items = hasMore ? results.slice(0, limit) : results;

  return c.json({
    sessions: items.map((s) => ({
      id: s.id,
      projectId: s.projectId,
      mode: s.mode,
      status: s.status,
      startedAt: s.startedAt?.toISOString(),
      endedAt: s.endedAt?.toISOString(),
    })),
    hasMore,
    total: items.length,
  });
});

// POST /api/v1/sessions - Create a session
sessionsV1.post("/", async (c) => {
  const auth = c.get("apiKeyAuth");
  const orgId = c.get("orgId");
  const db = c.get("db");

  const body = await c.req.json<{
    mode: "task" | "ask" | "plan" | "design";
    projectId: string;
    prompt?: string;
  }>();

  if (!(body.projectId && body.mode)) {
    return c.json(
      { error: "Bad Request", message: "projectId and mode are required" },
      400
    );
  }

  // Verify project belongs to org
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, body.projectId), eq(projects.orgId, orgId)),
    columns: { id: true },
  });
  if (!project) {
    return c.json({ error: "Not Found", message: "Project not found" }, 404);
  }

  const sessionId = generateId("ses");
  const [session] = await db
    .insert(sessions)
    .values({
      id: sessionId,
      projectId: body.projectId,
      userId: auth.userId,
      status: "active",
      mode: body.mode,
    })
    .returning();

  // If prompt provided, create and queue a task
  if (body.prompt) {
    const taskId = generateId("task");
    const planTier = await getOrgPlanTier(db, orgId);

    await db.insert(tasks).values({
      id: taskId,
      sessionId,
      projectId: body.projectId,
      orgId,
      title: body.prompt.slice(0, 200),
      description: body.prompt,
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
        userId: auth.userId,
        title: body.prompt.slice(0, 200),
        description: body.prompt,
        mode: body.mode,
        agentRole: null,
        planTier,
        creditsReserved: 0,
      },
      { priority: 50 }
    );
  }

  logger.info(
    { sessionId, orgId, mode: body.mode },
    "Session created via REST API v1"
  );

  return c.json(
    {
      id: session?.id ?? sessionId,
      projectId: body.projectId,
      mode: body.mode,
      status: "active",
      createdAt: session?.startedAt?.toISOString() ?? new Date().toISOString(),
    },
    201
  );
});

// GET /api/v1/sessions/:id - Get session with events
sessionsV1.get("/:id", async (c) => {
  const orgId = c.get("orgId");
  const db = c.get("db");
  const sessionId = c.req.param("id");

  // Get org project IDs for RLS
  const orgProjects = await db.query.projects.findMany({
    where: eq(projects.orgId, orgId),
    columns: { id: true },
  });
  const projectIds = orgProjects.map((p) => p.id);

  if (projectIds.length === 0) {
    return c.json({ error: "Not Found", message: "Session not found" }, 404);
  }

  const session = await db.query.sessions.findFirst({
    where: and(
      eq(sessions.id, sessionId),
      inArray(sessions.projectId, projectIds)
    ),
  });

  if (!session) {
    return c.json({ error: "Not Found", message: "Session not found" }, 404);
  }

  // Fetch recent events
  const events = await db.query.sessionEvents.findMany({
    where: eq(sessionEvents.sessionId, sessionId),
    orderBy: [desc(sessionEvents.timestamp)],
    limit: 50,
  });

  // Fetch messages
  const messages = await db.query.sessionMessages.findMany({
    where: eq(sessionMessages.sessionId, sessionId),
    orderBy: [desc(sessionMessages.createdAt)],
    limit: 100,
  });

  return c.json({
    id: session.id,
    projectId: session.projectId,
    mode: session.mode,
    status: session.status,
    startedAt: session.startedAt?.toISOString(),
    endedAt: session.endedAt?.toISOString(),
    events: events.map((e) => ({
      id: e.id,
      type: e.type,
      data: e.data,
      timestamp: e.timestamp?.toISOString(),
    })),
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt?.toISOString(),
    })),
  });
});

// POST /api/v1/sessions/:id/messages - Send message to session
sessionsV1.post("/:id/messages", async (c) => {
  const auth = c.get("apiKeyAuth");
  const orgId = c.get("orgId");
  const db = c.get("db");
  const sessionId = c.req.param("id");

  const body = await c.req.json<{ content: string }>();
  if (!body.content) {
    return c.json(
      { error: "Bad Request", message: "content is required" },
      400
    );
  }

  // Verify session access
  const orgProjects = await db.query.projects.findMany({
    where: eq(projects.orgId, orgId),
    columns: { id: true },
  });
  const projectIds = orgProjects.map((p) => p.id);

  const session = await db.query.sessions.findFirst({
    where: and(
      eq(sessions.id, sessionId),
      inArray(sessions.projectId, projectIds)
    ),
  });

  if (!session) {
    return c.json({ error: "Not Found", message: "Session not found" }, 404);
  }

  if (session.status !== "active") {
    return c.json(
      {
        error: "Conflict",
        message: `Cannot send message to a ${session.status} session`,
      },
      409
    );
  }

  const messageId = generateId("msg");
  const [message] = await db
    .insert(sessionMessages)
    .values({
      id: messageId,
      sessionId,
      role: "user",
      content: body.content,
    })
    .returning();

  // Queue the message as a task
  const taskId = generateId("task");
  const planTier = await getOrgPlanTier(db, orgId);
  await agentTaskQueue.add(
    "agent-task",
    {
      taskId,
      sessionId,
      projectId: session.projectId,
      orgId,
      userId: auth.userId,
      title: body.content.slice(0, 200),
      description: body.content,
      mode: session.mode,
      agentRole: null,
      planTier,
      creditsReserved: 0,
    },
    { priority: 50 }
  );

  logger.info({ sessionId, messageId }, "Message sent via REST API v1");

  return c.json(
    {
      id: message?.id ?? messageId,
      role: "user",
      content: body.content,
      taskId,
      createdAt: message?.createdAt?.toISOString() ?? new Date().toISOString(),
    },
    201
  );
});

// GET /api/v1/sessions/:id/stream - SSE stream of session events
sessionsV1.get("/:id/stream", async (c) => {
  const orgId = c.get("orgId");
  const db = c.get("db");
  const sessionId = c.req.param("id");

  // Verify session access
  const orgProjects = await db.query.projects.findMany({
    where: eq(projects.orgId, orgId),
    columns: { id: true },
  });
  const projectIds = orgProjects.map((p) => p.id);

  const session = await db.query.sessions.findFirst({
    where: and(
      eq(sessions.id, sessionId),
      inArray(sessions.projectId, projectIds)
    ),
    columns: { id: true, status: true },
  });

  if (!session) {
    return c.json({ error: "Not Found", message: "Session not found" }, 404);
  }

  return streamSSE(c, async (stream) => {
    let lastEventId: string | undefined;
    const terminalStatuses = ["completed", "cancelled", "failed"];
    let isTerminal = terminalStatuses.includes(session.status);

    const maxDuration = 5 * 60 * 1000;
    const start = Date.now();

    while (!isTerminal && Date.now() - start < maxDuration) {
      const events = await db.query.sessionEvents.findMany({
        where: eq(sessionEvents.sessionId, sessionId),
        orderBy: [desc(sessionEvents.timestamp)],
        limit: 50,
      });

      for (const event of events.reverse()) {
        if (lastEventId && event.id <= lastEventId) {
          continue;
        }
        await stream.writeSSE({
          id: event.id,
          event: event.type,
          data: JSON.stringify({
            id: event.id,
            type: event.type,
            data: event.data,
            timestamp: event.timestamp?.toISOString(),
          }),
        });
        lastEventId = event.id;
      }

      // Check session status
      const current = await db.query.sessions.findFirst({
        where: eq(sessions.id, sessionId),
        columns: { status: true },
      });
      if (current && terminalStatuses.includes(current.status)) {
        isTerminal = true;
        await stream.writeSSE({
          event: "session_ended",
          data: JSON.stringify({ status: current.status }),
        });
      } else {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  });
});

// POST /api/v1/sessions/:id/pause - Pause session
sessionsV1.post("/:id/pause", async (c) => {
  const orgId = c.get("orgId");
  const db = c.get("db");
  const sessionId = c.req.param("id");

  const orgProjects = await db.query.projects.findMany({
    where: eq(projects.orgId, orgId),
    columns: { id: true },
  });
  const projectIds = orgProjects.map((p) => p.id);

  const session = await db.query.sessions.findFirst({
    where: and(
      eq(sessions.id, sessionId),
      inArray(sessions.projectId, projectIds)
    ),
  });

  if (!session) {
    return c.json({ error: "Not Found", message: "Session not found" }, 404);
  }

  if (session.status !== "active") {
    return c.json(
      {
        error: "Conflict",
        message: `Session is ${session.status}, cannot pause`,
      },
      409
    );
  }

  await db
    .update(sessions)
    .set({ status: "paused" })
    .where(eq(sessions.id, sessionId));

  // Signal orchestrator
  try {
    await fetch(`${ORCHESTRATOR_URL}/sessions/${sessionId}/pause`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getInternalAuthHeaders(),
      },
    });
  } catch (err) {
    logger.warn(
      { sessionId, error: String(err) },
      "Failed to signal orchestrator pause"
    );
  }

  await db.insert(sessionEvents).values({
    id: generateId("evt"),
    sessionId,
    type: "checkpoint",
    data: { action: "paused", source: "rest_api_v1" },
  });

  logger.info({ sessionId }, "Session paused via REST API v1");
  return c.json({ id: sessionId, status: "paused" });
});

// POST /api/v1/sessions/:id/resume - Resume session
sessionsV1.post("/:id/resume", async (c) => {
  const orgId = c.get("orgId");
  const db = c.get("db");
  const sessionId = c.req.param("id");

  const orgProjects = await db.query.projects.findMany({
    where: eq(projects.orgId, orgId),
    columns: { id: true },
  });
  const projectIds = orgProjects.map((p) => p.id);

  const session = await db.query.sessions.findFirst({
    where: and(
      eq(sessions.id, sessionId),
      inArray(sessions.projectId, projectIds)
    ),
  });

  if (!session) {
    return c.json({ error: "Not Found", message: "Session not found" }, 404);
  }

  if (session.status !== "paused") {
    return c.json(
      {
        error: "Conflict",
        message: `Session is ${session.status}, cannot resume`,
      },
      409
    );
  }

  await db
    .update(sessions)
    .set({ status: "active" })
    .where(eq(sessions.id, sessionId));

  // Signal orchestrator
  try {
    await fetch(`${ORCHESTRATOR_URL}/sessions/${sessionId}/resume`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getInternalAuthHeaders(),
      },
    });
  } catch (err) {
    logger.warn(
      { sessionId, error: String(err) },
      "Failed to signal orchestrator resume"
    );
  }

  await db.insert(sessionEvents).values({
    id: generateId("evt"),
    sessionId,
    type: "checkpoint",
    data: { action: "resumed", source: "rest_api_v1" },
  });

  logger.info({ sessionId }, "Session resumed via REST API v1");
  return c.json({ id: sessionId, status: "active" });
});

// POST /api/v1/sessions/:id/cancel - Cancel session
sessionsV1.post("/:id/cancel", async (c) => {
  const orgId = c.get("orgId");
  const db = c.get("db");
  const sessionId = c.req.param("id");

  const orgProjects = await db.query.projects.findMany({
    where: eq(projects.orgId, orgId),
    columns: { id: true },
  });
  const projectIds = orgProjects.map((p) => p.id);

  const session = await db.query.sessions.findFirst({
    where: and(
      eq(sessions.id, sessionId),
      inArray(sessions.projectId, projectIds)
    ),
  });

  if (!session) {
    return c.json({ error: "Not Found", message: "Session not found" }, 404);
  }

  const terminalStatuses = ["completed", "cancelled", "failed"];
  if (terminalStatuses.includes(session.status)) {
    return c.json(
      {
        error: "Conflict",
        message: `Session is already ${session.status}`,
      },
      409
    );
  }

  await db
    .update(sessions)
    .set({ status: "cancelled", endedAt: new Date() })
    .where(eq(sessions.id, sessionId));

  // Signal orchestrator
  try {
    await fetch(`${ORCHESTRATOR_URL}/sessions/${sessionId}/cancel`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getInternalAuthHeaders(),
      },
    });
  } catch (err) {
    logger.warn(
      { sessionId, error: String(err) },
      "Failed to signal orchestrator cancel"
    );
  }

  await db.insert(sessionEvents).values({
    id: generateId("evt"),
    sessionId,
    type: "checkpoint",
    data: { action: "cancelled", source: "rest_api_v1" },
  });

  logger.info({ sessionId }, "Session cancelled via REST API v1");
  return c.json({ id: sessionId, status: "cancelled" });
});

// DELETE /api/v1/sessions/:id - End/delete a session
sessionsV1.delete("/:id", async (c) => {
  const orgId = c.get("orgId");
  const db = c.get("db");
  const sessionId = c.req.param("id");

  const orgProjects = await db.query.projects.findMany({
    where: eq(projects.orgId, orgId),
    columns: { id: true },
  });
  const projectIds = orgProjects.map((p) => p.id);

  const session = await db.query.sessions.findFirst({
    where: and(
      eq(sessions.id, sessionId),
      inArray(sessions.projectId, projectIds)
    ),
  });

  if (!session) {
    return c.json({ error: "Not Found", message: "Session not found" }, 404);
  }

  const terminalStatuses = ["completed", "cancelled", "failed"];
  if (!terminalStatuses.includes(session.status)) {
    // Cancel active/paused sessions first
    await db
      .update(sessions)
      .set({ status: "cancelled", endedAt: new Date() })
      .where(eq(sessions.id, sessionId));

    try {
      await fetch(`${ORCHESTRATOR_URL}/sessions/${sessionId}/cancel`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getInternalAuthHeaders(),
        },
      });
    } catch (err) {
      logger.warn(
        { sessionId, error: String(err) },
        "Failed to signal orchestrator cancel on delete"
      );
    }
  }

  await db.insert(sessionEvents).values({
    id: generateId("evt"),
    sessionId,
    type: "checkpoint",
    data: { action: "deleted", source: "rest_api_v1" },
  });

  logger.info({ sessionId }, "Session deleted via REST API v1");
  return c.json({ id: sessionId, status: "deleted" });
});

export { sessionsV1 };
