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
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

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

const chatV1 = new Hono<V1Env>();

/**
 * POST /api/v1/chat - Stateless chat completion.
 * Creates an ephemeral session, sends the message, and returns
 * the result. Optionally streams via SSE.
 */
chatV1.post("/", async (c) => {
  const auth = c.get("apiKeyAuth");
  const orgId = c.get("orgId");
  const db = c.get("db");

  const body = await c.req.json<{
    message: string;
    model?: string;
    mode?: "ask" | "task" | "plan";
    projectId: string;
    sessionId?: string;
    stream?: boolean;
  }>();

  if (!(body.projectId && body.message)) {
    return c.json(
      {
        error: "Bad Request",
        message: "projectId and message are required",
      },
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

  const mode = body.mode ?? "ask";

  // Reuse or create session
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

  // Store user message
  const userMsgId = generateId("msg");
  await db.insert(sessionMessages).values({
    id: userMsgId,
    sessionId,
    role: "user",
    content: body.message,
  });

  // Create and enqueue a task
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
      userId: auth.userId,
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

  // Non-streaming: wait for completion (up to 120s)
  if (!body.stream) {
    const timeout = 120_000;
    const pollInterval = 2000;
    const start = Date.now();

    while (Date.now() - start < timeout) {
      const current = await db.query.tasks.findFirst({
        where: eq(tasks.id, taskId),
        columns: { status: true },
      });

      if (
        current &&
        (current.status === "completed" ||
          current.status === "failed" ||
          current.status === "cancelled")
      ) {
        // Fetch the assistant response
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

  // Streaming mode: SSE
  return streamSSE(c, async (stream) => {
    const terminalStatuses = ["completed", "failed", "cancelled"];
    const maxDuration = 5 * 60 * 1000;
    const start = Date.now();

    // Send initial acknowledgment
    await stream.writeSSE({
      event: "chat_started",
      data: JSON.stringify({ taskId, sessionId }),
    });

    let lastMsgId: string | undefined;

    while (Date.now() - start < maxDuration) {
      // Check for new assistant messages
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

      // Check if task is done
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
  });
});

export { chatV1 };
