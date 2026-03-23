/**
 * GitHub App Webhook Handler
 *
 * Handles PR/issue events from GitHub App installation.
 * Auto-creates tasks for:
 * - New issues with specific labels (e.g., "prometheus-auto")
 * - PR review requests
 * - PR comments mentioning @prometheus-bot
 */

import { db, projects, tasks } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { agentTaskQueue } from "@prometheus/queue";
import { generateId } from "@prometheus/utils";
import { eq } from "drizzle-orm";
import type { Context } from "hono";

const logger = createLogger("api:webhooks:github-app");

interface GitHubWebhookPayload {
  action: string;
  comment?: {
    body: string;
    user: { login: string };
  };
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
  repository: {
    full_name: string;
    clone_url: string;
  };
  sender: { login: string };
}

const AUTO_LABEL = "prometheus-auto";
const BOT_MENTION = "@prometheus-bot";

export async function handleGitHubAppWebhook(c: Context): Promise<Response> {
  const event = c.req.header("X-GitHub-Event");
  const payload = (await c.req.json()) as GitHubWebhookPayload;

  logger.info(
    {
      event,
      action: payload.action,
      repo: payload.repository.full_name,
    },
    "GitHub App webhook received"
  );

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
      logger.debug({ event }, "Unhandled GitHub event type");
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
