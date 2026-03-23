/**
 * GitHub Webhook Handler
 *
 * Processes inbound GitHub webhooks for task creation:
 * - pull_request.opened -> Create code review task with PR details
 * - issues.labeled (label: "prometheus") -> Create implementation task
 * - push to default branch -> Create CI/test task for changed files
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { db, projects, sessions, tasks } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { agentTaskQueue } from "@prometheus/queue";
import type { AgentRole } from "@prometheus/types";
import { generateId } from "@prometheus/utils";
import { eq } from "drizzle-orm";
import type { Context } from "hono";

const logger = createLogger("api:webhooks:github-handler");

const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET ?? "";
const PROMETHEUS_LABEL = "prometheus";

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

function verifyGitHubSignature(body: string, signature: string): boolean {
  if (!GITHUB_WEBHOOK_SECRET) {
    logger.warn("GITHUB_WEBHOOK_SECRET not configured");
    return false;
  }

  const expectedSig = `sha256=${createHmac("sha256", GITHUB_WEBHOOK_SECRET).update(body).digest("hex")}`;

  if (expectedSig.length !== signature.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(expectedSig), Buffer.from(signature));
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GitHubPRPayload {
  action: string;
  pull_request: {
    base: { ref: string };
    body: string | null;
    head: { ref: string; sha: string };
    html_url: string;
    number: number;
    title: string;
    user: { login: string };
  };
  repository: { default_branch: string; full_name: string };
}

interface GitHubIssuePayload {
  action: string;
  issue: {
    body: string | null;
    labels: Array<{ name: string }>;
    number: number;
    title: string;
    user: { login: string };
  };
  repository: { full_name: string };
}

interface GitHubPushPayload {
  commits: Array<{
    added: string[];
    id: string;
    message: string;
    modified: string[];
    removed: string[];
  }>;
  ref: string;
  repository: { default_branch: string; full_name: string };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

async function createWebhookTask(params: {
  agentRole: AgentRole | null;
  credits: number;
  description: string;
  orgId: string;
  priority: number;
  projectId: string;
  queueName: string;
  title: string;
}): Promise<{ sessionId: string; taskId: string }> {
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

  await agentTaskQueue.add(params.queueName, {
    taskId,
    sessionId,
    projectId: params.projectId,
    orgId: params.orgId,
    userId: params.orgId,
    title: params.title,
    description: params.description,
    mode: "task",
    agentRole: params.agentRole,
    creditsReserved: params.credits,
    planTier: "pro",
  });

  return { taskId, sessionId };
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

async function handlePullRequestOpened(
  payload: GitHubPRPayload
): Promise<void> {
  const pr = payload.pull_request;
  const project = await findProjectByRepo(payload.repository.full_name);

  if (!project) {
    logger.warn(
      { repo: payload.repository.full_name },
      "No project found for GitHub repo"
    );
    return;
  }

  const description = [
    `Review PR #${pr.number}: ${pr.title}`,
    `Author: ${pr.user.login}`,
    `Branch: ${pr.head.ref} -> ${pr.base.ref}`,
    `URL: ${pr.html_url}`,
    "",
    pr.body ?? "No description provided.",
  ].join("\n");

  const { taskId } = await createWebhookTask({
    projectId: project.id,
    orgId: project.orgId,
    title: `Code Review: PR #${pr.number} — ${pr.title}`,
    description,
    priority: 60,
    agentRole: "security_auditor",
    credits: 50,
    queueName: `github-pr-${pr.number}`,
  });

  logger.info(
    { taskId, prNumber: pr.number, repo: payload.repository.full_name },
    "Code review task created from GitHub PR"
  );
}

async function handleIssueLabeled(payload: GitHubIssuePayload): Promise<void> {
  const issue = payload.issue;
  const hasPrometheusLabel = issue.labels.some(
    (l) => l.name === PROMETHEUS_LABEL
  );

  if (!hasPrometheusLabel) {
    return;
  }

  const project = await findProjectByRepo(payload.repository.full_name);
  if (!project) {
    logger.warn(
      { repo: payload.repository.full_name },
      "No project found for GitHub repo"
    );
    return;
  }

  const description = [
    `Implement issue #${issue.number}: ${issue.title}`,
    `Author: ${issue.user.login}`,
    "",
    issue.body ?? "No description provided.",
  ].join("\n");

  const { taskId } = await createWebhookTask({
    projectId: project.id,
    orgId: project.orgId,
    title: `GH #${issue.number}: ${issue.title}`,
    description,
    priority: 50,
    agentRole: null,
    credits: 100,
    queueName: `github-issue-${issue.number}`,
  });

  logger.info(
    { taskId, issueNumber: issue.number, repo: payload.repository.full_name },
    "Implementation task created from labeled GitHub issue"
  );
}

async function handlePushToDefault(payload: GitHubPushPayload): Promise<void> {
  const defaultBranch = payload.repository.default_branch;
  const pushRef = payload.ref;

  if (pushRef !== `refs/heads/${defaultBranch}`) {
    return;
  }

  const project = await findProjectByRepo(payload.repository.full_name);
  if (!project) {
    logger.warn(
      { repo: payload.repository.full_name },
      "No project found for GitHub repo"
    );
    return;
  }

  // Collect all changed files across commits
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
    "",
    "Commits:",
    commitMessages,
    "",
    `Changed files (${changedFiles.size}):`,
    `- ${fileList}`,
  ].join("\n");

  const { taskId } = await createWebhookTask({
    projectId: project.id,
    orgId: project.orgId,
    title: `CI: Push to ${defaultBranch} (${payload.commits.length} commits)`,
    description,
    priority: 40,
    agentRole: null,
    credits: 30,
    queueName: `github-push-${Date.now()}`,
  });

  logger.info(
    {
      taskId,
      commitCount: payload.commits.length,
      changedFiles: changedFiles.size,
      repo: payload.repository.full_name,
    },
    "CI/test task created from GitHub push"
  );
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function handleGitHubWebhook(c: Context): Promise<Response> {
  const rawBody = await c.req.text();
  const signature = c.req.header("x-hub-signature-256") ?? "";

  if (!verifyGitHubSignature(rawBody, signature)) {
    logger.warn("Invalid GitHub webhook signature");
    return c.json({ error: "Invalid signature" }, 401);
  }

  const event = c.req.header("x-github-event") ?? "";
  const payload = JSON.parse(rawBody) as Record<string, unknown>;

  try {
    switch (event) {
      case "pull_request": {
        const prPayload = payload as unknown as GitHubPRPayload;
        if (prPayload.action === "opened") {
          await handlePullRequestOpened(prPayload);
        }
        break;
      }
      case "issues": {
        const issuePayload = payload as unknown as GitHubIssuePayload;
        if (
          issuePayload.action === "labeled" ||
          issuePayload.action === "opened"
        ) {
          await handleIssueLabeled(issuePayload);
        }
        break;
      }
      case "push": {
        const pushPayload = payload as unknown as GitHubPushPayload;
        await handlePushToDefault(pushPayload);
        break;
      }
      default:
        logger.debug({ event }, "Unhandled GitHub webhook event");
    }

    return c.json({ ok: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ error: msg, event }, "GitHub webhook processing failed");
    return c.json({ error: "Webhook processing failed" }, 500);
  }
}
