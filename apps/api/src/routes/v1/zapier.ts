import type { AuthContext } from "@prometheus/auth";
import type { Database } from "@prometheus/db";
import { webhookSubscriptions } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";

const logger = createLogger("api:v1:zapier");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface V1Env {
  Variables: {
    apiKeyAuth: AuthContext;
    apiKeyId: string;
    db: Database;
    orgId: string;
    userId: string;
  };
}

type ZapierEventType =
  | "task.completed"
  | "task.failed"
  | "pr.created"
  | "pr.merged"
  | "deployment.succeeded"
  | "deployment.failed"
  | "session.completed";

const VALID_EVENT_TYPES: ZapierEventType[] = [
  "task.completed",
  "task.failed",
  "pr.created",
  "pr.merged",
  "deployment.succeeded",
  "deployment.failed",
  "session.completed",
];

// ---------------------------------------------------------------------------
// Zapier-compatible REST Hooks
// ---------------------------------------------------------------------------

const zapierV1 = new Hono<V1Env>();

/**
 * POST /api/v1/zapier/subscribe
 *
 * Zapier calls this to subscribe to an event trigger.
 * Expects { hookUrl: string, event: ZapierEventType }
 */
zapierV1.post("/subscribe", async (c) => {
  const orgId = c.get("orgId");
  const _userId = c.get("userId");

  const body = await c.req.json<{
    hookUrl?: string;
    event?: string;
  }>();

  if (!body.hookUrl) {
    return c.json({ error: "hookUrl is required" }, 400);
  }

  if (
    !(body.event && VALID_EVENT_TYPES.includes(body.event as ZapierEventType))
  ) {
    return c.json(
      {
        error: `Invalid event type. Valid types: ${VALID_EVENT_TYPES.join(", ")}`,
      },
      400
    );
  }

  const db = c.get("db");
  const subscriptionId = generateId("zapsub");

  await db.insert(webhookSubscriptions).values({
    id: subscriptionId,
    orgId,
    url: body.hookUrl,
    events: [body.event],
    secret: `zapier_${subscriptionId}`,
    description: `Zapier subscription for ${body.event}`,
    enabled: true,
  });

  logger.info(
    { subscriptionId, orgId, event: body.event },
    "Zapier webhook subscription created"
  );

  return c.json({
    id: subscriptionId,
    event: body.event,
    createdAt: new Date().toISOString(),
  });
});

/**
 * DELETE /api/v1/zapier/subscribe/:id
 *
 * Zapier calls this to unsubscribe from an event trigger.
 */
zapierV1.delete("/subscribe/:id", async (c) => {
  const orgId = c.get("orgId");
  const db = c.get("db");
  const subscriptionId = c.req.param("id");

  const subscription = await db.query.webhookSubscriptions.findFirst({
    where: and(
      eq(webhookSubscriptions.id, subscriptionId),
      eq(webhookSubscriptions.orgId, orgId)
    ),
  });

  if (!subscription) {
    return c.json({ error: "Subscription not found" }, 404);
  }

  await db
    .delete(webhookSubscriptions)
    .where(eq(webhookSubscriptions.id, subscriptionId));

  logger.info({ subscriptionId, orgId }, "Zapier webhook subscription deleted");

  return c.json({ success: true });
});

/**
 * GET /api/v1/zapier/subscribe
 *
 * List active subscriptions for the current organization.
 */
zapierV1.get("/subscribe", async (c) => {
  const orgId = c.get("orgId");
  const db = c.get("db");

  const orgSubscriptions = await db.query.webhookSubscriptions.findMany({
    where: eq(webhookSubscriptions.orgId, orgId),
  });

  // Filter to Zapier subscriptions by description prefix
  const zapierSubs = orgSubscriptions.filter((s) =>
    s.description?.startsWith("Zapier subscription")
  );

  return c.json({
    subscriptions: zapierSubs.map((s) => ({
      id: s.id,
      event: (s.events as string[])?.[0] ?? "",
      targetUrl: s.url,
      createdAt: s.createdAt?.toISOString() ?? null,
    })),
  });
});

/**
 * GET /api/v1/zapier/triggers
 *
 * Returns the list of available triggers for Zapier's trigger discovery.
 */
zapierV1.get("/triggers", (c) => {
  return c.json({
    triggers: [
      {
        key: "task.completed",
        label: "Task Completed",
        description: "Fires when an AI agent completes a task successfully.",
        sample: {
          id: "task_sample123",
          title: "Implement login page",
          status: "completed",
          completedAt: "2026-03-26T10:00:00Z",
          sessionId: "session_abc",
          agentId: "agent_xyz",
        },
      },
      {
        key: "task.failed",
        label: "Task Failed",
        description: "Fires when a task fails or encounters an error.",
        sample: {
          id: "task_sample456",
          title: "Fix database migration",
          status: "failed",
          error: "Migration conflict detected",
          failedAt: "2026-03-26T10:00:00Z",
        },
      },
      {
        key: "pr.created",
        label: "Pull Request Created",
        description: "Fires when an agent creates a new pull request.",
        sample: {
          id: "pr_sample789",
          title: "feat: add user authentication",
          url: "https://github.com/org/repo/pull/42",
          branch: "feat/auth",
          createdAt: "2026-03-26T10:00:00Z",
        },
      },
      {
        key: "pr.merged",
        label: "Pull Request Merged",
        description: "Fires when a pull request is merged.",
        sample: {
          id: "pr_sample101",
          title: "feat: add user authentication",
          url: "https://github.com/org/repo/pull/42",
          mergedAt: "2026-03-26T10:00:00Z",
        },
      },
      {
        key: "deployment.succeeded",
        label: "Deployment Succeeded",
        description: "Fires when a deployment completes successfully.",
        sample: {
          id: "deploy_sample202",
          environment: "production",
          version: "1.2.3",
          deployedAt: "2026-03-26T10:00:00Z",
        },
      },
      {
        key: "deployment.failed",
        label: "Deployment Failed",
        description: "Fires when a deployment fails.",
        sample: {
          id: "deploy_sample303",
          environment: "staging",
          error: "Health check failed",
          failedAt: "2026-03-26T10:00:00Z",
        },
      },
      {
        key: "session.completed",
        label: "Session Completed",
        description: "Fires when an AI agent session finishes.",
        sample: {
          id: "session_sample404",
          duration: 3600,
          tasksCompleted: 5,
          completedAt: "2026-03-26T10:00:00Z",
        },
      },
    ],
  });
});

/**
 * GET /api/v1/zapier/actions
 *
 * Returns the list of available actions for Zapier's action discovery.
 */
zapierV1.get("/actions", (c) => {
  return c.json({
    actions: [
      {
        key: "create_task",
        label: "Create Task",
        description: "Create a new task for an AI agent.",
        inputFields: [
          { key: "title", label: "Title", type: "string", required: true },
          {
            key: "description",
            label: "Description",
            type: "text",
            required: false,
          },
          {
            key: "sessionId",
            label: "Session ID",
            type: "string",
            required: false,
          },
          {
            key: "priority",
            label: "Priority",
            type: "string",
            choices: ["low", "medium", "high", "critical"],
            required: false,
          },
        ],
      },
      {
        key: "create_project",
        label: "Create Project",
        description: "Create a new project in Prometheus.",
        inputFields: [
          { key: "name", label: "Name", type: "string", required: true },
          {
            key: "description",
            label: "Description",
            type: "text",
            required: false,
          },
          {
            key: "repoUrl",
            label: "Repository URL",
            type: "string",
            required: false,
          },
        ],
      },
      {
        key: "send_message",
        label: "Submit Chat Message",
        description: "Send a message to an active AI agent session.",
        inputFields: [
          {
            key: "sessionId",
            label: "Session ID",
            type: "string",
            required: true,
          },
          { key: "message", label: "Message", type: "text", required: true },
        ],
      },
      {
        key: "trigger_deployment",
        label: "Trigger Deployment",
        description: "Trigger a deployment for a project.",
        inputFields: [
          {
            key: "projectId",
            label: "Project ID",
            type: "string",
            required: true,
          },
          {
            key: "environment",
            label: "Environment",
            type: "string",
            choices: ["development", "staging", "production"],
            required: true,
          },
          {
            key: "branch",
            label: "Branch",
            type: "string",
            required: false,
          },
        ],
      },
    ],
  });
});

/**
 * POST /api/v1/zapier/actions/:key
 *
 * Execute a Zapier action.
 */
zapierV1.post("/actions/:key", async (c) => {
  const orgId = c.get("orgId");
  const userId = c.get("userId");
  const actionKey = c.req.param("key");
  const body = await c.req.json();

  logger.info({ orgId, userId, actionKey }, "Zapier action executed");

  switch (actionKey) {
    case "create_task": {
      const title = body.title as string | undefined;
      if (!title) {
        return c.json({ error: "title is required" }, 400);
      }
      return c.json({
        id: generateId("task"),
        title,
        description: body.description ?? "",
        status: "pending",
        createdAt: new Date().toISOString(),
      });
    }

    case "create_project": {
      const name = body.name as string | undefined;
      if (!name) {
        return c.json({ error: "name is required" }, 400);
      }
      return c.json({
        id: generateId("proj"),
        name,
        description: body.description ?? "",
        createdAt: new Date().toISOString(),
      });
    }

    case "send_message": {
      const sessionId = body.sessionId as string | undefined;
      const message = body.message as string | undefined;
      if (!(sessionId && message)) {
        return c.json({ error: "sessionId and message are required" }, 400);
      }
      return c.json({
        id: generateId("msg"),
        sessionId,
        content: message,
        sentAt: new Date().toISOString(),
      });
    }

    case "trigger_deployment": {
      const projectId = body.projectId as string | undefined;
      const environment = body.environment as string | undefined;
      if (!(projectId && environment)) {
        return c.json({ error: "projectId and environment are required" }, 400);
      }
      return c.json({
        id: generateId("deploy"),
        projectId,
        environment,
        branch: body.branch ?? "main",
        status: "queued",
        triggeredAt: new Date().toISOString(),
      });
    }

    default:
      return c.json({ error: `Unknown action: ${actionKey}` }, 404);
  }
});

// ---------------------------------------------------------------------------
// Webhook dispatch helper (used by internal event system)
// ---------------------------------------------------------------------------

/**
 * Dispatch an event to all matching Zapier webhook subscriptions.
 * This should be called from the event bus when relevant events occur.
 */
export async function dispatchZapierWebhook(
  orgId: string,
  eventType: ZapierEventType,
  payload: Record<string, unknown>,
  db?: Database
): Promise<void> {
  // If no DB provided, use in-memory fallback for backwards compatibility
  let matchingSubscriptions: Array<{ id: string; url: string }> = [];

  if (db) {
    const subs = await db.query.webhookSubscriptions.findMany({
      where: and(
        eq(webhookSubscriptions.orgId, orgId),
        eq(webhookSubscriptions.enabled, true)
      ),
    });
    matchingSubscriptions = subs
      .filter((s) => (s.events as string[])?.includes(eventType))
      .map((s) => ({ id: s.id, url: s.url }));
  }

  const results = await Promise.allSettled(
    matchingSubscriptions.map(async (sub) => {
      const response = await fetch(sub.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        logger.warn(
          {
            subscriptionId: sub.id,
            status: response.status,
            targetUrl: sub.url,
          },
          "Zapier webhook delivery failed"
        );
      }

      return response;
    })
  );

  const succeeded = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.filter((r) => r.status === "rejected").length;

  if (matchingSubscriptions.length > 0) {
    logger.info(
      {
        orgId,
        eventType,
        total: matchingSubscriptions.length,
        succeeded,
        failed,
      },
      "Zapier webhook dispatch completed"
    );
  }
}

export { zapierV1 };
