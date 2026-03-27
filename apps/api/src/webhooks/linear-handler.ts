/**
 * Linear Webhook Handler
 *
 * Processes inbound Linear webhooks:
 * - Issue create/update -> Sync issue to syncedIssues table and create task
 * - Comment create -> If mentions prometheus, create a response task
 *
 * Webhook signature verification uses HMAC-SHA256 from the Linear-Signature header.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { Database } from "@prometheus/db";
import { sessions, syncedIssues, tasks } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { and, eq } from "drizzle-orm";
import type { Context } from "hono";

const logger = createLogger("api:webhook:linear");

const BOT_MENTION = "prometheus";

// ---------------------------------------------------------------------------
// Signature verification (HMAC SHA-256)
// ---------------------------------------------------------------------------

/**
 * Verify the Linear webhook signature using HMAC-SHA256.
 * Linear sends the signature in the `Linear-Signature` header.
 */
function verifyLinearSignature(body: string, signature: string): boolean {
  const secret = process.env.LINEAR_WEBHOOK_SECRET;

  if (!secret) {
    logger.warn("LINEAR_WEBHOOK_SECRET not configured, rejecting webhook");
    return false;
  }

  if (!signature) {
    return false;
  }

  try {
    const expectedSig = createHmac("sha256", secret).update(body).digest("hex");
    const expected = Buffer.from(expectedSig);
    const actual = Buffer.from(signature);

    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LinearIssueData {
  assignee?: { name: string } | null;
  description?: string | null;
  id: string;
  identifier: string;
  labels?: Array<{ name: string }>;
  priority: number;
  state?: { name: string } | null;
  title: string;
  url: string;
}

interface LinearCommentData {
  body: string;
  id: string;
  issue?: {
    id: string;
    identifier: string;
    title: string;
    url: string;
  };
  user?: { name: string } | null;
}

interface LinearWebhookPayload {
  action: string;
  data: Record<string, unknown>;
  type: string;
  url?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map Linear priority (0=none, 1=urgent, 2=high, 3=medium, 4=low) to our
 * internal priority scale (0-100).
 */
function mapLinearPriority(priority: number): number {
  switch (priority) {
    case 1:
      return 90; // urgent
    case 2:
      return 70; // high
    case 3:
      return 50; // medium
    case 4:
      return 30; // low
    default:
      return 50; // none / default
  }
}

/**
 * Create a session and task in the database for a webhook-triggered event.
 */
async function createWebhookTask(
  db: Database,
  params: {
    description: string;
    orgId: string;
    priority: number;
    projectId: string;
    title: string;
  }
): Promise<{ sessionId: string; taskId: string }> {
  const taskId = generateId("task");
  const sessionId = generateId("ses");

  await db.insert(sessions).values({
    id: sessionId,
    projectId: params.projectId,
    userId: params.orgId,
    status: "active",
    mode: "task",
  });

  await db.insert(tasks).values({
    id: taskId,
    sessionId,
    projectId: params.projectId,
    orgId: params.orgId,
    title: params.title,
    description: params.description,
    status: "queued",
    priority: params.priority,
  });

  return { taskId, sessionId };
}

/**
 * Resolve a project ID for the org, falling back to the first project.
 */
async function resolveProjectId(
  db: Database,
  orgId: string
): Promise<string | null> {
  const result = await db.query.projects.findFirst({
    where: eq((await import("@prometheus/db")).projects.orgId, orgId),
    columns: { id: true },
  });

  return result?.id ?? null;
}

// ---------------------------------------------------------------------------
// Event Handlers
// ---------------------------------------------------------------------------

/**
 * Handle Linear Issue create/update events.
 * Syncs the issue to the syncedIssues table and creates an agent task.
 */
async function handleIssueEvent(
  db: Database,
  payload: LinearWebhookPayload,
  orgId: string,
  projectId: string
): Promise<void> {
  const action = payload.action;

  if (action !== "create" && action !== "update") {
    return;
  }

  const issue = payload.data as unknown as LinearIssueData;

  if (!(issue.id && issue.identifier)) {
    logger.debug("Linear issue missing id or identifier, skipping");
    return;
  }

  const issueUrl = issue.url || payload.url || "";
  const stateName = issue.state?.name ?? "Unknown";

  const description = [
    `Linear Issue: ${issue.identifier}`,
    `Title: ${issue.title}`,
    `Status: ${stateName}`,
    `Priority: ${issue.priority}`,
    `Assignee: ${issue.assignee?.name ?? "Unassigned"}`,
    `URL: ${issueUrl}`,
    "",
    issue.description ?? "No description provided.",
  ].join("\n");

  const priority = mapLinearPriority(issue.priority);

  const { taskId, sessionId } = await createWebhookTask(db, {
    projectId,
    orgId,
    title: `Linear ${issue.identifier}: ${issue.title}`,
    description,
    priority,
  });

  // Check for existing synced issue
  const existingSynced = await db
    .select()
    .from(syncedIssues)
    .where(
      and(
        eq(syncedIssues.projectId, projectId),
        eq(syncedIssues.provider, "linear"),
        eq(syncedIssues.externalId, issue.id)
      )
    )
    .limit(1);

  // Upsert synced issue
  if (existingSynced[0]) {
    await db
      .update(syncedIssues)
      .set({
        taskId,
        sessionId,
        assignedToAgent: true,
        title: issue.title,
        body: issue.description,
        externalStatus: stateName,
        lastSyncedAt: new Date(),
      })
      .where(eq(syncedIssues.id, existingSynced[0].id));
  } else {
    await db.insert(syncedIssues).values({
      id: generateId("si"),
      projectId,
      orgId,
      provider: "linear",
      externalId: issue.id,
      externalUrl: issueUrl,
      title: issue.title,
      body: issue.description,
      externalStatus: stateName,
      taskId,
      sessionId,
      assignedToAgent: true,
      lastSyncedAt: new Date(),
    });
  }

  logger.info(
    {
      taskId,
      linearId: issue.identifier,
      action,
    },
    "Task created from Linear issue"
  );
}

/**
 * Handle Linear Comment create events.
 * Creates a response task if the comment mentions prometheus.
 */
async function handleCommentEvent(
  db: Database,
  payload: LinearWebhookPayload,
  orgId: string,
  projectId: string
): Promise<void> {
  if (payload.action !== "create") {
    return;
  }

  const comment = payload.data as unknown as LinearCommentData;

  if (!comment.body) {
    return;
  }

  // Only respond to comments mentioning prometheus
  if (!comment.body.toLowerCase().includes(BOT_MENTION)) {
    return;
  }

  const issue = comment.issue;
  if (!issue) {
    return;
  }

  const taskDescription = comment.body.trim();
  const commenterName = comment.user?.name ?? "Unknown";

  const description = [
    `Respond to Linear comment on ${issue.identifier}: ${issue.title}`,
    `Commenter: ${commenterName}`,
    `Issue URL: ${issue.url}`,
    "",
    "Comment:",
    taskDescription,
  ].join("\n");

  const { taskId } = await createWebhookTask(db, {
    projectId,
    orgId,
    title: `Linear comment: ${issue.identifier} from ${commenterName}`,
    description,
    priority: 50,
  });

  logger.info(
    {
      taskId,
      linearIssue: issue.identifier,
      commenter: commenterName,
    },
    "Task created from Linear comment mention"
  );
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

/**
 * Handle inbound Linear webhook requests.
 *
 * Verifies the HMAC-SHA256 signature from the Linear-Signature header,
 * parses the event type from the body, and dispatches to the appropriate handler.
 */
export async function handleLinearWebhook(
  c: Context,
  db: Database,
  orgId: string
): Promise<Response> {
  const rawBody = await c.req.text();
  const signature = c.req.header("Linear-Signature") ?? "";

  // Verify HMAC signature
  if (!verifyLinearSignature(rawBody, signature)) {
    logger.warn("Invalid Linear webhook signature");
    return c.json({ error: "Invalid signature" }, 401);
  }

  let payload: LinearWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as LinearWebhookPayload;
  } catch {
    logger.warn("Invalid JSON in Linear webhook body");
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const eventType = payload.type;

  // Resolve project for this org
  const projectId = await resolveProjectId(db, orgId);
  if (!projectId) {
    logger.warn({ orgId }, "No project found for Linear webhook");
    return c.json({ error: "No project found" }, 404);
  }

  logger.info(
    { type: eventType, action: payload.action, orgId },
    "Linear webhook received"
  );

  try {
    switch (eventType) {
      case "Issue":
        await handleIssueEvent(db, payload, orgId, projectId);
        break;

      case "Comment":
        await handleCommentEvent(db, payload, orgId, projectId);
        break;

      default:
        logger.debug(
          { type: eventType },
          "Unhandled Linear webhook event type"
        );
    }

    return c.json({ ok: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(
      { error: msg, type: eventType, orgId },
      "Linear webhook processing failed"
    );
    return c.json({ error: "Webhook processing failed" }, 500);
  }
}
