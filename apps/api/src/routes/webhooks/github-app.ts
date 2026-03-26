/**
 * GitHub App Webhook Handler
 *
 * Handles PR/issue events from GitHub App installation.
 * Auto-creates tasks for:
 * - New issues with specific labels (e.g., "prometheus-auto", "prometheus")
 * - PR review requests
 * - PR review responses (triggers PRReviewResponder pipeline)
 * - PR comments mentioning @prometheus-bot
 * - Push events (trigger re-index)
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import {
  db,
  processedWebhookEvents,
  projects,
  syncedIssues,
  tasks,
} from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { agentTaskQueue, indexingQueue } from "@prometheus/queue";
import { generateId } from "@prometheus/utils";
import { and, eq } from "drizzle-orm";
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
  repository?: {
    full_name: string;
    clone_url: string;
  };
  review?: {
    body: string;
    state: string;
    user: { login: string };
  };
  sender: { login: string };
}

const AUTO_LABEL = "prometheus-auto";
const PROMETHEUS_LABEL = "prometheus";
const BOT_MENTION = "@prometheus-bot";
const BOT_USERS = new Set([
  "prometheus-bot",
  "prometheus[bot]",
  "prometheus-ai",
]);

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

  let payload: GitHubWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as GitHubWebhookPayload;
  } catch {
    logger.warn("Invalid JSON in GitHub App webhook body");
    return c.json({ error: "Invalid JSON" }, 400);
  }
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
      repo: payload.repository?.full_name ?? "unknown",
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
      case "pull_request_review":
        await handlePRReviewEvent(payload);
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

  // Trigger on either "prometheus-auto" or "prometheus" labels
  const hasAutoLabel = issue.labels.some(
    (l) => l.name === AUTO_LABEL || l.name === PROMETHEUS_LABEL
  );
  if (!hasAutoLabel) {
    return;
  }

  if (!payload.repository) {
    logger.warn("Issue event missing repository field");
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

  // Upsert synced issue record to track the link
  const existingSynced = await db.query.syncedIssues.findFirst({
    where: and(
      eq(syncedIssues.projectId, project.id),
      eq(syncedIssues.provider, "github"),
      eq(syncedIssues.externalId, String(issue.number))
    ),
  });

  if (existingSynced) {
    await db
      .update(syncedIssues)
      .set({
        taskId,
        sessionId,
        assignedToAgent: true,
        title: issue.title,
        body: issue.body,
        lastSyncedAt: new Date(),
      })
      .where(eq(syncedIssues.id, existingSynced.id));
  } else {
    await db.insert(syncedIssues).values({
      id: generateId("si"),
      projectId: project.id,
      orgId: project.orgId,
      provider: "github",
      externalId: String(issue.number),
      externalUrl: `https://github.com/${payload.repository.full_name}/issues/${issue.number}`,
      title: issue.title,
      body: issue.body,
      externalStatus: "open",
      taskId,
      sessionId,
      assignedToAgent: true,
      lastSyncedAt: new Date(),
    });
  }

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
    "Task created from GitHub issue (IssueResolver pipeline triggered)"
  );
}

async function handlePREvent(payload: GitHubWebhookPayload): Promise<void> {
  if (payload.action !== "review_requested") {
    return;
  }

  const pr = payload.pull_request;
  if (!(pr && payload.repository)) {
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

/**
 * Handle pull_request_review events — triggers PRReviewResponder pipeline.
 * Enqueues an agent task to process review comments and respond.
 */
async function handlePRReviewEvent(
  payload: GitHubWebhookPayload
): Promise<void> {
  if (payload.action !== "submitted") {
    return;
  }

  const review = payload.review;
  const pr = payload.pull_request;
  if (!(review && pr && payload.repository)) {
    return;
  }

  // Skip reviews from the bot itself to prevent loops
  if (BOT_USERS.has(review.user.login.toLowerCase())) {
    logger.debug(
      { reviewer: review.user.login },
      "Skipping self-review from bot"
    );
    return;
  }

  // Only respond to reviews on PRs created by our bot or reviews requesting changes
  if (review.state !== "changes_requested" && review.state !== "commented") {
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
    title: `Respond to PR#${pr.number} review from ${review.user.login}`,
    description: `Review state: ${review.state}\nReview body: ${review.body ?? "No comment"}\n\nPR: ${pr.title}\nBranch: ${pr.head.ref} → ${pr.base.ref}`,
    status: "queued",
    priority: 60,
  });

  await agentTaskQueue.add(
    `github-pr-review-response-${pr.number}-${Date.now()}`,
    {
      taskId,
      sessionId,
      projectId: project.id,
      orgId: project.orgId,
      userId: project.orgId,
      title: `Respond to PR review on PR#${pr.number}`,
      description: `Process review feedback and apply requested changes:\n\n${review.body ?? ""}`,
      mode: "task",
      agentRole: null,
      creditsReserved: 50,
      planTier: "pro",
    }
  );

  logger.info(
    {
      taskId,
      prNumber: pr.number,
      reviewer: review.user.login,
      state: review.state,
    },
    "PRReviewResponder task created from GitHub PR review"
  );
}

async function handleCommentEvent(
  payload: GitHubWebhookPayload
): Promise<void> {
  const comment = payload.comment;
  if (!(comment?.body.includes(BOT_MENTION) && payload.repository)) {
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
  if (!payload.repository) {
    return;
  }
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
