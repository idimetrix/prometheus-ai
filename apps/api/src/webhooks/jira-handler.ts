/**
 * Jira Webhook Handler
 *
 * Processes inbound Jira webhooks:
 * - jira:issue_created with "prometheus" label -> Create implementation task
 *
 * Jira webhooks are verified via a shared secret (JWT or basic token).
 */

import { db, projects, sessions, tasks } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { agentTaskQueue } from "@prometheus/queue";
import { generateId } from "@prometheus/utils";
import { eq } from "drizzle-orm";
import type { Context } from "hono";

const logger = createLogger("api:webhooks:jira-handler");

const JIRA_WEBHOOK_SECRET = process.env.JIRA_WEBHOOK_SECRET ?? "";
const PROMETHEUS_LABEL = "prometheus";
const BEARER_RE = /^Bearer\s+/i;

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

function verifyJiraRequest(c: Context): boolean {
  if (!JIRA_WEBHOOK_SECRET) {
    logger.warn("JIRA_WEBHOOK_SECRET not configured");
    return false;
  }

  // Jira can use either a shared secret in Authorization header or a JWT token.
  // We support a simple Bearer token check.
  const authHeader = c.req.header("authorization") ?? "";
  const token = authHeader.replace(BEARER_RE, "").trim();

  return token === JIRA_WEBHOOK_SECRET;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface JiraWebhookPayload {
  issue?: {
    fields?: {
      assignee?: { displayName: string } | null;
      description?: string | null;
      labels?: string[];
      priority?: { name: string } | null;
      summary?: string;
    };
    key?: string;
  };
  webhookEvent?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapJiraPriority(priorityName: string | undefined): number {
  switch (priorityName?.toLowerCase()) {
    case "highest":
    case "blocker":
      return 90;
    case "high":
    case "critical":
      return 70;
    case "medium":
      return 50;
    case "low":
      return 30;
    case "lowest":
      return 10;
    default:
      return 50;
  }
}

async function findDefaultProject(
  orgId: string
): Promise<{ id: string; orgId: string } | null> {
  const result = await db
    .select({ id: projects.id, orgId: projects.orgId })
    .from(projects)
    .where(eq(projects.orgId, orgId))
    .limit(1);

  return result[0] ?? null;
}

// ---------------------------------------------------------------------------
// Event handler
// ---------------------------------------------------------------------------

async function handleIssueCreated(payload: JiraWebhookPayload): Promise<void> {
  const issue = payload.issue;
  const fields = issue?.fields;

  if (!(issue?.key && fields)) {
    logger.debug("Jira issue missing key or fields, skipping");
    return;
  }

  // Only handle issues with the "prometheus" label
  const hasLabel = fields.labels?.some(
    (l) => l.toLowerCase() === PROMETHEUS_LABEL
  );
  if (!hasLabel) {
    return;
  }

  const orgId = process.env.JIRA_DEFAULT_ORG_ID ?? "__jira__";
  const project = await findDefaultProject(orgId);

  if (!project) {
    logger.warn({ orgId }, "No project found for Jira default org");
    return;
  }

  const summary = fields.summary ?? "Untitled Jira issue";
  const priority = mapJiraPriority(fields.priority?.name);
  const assignee = fields.assignee?.displayName ?? "Unassigned";

  const description = [
    `Jira Issue: ${issue.key}`,
    `Summary: ${summary}`,
    `Priority: ${fields.priority?.name ?? "Medium"}`,
    `Assignee: ${assignee}`,
    "",
    fields.description ?? "No description provided.",
  ].join("\n");

  const taskId = generateId("task");
  const sessionId = generateId("ses");

  await db.insert(sessions).values({
    id: sessionId,
    projectId: project.id,
    userId: project.orgId,
    status: "active",
    mode: "task",
  });

  await db.insert(tasks).values({
    id: taskId,
    sessionId,
    projectId: project.id,
    orgId: project.orgId,
    title: `Jira ${issue.key}: ${summary}`,
    description,
    status: "queued",
    priority,
  });

  await agentTaskQueue.add(`jira-${issue.key}`, {
    taskId,
    sessionId,
    projectId: project.id,
    orgId: project.orgId,
    userId: project.orgId,
    title: summary,
    description,
    mode: "task",
    agentRole: null,
    creditsReserved: 100,
    planTier: "pro",
  });

  logger.info(
    { taskId, jiraKey: issue.key, priority },
    "Task created from Jira issue"
  );
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function handleJiraWebhook(c: Context): Promise<Response> {
  if (!verifyJiraRequest(c)) {
    logger.warn("Invalid Jira webhook authorization");
    return c.json({ error: "Unauthorized" }, 401);
  }

  try {
    const payload = (await c.req.json()) as JiraWebhookPayload;
    const event = payload.webhookEvent ?? "";

    logger.info({ event }, "Processing Jira webhook");

    switch (event) {
      case "jira:issue_created":
        await handleIssueCreated(payload);
        break;
      default:
        logger.debug({ event }, "Unhandled Jira webhook event");
    }

    return c.json({ ok: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ error: msg }, "Jira webhook processing failed");
    return c.json({ error: "Webhook processing failed" }, 500);
  }
}
