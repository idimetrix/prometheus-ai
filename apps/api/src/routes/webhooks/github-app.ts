/**
 * GitHub App Webhook Handler
 *
 * Handles PR/issue events from GitHub App installation.
 * Auto-creates tasks for:
 * - New issues with specific labels (e.g., "prometheus-auto")
 * - PR review requests
 * - PR comments mentioning @prometheus-bot
 * - Push events (trigger re-index)
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { db, processedWebhookEvents, projects, tasks } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { agentTaskQueue, indexingQueue } from "@prometheus/queue";
import { generateId } from "@prometheus/utils";
import { eq } from "drizzle-orm";
import type { Context } from "hono";

const logger = createLogger("api:webhooks:github-app");

const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET ?? "";

interface GitHubWebhookPayload {
  action: string;
  comment?: {
    body: string;
    user: { login: string };
  };
  commits?: Array<{
    id: string;
    added: string[];
    removed: string[];
    modified: string[];
  }>;
  installation?: { id: number };
  issue?: {
    number: number;
    title: string;
    body: string;
    labels: Array<{ name: string }>;
    user: { login: string };
  };
  pull_request?: {
    number: number;
    title: string;
    body: string;
    head: { ref: string; sha: string };
    base: { ref: string };
    user: { login: string };
  };
  ref?: string;
  repository: {
    full_name: string;
    clone_url: string;
  };
  sender: { login: string };
}

const AUTO_LABEL = "prometheus-auto";
const BOT_MENTION = "@prometheus-bot";

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

function verifyGitHubSignature(
  payload: string,
  signatureHeader: string | undefined
): boolean {
  if (!GITHUB_WEBHOOK_SECRET) {
    logger.warn("GITHUB_WEBHOOK_SECRET not set — skipping verification");
    return true;
  }

  if (!signatureHeader) {
    return false;
  }

  const expectedSignature = `sha256=${createHmac("sha256", GITHUB_WEBHOOK_SECRET).update(payload).digest("hex")}`;

  try {
    const expected = Buffer.from(expectedSignature);
    const actual = Buffer.from(signatureHeader);
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

async function isEventAlreadyProcessed(eventId: string): Promise<boolean> {
  const existing = await db.query.processedWebhookEvents.findFirst({
    where: eq(processedWebhookEvents.eventId, eventId),
  });
  return !!existing;
}

async function recordProcessedEvent(
  eventId: string,
  eventType: string
): Promise<void> {
  await db
    .insert(processedWebhookEvents)
    .values({
      eventId,
      eventType,
      processedAt: new Date(),
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    })
    .onConflictDoNothing();
}

// ---------------------------------------------------------------------------
// Webhook handler
// ---------------------------------------------------------------------------

export async function handleGitHubAppWebhook(c: Context): Promise<Response> {
  const rawBody = await c.req.text();

  // Verify GitHub signature
  const verified = verifyGitHubSignature(
    rawBody,
    c.req.header("X-Hub-Signature-256")
  );
  if (!verified) {
    logger.warn("GitHub webhook signature verification failed");
    return c.json({ error: "Invalid signature" }, 401);
  }

  const payload = JSON.parse(rawBody) as GitHubWebhookPayload;
  const event = c.req.header("X-GitHub-Event");
  const deliveryId = c.req.header("X-GitHub-Delivery") ?? `gh_${Date.now()}`;

  // Idempotency check
  if (await isEventAlreadyProcessed(deliveryId)) {
    logger.debug({ deliveryId, event }, "Duplicate GitHub webhook — skipping");
    return c.json({ ok: true, duplicate: true });
  }

  logger.info(
    {
      event,
      action: payload.action,
      repo: payload.repository.full_name,
      deliveryId,
    },
    "GitHub App webhook received"
  );

  try {
    switch (event) {
      case "issues":
        await handleIssueEvent(payload);
        break;
      case "pull_request":
        await handlePREvent(payload);
        break;
      case "issue_comment":
      case "pull_request_review_comment":
        await handleCommentEvent(payload);
        break;
      case "push":
        await handlePushEvent(payload);
        break;
      default:
        logger.debug({ event }, "Unhandled GitHub event type");
    }

    await recordProcessedEvent(deliveryId, `github.${event}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ error: msg, event, deliveryId }, "GitHub webhook failed");
    return c.json({ error: "Webhook processing failed" }, 500);
  }

  return c.json({ ok: true });
}

async function handleIssueEvent(payload: GitHubWebhookPayload): Promise<void> {
  if (payload.action !== "opened" && payload.action !== "labeled") {
    return;
  }

  const issue = payload.issue;
  if (!issue) {
    return;
  }

  const hasAutoLabel = issue.labels.some((l) => l.name === AUTO_LABEL);
  if (!hasAutoLabel) {
    return;
  }

  const project = await findProjectByRepo(payload.repository.full_name);
  if (!project) {
    logger.warn(
      { repo: payload.repository.full_name },
      "No project found for repository"
    );
    return;
  }

  const taskId = generateId("task");
  const sessionId = generateId("ses");

  await db.insert(tasks).values({
    id: taskId,
    sessionId,
    projectId: project.id,
    orgId: project.orgId,
    title: `GH#${issue.number}: ${issue.title}`,
    description: issue.body,
    status: "queued",
    priority: 50,
  });

  await agentTaskQueue.add(`github-issue-${issue.number}`, {
    taskId,
    sessionId,
    projectId: project.id,
    orgId: project.orgId,
    userId: project.orgId,
    title: issue.title,
    description: issue.body,
    mode: "task",
    agentRole: null,
    creditsReserved: 100,
    planTier: "pro",
  });

  logger.info(
    { taskId, issueNumber: issue.number },
    "Task created from GitHub issue"
  );
}

async function handlePREvent(payload: GitHubWebhookPayload): Promise<void> {
  if (payload.action !== "review_requested") {
    return;
  }

  const pr = payload.pull_request;
  if (!pr) {
    return;
  }

  const project = await findProjectByRepo(payload.repository.full_name);
  if (!project) {
    return;
  }

  const taskId = generateId("task");
  const sessionId = generateId("ses");

  await db.insert(tasks).values({
    id: taskId,
    sessionId,
    projectId: project.id,
    orgId: project.orgId,
    title: `Review PR#${pr.number}: ${pr.title}`,
    description: `Review this pull request:\n\n${pr.body ?? "No description"}\n\nBranch: ${pr.head.ref} → ${pr.base.ref}`,
    status: "queued",
    priority: 50,
  });

  await agentTaskQueue.add(`github-pr-review-${pr.number}`, {
    taskId,
    sessionId,
    projectId: project.id,
    orgId: project.orgId,
    userId: project.orgId,
    title: `Review PR#${pr.number}`,
    description: `Review this pull request for code quality, security issues, and convention compliance:\n\n${pr.body ?? ""}`,
    mode: "task",
    agentRole: "security_auditor",
    creditsReserved: 50,
    planTier: "pro",
  });

  logger.info(
    { taskId, prNumber: pr.number },
    "Review task created from GitHub PR"
  );
}

async function handleCommentEvent(
  payload: GitHubWebhookPayload
): Promise<void> {
  const comment = payload.comment;
  if (!comment?.body.includes(BOT_MENTION)) {
    return;
  }

  const project = await findProjectByRepo(payload.repository.full_name);
  if (!project) {
    return;
  }

  const taskDescription = comment.body.replace(BOT_MENTION, "").trim();
  if (!taskDescription) {
    return;
  }

  const taskId = generateId("task");
  const sessionId = generateId("ses");

  await db.insert(tasks).values({
    id: taskId,
    sessionId,
    projectId: project.id,
    orgId: project.orgId,
    title: `GitHub comment task from ${payload.sender.login}`,
    description: taskDescription,
    status: "queued",
    priority: 50,
  });

  await agentTaskQueue.add(`github-comment-${Date.now()}`, {
    taskId,
    sessionId,
    projectId: project.id,
    orgId: project.orgId,
    userId: project.orgId,
    title: "GitHub comment task",
    description: taskDescription,
    mode: "ask",
    agentRole: null,
    creditsReserved: 20,
    planTier: "pro",
  });

  logger.info(
    { taskId, sender: payload.sender.login },
    "Task created from GitHub comment"
  );
}

async function handlePushEvent(payload: GitHubWebhookPayload): Promise<void> {
  const project = await findProjectByRepo(payload.repository.full_name);
  if (!project) {
    return;
  }

  // Collect all changed file paths from push commits
  const changedFiles = new Set<string>();
  if (payload.commits) {
    for (const commit of payload.commits) {
      for (const f of commit.added) {
        changedFiles.add(f);
      }
      for (const f of commit.modified) {
        changedFiles.add(f);
      }
      for (const f of commit.removed) {
        changedFiles.add(f);
      }
    }
  }

  const filePaths = Array.from(changedFiles);

  await indexingQueue.add(
    "index-project",
    {
      projectId: project.id,
      orgId: project.orgId,
      filePaths,
      fullReindex: filePaths.length === 0,
      triggeredBy: "push",
    },
    { jobId: `index-${project.id}-push-${Date.now()}` }
  );

  logger.info(
    {
      projectId: project.id,
      ref: payload.ref,
      changedFileCount: filePaths.length,
    },
    "Re-index triggered from GitHub push event"
  );
}

async function findProjectByRepo(
  repoFullName: string
): Promise<{ id: string; orgId: string } | null> {
  const result = await db
    .select({ id: projects.id, orgId: projects.orgId })
    .from(projects)
    .where(eq(projects.repoUrl, `https://github.com/${repoFullName}`))
    .limit(1);

  return result[0] ?? null;
}
