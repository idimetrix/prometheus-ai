import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createLogger } from "@prometheus/logger";
import { SessionManager } from "./session-manager";
import { TaskRouter } from "./task-router";
import type { AgentMode, AgentRole } from "@prometheus/types";

const logger = createLogger("orchestrator");

const sessionManager = new SessionManager();
const taskRouter = new TaskRouter(sessionManager);

const app = new Hono();

app.use("/*", cors());

// ─── Health Check ────────────────────────────────────────────────

app.get("/health", (c) =>
  c.json({
    status: "ok",
    service: "orchestrator",
    activeSessions: sessionManager.getActiveSessionCount(),
    timestamp: new Date().toISOString(),
  })
);

// ─── Process Task (called by queue worker) ──────────────────────

app.post("/process", async (c) => {
  try {
    const body = await c.req.json();

    const {
      taskId,
      sessionId,
      projectId,
      orgId,
      userId,
      title,
      description,
      mode,
      agentRole,
    } = body as {
      taskId: string;
      sessionId: string;
      projectId: string;
      orgId: string;
      userId: string;
      title: string;
      description: string | null;
      mode: AgentMode;
      agentRole: AgentRole | null;
    };

    if (!taskId || !sessionId || !projectId || !orgId || !userId || !title || !mode) {
      return c.json(
        { error: "Missing required fields: taskId, sessionId, projectId, orgId, userId, title, mode" },
        400
      );
    }

    logger.info({ taskId, sessionId, mode, agentRole }, "Processing task");

    const result = await taskRouter.processTask({
      taskId,
      sessionId,
      projectId,
      orgId,
      userId,
      title,
      description: description ?? null,
      mode,
      agentRole: agentRole ?? null,
    });

    return c.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ error: msg }, "Failed to process task");
    return c.json({ error: msg }, 500);
  }
});

// ─── Session Status ─────────────────────────────────────────────

app.get("/sessions/:id/status", async (c) => {
  const sessionId = c.req.param("id");

  // Try in-memory first
  const status = sessionManager.getSessionStatus(sessionId);
  if (status) {
    return c.json(status);
  }

  // Try loading from DB
  const loaded = await sessionManager.loadSession(sessionId, "");
  if (loaded) {
    const loadedStatus = sessionManager.getSessionStatus(sessionId);
    return c.json(loadedStatus);
  }

  return c.json({ error: "Session not found" }, 404);
});

// ─── Pause Session ──────────────────────────────────────────────

app.post("/sessions/:id/pause", async (c) => {
  const sessionId = c.req.param("id");

  try {
    await sessionManager.pauseSession(sessionId);
    return c.json({ status: "paused", sessionId });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("not found")) {
      return c.json({ error: msg }, 404);
    }
    return c.json({ error: msg }, 500);
  }
});

// ─── Resume Session ─────────────────────────────────────────────

app.post("/sessions/:id/resume", async (c) => {
  const sessionId = c.req.param("id");

  try {
    await sessionManager.resumeSession(sessionId);
    return c.json({ status: "active", sessionId });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("not found")) {
      return c.json({ error: msg }, 404);
    }
    return c.json({ error: msg }, 500);
  }
});

// ─── Cancel Session ─────────────────────────────────────────────

app.post("/sessions/:id/cancel", async (c) => {
  const sessionId = c.req.param("id");

  try {
    await sessionManager.cancelSession(sessionId);
    return c.json({ status: "cancelled", sessionId });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("not found")) {
      return c.json({ error: msg }, 404);
    }
    return c.json({ error: msg }, 500);
  }
});

// ─── List Active Sessions ───────────────────────────────────────

app.get("/sessions", (c) => {
  const activeSessions = sessionManager.getActiveSessions().map((s) => ({
    id: s.session.id,
    projectId: s.session.projectId,
    userId: s.session.userId,
    status: s.session.status,
    mode: s.session.mode,
    startedAt: s.startedAt.toISOString(),
    activeAgentCount: s.activeAgents.size,
  }));

  return c.json({ sessions: activeSessions, count: activeSessions.length });
});

// ─── Route Task (dry run) ───────────────────────────────────────

app.post("/route", async (c) => {
  try {
    const body = await c.req.json();
    const { description, projectContext } = body as { description: string; projectContext?: string };

    if (!description) {
      return c.json({ error: "'description' is required" }, 400);
    }

    const routing = taskRouter.routeTask(description, projectContext);
    return c.json(routing);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return c.json({ error: msg }, 500);
  }
});

// ─── Start Server ───────────────────────────────────────────────

const port = Number(process.env.ORCHESTRATOR_PORT ?? 4003);

serve({ fetch: app.fetch, port }, () => {
  logger.info({ port }, "Orchestrator engine running");
});

export { SessionManager } from "./session-manager";
export { TaskRouter } from "./task-router";
export { AgentLoop } from "./agent-loop";
