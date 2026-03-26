/**
 * GitHub App Webhook Handler
 *
 * Handles PR/issue events from GitHub App installation.
 * Auto-creates tasks for:
 * - New issues with specific labels (e.g., "prometheus-auto", "prometheus")
 * - PR review requests
 * - PR comments mentioning @prometheus-bot
 *
 * Also reports status checks back to GitHub for PR-related tasks.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import {
  db,
  processedWebhookEvents,
  projects,
  sessions,
  tasks,
} from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { agentTaskQueue } from "@prometheus/queue";
import { generateId } from "@prometheus/utils";
import { eq } from "drizzle-orm";
import { Hono } from "hono";

const logger = createLogger("api:webhooks:github-app");

const GITHUB_APP_WEBHOOK_SECRET = process.env.GITHUB_APP_WEBHOOK_SECRET ?? "";

// ---------------------------------------------------------------------------
// HMAC signature verification
// ---------------------------------------------------------------------------

function verifyGitHubAppSignature(body: string, signature: string): boolean {
  if (!GITHUB_APP_WEBHOOK_SECRET) {
    logger.warn(
      "GITHUB_APP_WEBHOOK_SECRET not configured, skipping verification"
    );
    return false;
  }

  const expectedSig = `sha256=${createHmac("sha256", GITHUB_APP_WEBHOOK_SECRET).update(body).digest("hex")}`;

  if (expectedSig.length !== signature.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(expectedSig), Buffer.from(signature));
}

// ---------------------------------------------------------------------------
// Idempotency via X-GitHub-Delivery header
// ---------------------------------------------------------------------------

async function isDeliveryAlreadyProcessed(
  deliveryId: string
): Promise<boolean> {
  const existing = await db.query.processedWebhookEvents.findFirst({
    where: eq(processedWebhookEvents.eventId, deliveryId),
  });
  return !!existing;
}

async function recordDelivery(
  deliveryId: string,
  eventType: string
): Promise<void> {
  const ttlMs = 48 * 60 * 60 * 1000;
  await db
    .insert(processedWebhookEvents)
    .values({
      eventId: deliveryId,
      eventType,
      processedAt: new Date(),
      expiresAt: new Date(Date.now() + ttlMs),
    })
    .onConflictDoNothing();
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GitHubWebhookPayload {
  action: string;
  comment?: {
    body: string;
    user: { login: string };
  };
  installation?: { id: number };
  issue?: {
    body: string;
    labels: Array<{ name: string }>;
    number: number;
    title: string;
    user: { login: string };
  };
  pull_request?: {
    base: { ref: string };
    body: string;
    head: { ref: string; sha: string };
    number: number;
    title: string;
    user: { login: string };
  };
  repository: {
    clone_url: string;
    full_name: string;
  };
  sender: { login: string };
}

const AUTO_LABEL = "prometheus-auto";
const PROMETHEUS_LABEL = "prometheus";
const BOT_MENTION = "@prometheus-bot";

// ---------------------------------------------------------------------------
// Status Check Reporting
// ---------------------------------------------------------------------------

/**
 * Report a commit status check back to GitHub via the API.
 * This lets PR authors see that Prometheus picked up their task.
 */
async function reportStatusCheck(params: {
  repo: string;
  sha: string;
  state: "pending" | "success" | "failure" | "error";
  description: string;
  targetUrl?: string;
  context?: string;
}): Promise<void> {
  const token = process.env.GITHUB_APP_TOKEN;
  if (!token) {
    logger.debug("GITHUB_APP_TOKEN not set, skipping status check report");
    return;
  }

  try {
    const response = await fetch(
      `https://api.github.com/repos/${params.repo}/statuses/${params.sha}`,
      {
        method: "POST",
        headers: {
          Authorization: `token ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "Prometheus-GitHub-App/1.0",
        },
        body: JSON.stringify({
          state: params.state,
          description: params.description.slice(0, 140),
          target_url: params.targetUrl ?? "",
          context: params.context ?? "prometheus/agent",
        }),
      }
    );

    if (response.ok) {
      logger.info(
        { repo: params.repo, sha: params.sha, state: params.state },
        "GitHub status check reported"
      );
    } else {
      logger.warn(
        { repo: params.repo, sha: params.sha, status: response.status },
        "Failed to report GitHub status check"
      );
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn({ error: msg }, "Could not report GitHub status check");
  }
}

// ---------------------------------------------------------------------------
// Hono App
// ---------------------------------------------------------------------------

const githubAppWebhookApp = new Hono();

githubAppWebhookApp.post("/", async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header("x-hub-signature-256") ?? "";
  const event = c.req.header("x-github-event") ?? "";
  const deliveryId = c.req.header("x-github-delivery") ?? "";

  // Verify HMAC signature
  if (!verifyGitHubAppSignature(rawBody, signature)) {
    logger.warn("Invalid GitHub App webhook signature");
    return c.json({ error: "Invalid signature" }, 401);
  }

  // Idempotency check via delivery ID
  if (deliveryId) {
    const alreadyProcessed = await isDeliveryAlreadyProcessed(deliveryId);
    if (alreadyProcessed) {
      logger.info(
        { deliveryId },
        "Duplicate GitHub App webhook delivery, skipping"
      );
      return c.json({ ok: true, duplicate: true });
    }
  }

  const payload = JSON.parse(rawBody) as GitHubWebhookPayload;

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
      default:
        logger.debug({ event }, "Unhandled GitHub App event type");
    }

    // Record delivery after successful processing
    if (deliveryId) {
      await recordDelivery(deliveryId, `${event}.${payload.action}`);
    }

    return c.json({ ok: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(
      { error: msg, event, deliveryId },
      "GitHub App webhook processing failed"
    );
    return c.json({ error: "Webhook processing failed" }, 500);
  }
});

async function handleIssueEvent(payload: GitHubWebhookPayload): Promise<void> {
  if (payload.action !== "opened" && payload.action !== "labeled") {
    return;
  }

  const issue = payload.issue;
  if (!issue) {
    return;
  }

  // Accept either "prometheus-auto" or "prometheus" label
  const hasAutoLabel = issue.labels.some(
    (l) => l.name === AUTO_LABEL || l.name === PROMETHEUS_LABEL
  );
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
  if (payload.action !== "review_requested" && payload.action !== "opened") {
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
    title: `Review PR#${pr.number}: ${pr.title}`,
    description: `Review this pull request:\n\n${pr.body ?? "No description"}\n\nBranch: ${pr.head.ref} -> ${pr.base.ref}`,
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

  // Report pending status check on the PR head SHA
  await reportStatusCheck({
    repo: payload.repository.full_name,
    sha: pr.head.sha,
    state: "pending",
    description: `Prometheus agent reviewing PR #${pr.number}`,
    context: "prometheus/review",
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

export { githubAppWebhookApp, reportStatusCheck };
