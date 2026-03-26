import type { AuthContext } from "@prometheus/auth";
import type { Database } from "@prometheus/db";
import {
  organizations,
  projects,
  sessionEvents,
  sessions,
  tasks,
} from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { agentTaskQueue } from "@prometheus/queue";
import { generateId } from "@prometheus/utils";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

const logger = createLogger("api:v1:tasks");

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

const tasksV1 = new Hono<V1Env>();

// POST /api/v1/tasks - Create and enqueue a task
tasksV1.post("/", async (c) => {
  const auth = c.get("apiKeyAuth");
  const orgId = c.get("orgId");
  const db = c.get("db");

  const body = await c.req.json<{
    description: string;
    mode?: "task" | "plan";
    priority?: number;
    projectId: string;
    waitForCompletion?: boolean;
  }>();

  if (!(body.projectId && body.description)) {
    return c.json(
      {
        error: "Bad Request",
        message: "projectId and description are required",
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

  // Create session
  const sessionId = generateId("ses");
  const mode = body.mode ?? "task";
  await db.insert(sessions).values({
    id: sessionId,
    projectId: body.projectId,
    userId: auth.userId,
    status: "active",
    mode,
  });

  // Create task
  const taskId = generateId("task");
  const priority = body.priority ?? 50;
  const [task] = await db
    .insert(tasks)
    .values({
      id: taskId,
      sessionId,
      projectId: body.projectId,
      orgId,
      title: body.description.slice(0, 200),
      description: body.description,
      status: "pending",
      priority,
      agentRole: null,
      creditsReserved: 0,
      creditsConsumed: 0,
    })
    .returning();

  // Enqueue
  const planTier = await getOrgPlanTier(db, orgId);
  await agentTaskQueue.add(
    "agent-task",
    {
      taskId,
      sessionId,
      projectId: body.projectId,
      orgId,
      userId: auth.userId,
      title: body.description.slice(0, 200),
      description: body.description,
      mode,
      agentRole: null,
      planTier,
      creditsReserved: 0,
    },
    { priority }
  );

  logger.info({ taskId, sessionId, orgId }, "Task created via REST API v1");

  const result = {
    id: task?.id ?? taskId,
    sessionId,
    status: "pending",
    createdAt: task?.createdAt?.toISOString() ?? new Date().toISOString(),
  };

  // If waitForCompletion, long-poll up to 120s
  if (body.waitForCompletion) {
    const timeout = 120_000;
    const pollInterval = 2000;
    const start = Date.now();

    while (Date.now() - start < timeout) {
      const current = await db.query.tasks.findFirst({
        where: eq(tasks.id, taskId),
      });

      if (
        current &&
        (current.status === "completed" ||
          current.status === "failed" ||
          current.status === "cancelled")
      ) {
        return c.json({
          id: current.id,
          sessionId: current.sessionId,
          status: current.status,
          creditsConsumed: current.creditsConsumed,
          createdAt: current.createdAt?.toISOString(),
          completedAt: current.completedAt?.toISOString(),
        });
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    // Timed out - return current state
    const current = await db.query.tasks.findFirst({
      where: eq(tasks.id, taskId),
    });
    return c.json({
      id: taskId,
      sessionId,
      status: current?.status ?? "pending",
      message: "Task did not complete within timeout, check status with GET",
      createdAt: result.createdAt,
    });
  }

  return c.json(result, 201);
});

// GET /api/v1/tasks/:id - Get task status and result
tasksV1.get("/:id", async (c) => {
  const orgId = c.get("orgId");
  const db = c.get("db");
  const taskId = c.req.param("id");

  const task = await db.query.tasks.findFirst({
    where: and(eq(tasks.id, taskId), eq(tasks.orgId, orgId)),
  });

  if (!task) {
    return c.json({ error: "Not Found", message: "Task not found" }, 404);
  }

  return c.json({
    id: task.id,
    sessionId: task.sessionId,
    projectId: task.projectId,
    status: task.status,
    title: task.title,
    description: task.description,
    creditsConsumed: task.creditsConsumed,
    createdAt: task.createdAt?.toISOString(),
    completedAt: task.completedAt?.toISOString(),
  });
});

// GET /api/v1/tasks/:id/events - SSE stream of task events
tasksV1.get("/:id/events", async (c) => {
  const orgId = c.get("orgId");
  const db = c.get("db");
  const taskId = c.req.param("id");

  // Verify task access
  const task = await db.query.tasks.findFirst({
    where: and(eq(tasks.id, taskId), eq(tasks.orgId, orgId)),
    columns: { id: true, sessionId: true, status: true },
  });

  if (!task) {
    return c.json({ error: "Not Found", message: "Task not found" }, 404);
  }

  return streamSSE(c, async (stream) => {
    let lastEventId: string | undefined;
    const terminalStatuses = ["completed", "failed", "cancelled"];
    let isTerminal = terminalStatuses.includes(task.status);

    // Stream events for up to 5 minutes
    const maxDuration = 5 * 60 * 1000;
    const start = Date.now();

    while (!isTerminal && Date.now() - start < maxDuration) {
      const conditions = [eq(sessionEvents.sessionId, task.sessionId)];

      const events = await db.query.sessionEvents.findMany({
        where: and(...conditions),
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

      // Check if task is done
      const current = await db.query.tasks.findFirst({
        where: eq(tasks.id, taskId),
        columns: { status: true },
      });
      if (current && terminalStatuses.includes(current.status)) {
        isTerminal = true;
        await stream.writeSSE({
          event: "task_complete",
          data: JSON.stringify({ status: current.status }),
        });
      } else {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  });
});

// POST /api/v1/tasks/:id/cancel - Cancel a running task
tasksV1.post("/:id/cancel", async (c) => {
  const orgId = c.get("orgId");
  const db = c.get("db");
  const taskId = c.req.param("id");

  const task = await db.query.tasks.findFirst({
    where: and(eq(tasks.id, taskId), eq(tasks.orgId, orgId)),
  });

  if (!task) {
    return c.json({ error: "Not Found", message: "Task not found" }, 404);
  }

  const terminalStatuses = ["completed", "failed", "cancelled"];
  if (terminalStatuses.includes(task.status)) {
    return c.json(
      {
        error: "Conflict",
        message: `Task is already ${task.status} and cannot be cancelled`,
      },
      409
    );
  }

  const [updated] = await db
    .update(tasks)
    .set({ status: "cancelled", completedAt: new Date() })
    .where(and(eq(tasks.id, taskId), eq(tasks.orgId, orgId)))
    .returning();

  // Remove from queue if still waiting
  try {
    const job = await agentTaskQueue.getJob(taskId);
    if (job) {
      await job.remove();
    }
  } catch {
    // Job may already be processing
  }

  logger.info({ taskId, orgId }, "Task cancelled via REST API v1");

  return c.json({
    id: updated?.id ?? taskId,
    status: "cancelled",
    cancelledAt: updated?.completedAt?.toISOString(),
  });
});

// GET /api/v1/tasks - List tasks
tasksV1.get("/", async (c) => {
  const orgId = c.get("orgId");
  const db = c.get("db");

  const projectId = c.req.query("projectId");
  const status = c.req.query("status");
  const limit = Math.min(Number(c.req.query("limit") ?? "50"), 100);
  const offset = Number(c.req.query("offset") ?? "0");

  const conditions = [eq(tasks.orgId, orgId)];
  if (projectId) {
    conditions.push(eq(tasks.projectId, projectId));
  }
  if (status) {
    conditions.push(
      eq(
        tasks.status,
        status as
          | "pending"
          | "queued"
          | "running"
          | "completed"
          | "failed"
          | "cancelled"
      )
    );
  }

  const results = await db.query.tasks.findMany({
    where: and(...conditions),
    orderBy: [desc(tasks.createdAt)],
    limit: limit + 1,
    offset,
  });

  const hasMore = results.length > limit;
  const items = hasMore ? results.slice(0, limit) : results;

  return c.json({
    tasks: items.map((t) => ({
      id: t.id,
      sessionId: t.sessionId,
      projectId: t.projectId,
      status: t.status,
      title: t.title,
      creditsConsumed: t.creditsConsumed,
      createdAt: t.createdAt?.toISOString(),
      completedAt: t.completedAt?.toISOString(),
    })),
    hasMore,
    total: items.length,
  });
});

export { tasksV1 };
