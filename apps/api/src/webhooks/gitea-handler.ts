/**
 * Gitea Webhook Handler
 *
 * Processes inbound Gitea webhooks:
 * - issues -> Sync issues to syncedIssues table
 * - pull_request -> Sync PRs to syncedPullRequests table
 * - push -> Log pushes to default branch and create CI/test task
 *
 * Gitea's webhook API closely mirrors GitHub's format.
 * Webhook signature verification uses HMAC-SHA256 from the X-Gitea-Signature header.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { Database } from "@prometheus/db";
import {
  sessions,
  syncedIssues,
  syncedPullRequests,
  tasks,
} from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { and, eq } from "drizzle-orm";
import type { Context } from "hono";

const logger = createLogger("api:webhook:gitea");

const PROMETHEUS_LABEL = "prometheus";

// ---------------------------------------------------------------------------
// Signature verification (HMAC SHA-256)
// ---------------------------------------------------------------------------

/**
 * Verify the Gitea webhook signature using HMAC-SHA256.
 * Gitea sends the hex-encoded HMAC in the `X-Gitea-Signature` header.
 */
function verifyGiteaSignature(body: string, signature: string): boolean {
  const secret = process.env.GITEA_WEBHOOK_SECRET;

  if (!secret) {
    logger.warn("GITEA_WEBHOOK_SECRET not configured, rejecting webhook");
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
// Types (mirrors GitHub webhook format)
// ---------------------------------------------------------------------------

interface GiteaIssuePayload {
  action: string;
  issue: {
    body: string;
    html_url: string;
    labels: Array<{ name: string }>;
    number: number;
    state: string;
    title: string;
    user: { login: string };
  };
  repository: {
    default_branch: string;
    full_name: string;
    html_url: string;
  };
  sender: { login: string };
}

interface GiteaPullRequestPayload {
  action: string;
  pull_request: {
    base: { ref: string };
    body: string;
    head: { ref: string; sha: string };
    html_url: string;
    number: number;
    state: string;
    title: string;
    user: { login: string };
  };
  repository: {
    default_branch: string;
    full_name: string;
    html_url: string;
  };
  sender: { login: string };
}

interface GiteaPushPayload {
  after: string;
  before: string;
  commits: Array<{
    added: string[];
    id: string;
    message: string;
    modified: string[];
    removed: string[];
  }>;
  ref: string;
  repository: {
    default_branch: string;
    full_name: string;
    html_url: string;
  };
  sender: { login: string };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
 * Handle Gitea issues events (opened, edited, labeled).
 * Syncs to the syncedIssues table and creates a task for prometheus-labeled issues.
 */
async function handleIssuesEvent(
  db: Database,
  payload: GiteaIssuePayload,
  orgId: string,
  projectId: string
): Promise<void> {
  const action = payload.action;
  const issue = payload.issue;

  // Only handle opened, edited, and labeled actions
  if (action !== "opened" && action !== "edited" && action !== "labeled") {
    return;
  }

  // Check for the "prometheus" label
  const hasLabel = issue.labels.some(
    (l) => l.name.toLowerCase() === PROMETHEUS_LABEL
  );
  if (!hasLabel) {
    return;
  }

  const issueUrl = issue.html_url;

  const description = [
    `Gitea Issue #${issue.number}: ${issue.title}`,
    `Author: ${issue.user.login}`,
    `URL: ${issueUrl}`,
    "",
    issue.body || "No description provided.",
  ].join("\n");

  const { taskId, sessionId } = await createWebhookTask(db, {
    projectId,
    orgId,
    title: `Gitea#${issue.number}: ${issue.title}`,
    description,
    priority: 50,
  });

  // Sync issue to database (best-effort; Gitea uses "github" provider
  // since the webhook format mirrors GitHub's and the DB enum does not
  // yet include a dedicated "gitea" value).
  try {
    const existingSynced = await db
      .select()
      .from(syncedIssues)
      .where(
        and(
          eq(syncedIssues.projectId, projectId),
          eq(syncedIssues.provider, "github"),
          eq(syncedIssues.externalId, `gitea-${issue.number}`)
        )
      )
      .limit(1);

    if (existingSynced[0]) {
      await db
        .update(syncedIssues)
        .set({
          taskId,
          sessionId,
          assignedToAgent: true,
          title: issue.title,
          body: issue.body,
          externalStatus: issue.state,
          lastSyncedAt: new Date(),
        })
        .where(eq(syncedIssues.id, existingSynced[0].id));
    } else {
      await db.insert(syncedIssues).values({
        id: generateId("si"),
        projectId,
        orgId,
        provider: "github",
        externalId: `gitea-${issue.number}`,
        externalUrl: issueUrl,
        title: issue.title,
        body: issue.body,
        externalStatus: issue.state,
        taskId,
        sessionId,
        assignedToAgent: true,
        lastSyncedAt: new Date(),
      });
    }
  } catch (syncError) {
    const syncMsg =
      syncError instanceof Error ? syncError.message : String(syncError);
    logger.warn({ error: syncMsg }, "Failed to sync Gitea issue to database");
  }

  logger.info(
    {
      taskId,
      issueNumber: issue.number,
      action,
      repo: payload.repository.full_name,
    },
    "Task created from Gitea issue"
  );
}

/**
 * Handle Gitea pull_request events (opened, edited, synchronized).
 * Syncs to the syncedPullRequests table and creates a review task.
 */
async function handlePullRequestEvent(
  db: Database,
  payload: GiteaPullRequestPayload,
  orgId: string,
  projectId: string
): Promise<void> {
  const action = payload.action;
  const pr = payload.pull_request;

  // Only handle opened, edited, and synchronized actions
  if (action !== "opened" && action !== "edited" && action !== "synchronized") {
    return;
  }

  const prUrl = pr.html_url;

  const description = [
    `Review Gitea PR #${pr.number}: ${pr.title}`,
    `Author: ${pr.user.login}`,
    `Branch: ${pr.head.ref} -> ${pr.base.ref}`,
    `URL: ${prUrl}`,
    "",
    pr.body || "No description provided.",
  ].join("\n");

  const { taskId, sessionId } = await createWebhookTask(db, {
    projectId,
    orgId,
    title: `Review Gitea PR #${pr.number}: ${pr.title}`,
    description,
    priority: 60,
  });

  // Sync PR to database (best-effort; uses "github" provider since the
  // DB enum does not yet include a dedicated "gitea" value).
  try {
    const existingSynced = await db
      .select()
      .from(syncedPullRequests)
      .where(
        and(
          eq(syncedPullRequests.projectId, projectId),
          eq(syncedPullRequests.provider, "github"),
          eq(syncedPullRequests.externalId, `gitea-${pr.number}`)
        )
      )
      .limit(1);

    if (existingSynced[0]) {
      await db
        .update(syncedPullRequests)
        .set({
          title: pr.title,
          branch: pr.head.ref,
          baseBranch: pr.base.ref,
          sessionId,
          reviewStatus: "pending",
          lastSyncedAt: new Date(),
        })
        .where(eq(syncedPullRequests.id, existingSynced[0].id));
    } else {
      await db.insert(syncedPullRequests).values({
        id: generateId("spr"),
        projectId,
        orgId,
        provider: "github",
        externalId: `gitea-${pr.number}`,
        externalUrl: prUrl,
        title: pr.title,
        branch: pr.head.ref,
        baseBranch: pr.base.ref,
        sessionId,
        reviewStatus: "pending",
        lastSyncedAt: new Date(),
      });
    }
  } catch (syncError) {
    const syncMsg =
      syncError instanceof Error ? syncError.message : String(syncError);
    logger.warn({ error: syncMsg }, "Failed to sync Gitea PR to database");
  }

  logger.info(
    {
      taskId,
      prNumber: pr.number,
      action,
      repo: payload.repository.full_name,
    },
    "Review task created from Gitea pull request"
  );
}

/**
 * Handle Gitea push events.
 * Logs pushes to the default branch and creates a CI/test task.
 */
async function handlePushEvent(
  db: Database,
  payload: GiteaPushPayload,
  orgId: string,
  projectId: string
): Promise<void> {
  const defaultBranch = payload.repository.default_branch;
  const pushRef = payload.ref;

  // Only handle pushes to the default branch
  if (pushRef !== `refs/heads/${defaultBranch}`) {
    return;
  }

  const changedFiles = new Set<string>();
  for (const commit of payload.commits) {
    for (const f of commit.added) {
      changedFiles.add(f);
    }
    for (const f of commit.modified) {
      changedFiles.add(f);
    }
  }

  if (changedFiles.size === 0) {
    return;
  }

  const fileList = [...changedFiles].slice(0, 50).join("\n- ");
  const commitMessages = payload.commits
    .map((c) => `- ${c.message.split("\n")[0]}`)
    .join("\n");

  const description = [
    `CI/Test task for push to ${defaultBranch}`,
    `Repository: ${payload.repository.full_name}`,
    `Pushed by: ${payload.sender.login}`,
    "",
    "Commits:",
    commitMessages,
    "",
    `Changed files (${changedFiles.size}):`,
    `- ${fileList}`,
  ].join("\n");

  const { taskId } = await createWebhookTask(db, {
    projectId,
    orgId,
    title: `CI: Push to ${defaultBranch} (${payload.commits.length} commits)`,
    description,
    priority: 40,
  });

  logger.info(
    {
      taskId,
      commitCount: payload.commits.length,
      changedFiles: changedFiles.size,
      repo: payload.repository.full_name,
    },
    "CI task created from Gitea push"
  );
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

/**
 * Handle inbound Gitea webhook requests.
 *
 * Verifies the HMAC-SHA256 signature from the X-Gitea-Signature header,
 * parses the event type from the X-Gitea-Event header, and dispatches to
 * the appropriate handler.
 */
export async function handleGiteaWebhook(
  c: Context,
  db: Database,
  orgId: string
): Promise<Response> {
  const rawBody = await c.req.text();
  const signature = c.req.header("X-Gitea-Signature") ?? "";

  // Verify HMAC signature
  if (!verifyGiteaSignature(rawBody, signature)) {
    logger.warn("Invalid Gitea webhook signature");
    return c.json({ error: "Invalid signature" }, 401);
  }

  const event = c.req.header("X-Gitea-Event") ?? "";
  let body: Record<string, unknown>;

  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    logger.warn("Invalid JSON in Gitea webhook body");
    return c.json({ error: "Invalid JSON" }, 400);
  }

  // Resolve project for this org
  const projectId = await resolveProjectId(db, orgId);
  if (!projectId) {
    logger.warn({ orgId }, "No project found for Gitea webhook");
    return c.json({ error: "No project found" }, 404);
  }

  logger.info({ event, orgId, projectId }, "Gitea webhook received");

  try {
    switch (event) {
      case "issues":
        await handleIssuesEvent(
          db,
          body as unknown as GiteaIssuePayload,
          orgId,
          projectId
        );
        break;

      case "pull_request":
        await handlePullRequestEvent(
          db,
          body as unknown as GiteaPullRequestPayload,
          orgId,
          projectId
        );
        break;

      case "push":
        await handlePushEvent(
          db,
          body as unknown as GiteaPushPayload,
          orgId,
          projectId
        );
        break;

      default:
        logger.debug({ event }, "Unhandled Gitea webhook event type");
    }

    return c.json({ ok: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(
      { error: msg, event, orgId },
      "Gitea webhook processing failed"
    );
    return c.json({ error: "Webhook processing failed" }, 500);
  }
}
