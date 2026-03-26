/**
 * CI Trigger Webhook
 *
 * Inbound webhook endpoint that triggers agent tasks from CI pipelines.
 * POST /webhooks/ci/:projectId
 *
 * Authentication via X-Webhook-Secret header (must match an API key hash).
 */

import { createHash } from "node:crypto";
import { apiKeys, db, projects, sessions, tasks } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { agentTaskQueue, indexingQueue } from "@prometheus/queue";
import { generateId } from "@prometheus/utils";
import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";

const logger = createLogger("api:webhooks:ci-trigger");

interface CITriggerBody {
  branch?: string;
  ciRunUrl?: string;
  commitSha?: string;
  description: string;
  event: "push" | "pr" | "ci_failure" | "manual";
  metadata?: Record<string, unknown>;
}

const ciTriggerApp = new Hono();

ciTriggerApp.post("/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const apiKey = c.req.header("x-webhook-secret");

  if (!apiKey) {
    return c.json({ error: "Missing X-Webhook-Secret header" }, 401);
  }

  // Hash the provided key and look it up
  const keyHash = createHash("sha256").update(apiKey).digest("hex");
  const [key] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)))
    .limit(1);

  if (!key) {
    return c.json({ error: "Invalid API key" }, 401);
  }

  // Verify the key has access to this project (if scoped)
  if (
    key.projectIds &&
    key.projectIds.length > 0 &&
    !key.projectIds.includes(projectId)
  ) {
    return c.json({ error: "API key not authorized for this project" }, 403);
  }

  // Fetch project
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.orgId, key.orgId)))
    .limit(1);

  if (!project) {
    return c.json({ error: "Project not found" }, 404);
  }

  let body: CITriggerBody;
  try {
    body = await c.req.json<CITriggerBody>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!(body.event && body.description)) {
    return c.json(
      { error: "Missing required fields: event, description" },
      400
    );
  }

  const validEvents = ["push", "pr", "ci_failure", "manual"];
  if (!validEvents.includes(body.event)) {
    return c.json(
      {
        error: `Invalid event type. Must be one of: ${validEvents.join(", ")}`,
      },
      400
    );
  }

  logger.info(
    {
      projectId,
      event: body.event,
      branch: body.branch,
      commitSha: body.commitSha,
    },
    "CI trigger webhook received"
  );

  // Create session and task
  const sessionId = generateId("ses");
  const taskId = generateId("tsk");

  // Determine task title and agent role based on event
  let title: string;
  let agentRole: string | null = null;
  switch (body.event) {
    case "push": {
      title = `CI Push: Index and scan (${body.branch ?? "main"})`;
      agentRole = "security_auditor";
      break;
    }
    case "pr": {
      title = `CI PR Review: ${body.description}`;
      agentRole = "architect";
      break;
    }
    case "ci_failure": {
      title = `CI Failure Fix: ${body.description}`;
      agentRole = "ci_loop";
      break;
    }
    case "manual": {
      title = body.description;
      break;
    }
    default: {
      title = body.description;
      break;
    }
  }

  // Create session (userId from the API key owner)
  await db.insert(sessions).values({
    id: sessionId,
    projectId,
    userId: key.userId,
    status: "active",
    mode: "task",
  });

  // Create task
  await db.insert(tasks).values({
    id: taskId,
    orgId: key.orgId,
    projectId,
    sessionId,
    title,
    description: body.description,
    status: "pending",
    agentRole,
  });

  // Enqueue based on event type
  const commonJobData = {
    taskId,
    sessionId,
    orgId: key.orgId,
    projectId,
    userId: key.userId,
    planTier: "pro" as const,
    creditsReserved: 10,
    mode: "task" as const,
  };

  switch (body.event) {
    case "push": {
      await indexingQueue.add(`ci-push-index:${projectId}`, {
        orgId: key.orgId,
        projectId,
        filePaths: [],
        fullReindex: false,
        triggeredBy: "push",
      });

      await agentTaskQueue.add(`ci-push-scan:${taskId}`, {
        ...commonJobData,
        title,
        description: `Scan code for security vulnerabilities after push to ${body.branch ?? "main"}. Commit: ${body.commitSha ?? "unknown"}`,
        agentRole: "security_auditor",
      });
      break;
    }

    case "pr": {
      await agentTaskQueue.add(`ci-pr-review:${taskId}`, {
        ...commonJobData,
        title,
        description: `Review PR: ${body.description}. Branch: ${body.branch ?? "unknown"}`,
        agentRole: "architect",
        creditsReserved: 15,
      });
      break;
    }

    case "ci_failure": {
      await agentTaskQueue.add(`ci-failure-fix:${taskId}`, {
        ...commonJobData,
        title,
        description: `Analyze CI failure and attempt fix: ${body.description}. ${body.ciRunUrl ? `CI Run: ${body.ciRunUrl}` : ""}`,
        agentRole: "ci_loop",
        creditsReserved: 20,
      });
      break;
    }
    default: {
      await agentTaskQueue.add(`ci-manual:${taskId}`, {
        ...commonJobData,
        title,
        description: body.description,
        agentRole: null,
        creditsReserved: 15,
      });
      break;
    }
  }

  logger.info(
    { projectId, taskId, sessionId, event: body.event },
    "CI trigger task created"
  );

  return c.json(
    {
      taskId,
      sessionId,
      status: "queued",
    },
    201
  );
});

export { ciTriggerApp };
