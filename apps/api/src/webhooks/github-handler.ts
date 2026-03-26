/**
 * GitHub Webhook Handler
 *
 * Processes inbound GitHub webhooks for task creation:
 * - pull_request.opened -> Create code review task with PR details
 * - issues.labeled (label: "prometheus") -> Create implementation task
 * - issues.assigned (assigned to prometheus bot) -> Create implementation task
 * - pull_request_review.submitted -> Respond to PR review feedback
 * - pull_request_review_comment.created -> Respond to review comments
 * - push to default branch -> Create CI/test task for changed files
 *
 * Webhook signature verification uses HMAC SHA-256 with GITHUB_WEBHOOK_SECRET.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import {
  db,
  oauthTokens,
  projectRepositories,
  projects,
  sessions,
  syncedIssues,
  tasks,
} from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { agentTaskQueue } from "@prometheus/queue";
import type { AgentRole } from "@prometheus/types";
import { generateId } from "@prometheus/utils";
import { and, eq } from "drizzle-orm";
import type { Context } from "hono";

const logger = createLogger("api:webhooks:github-handler");

const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET ?? "";
const PROMETHEUS_LABEL = "prometheus";
const BOT_USERS = new Set([
  "prometheus-bot",
  "prometheus[bot]",
  "prometheus-ai",
]);

// ---------------------------------------------------------------------------
// Signature verification (HMAC SHA-256)
// ---------------------------------------------------------------------------

function verifyGitHubSignature(body: string, signature: string): boolean {
  if (!GITHUB_WEBHOOK_SECRET) {
    logger.warn("GITHUB_WEBHOOK_SECRET not configured — rejecting webhook");
    return false;
  }

  if (!signature) {
    return false;
  }

  const expectedSig = `sha256=${createHmac("sha256", GITHUB_WEBHOOK_SECRET).update(body).digest("hex")}`;

  try {
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
  assignee?: { login: string };
  issue: {
    body: string | null;
    html_url: string;
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

interface GitHubPRReviewPayload {
  action: string;
  pull_request: {
    base: { ref: string };
    head: { ref: string; sha: string };
    html_url: string;
    number: number;
    title: string;
    user: { login: string };
  };
  repository: { full_name: string };
  review: {
    body: string | null;
    state: string;
    user: { login: string };
  };
}

interface GitHubCheckSuitePayload {
  action: string;
  check_suite: {
    conclusion: string | null;
    head_sha: string;
    id: number;
    pull_requests: Array<{
      head: { ref: string };
      number: number;
    }>;
  };
  repository: { default_branch: string; full_name: string };
}

interface GitHubWorkflowRunPayload {
  action: string;
  repository: { default_branch: string; full_name: string };
  workflow_run: {
    conclusion: string | null;
    head_branch: string;
    head_sha: string;
    html_url: string;
    id: number;
    logs_url: string;
    name: string;
  };
}

interface GitHubPRReviewCommentPayload {
  action: string;
  comment: {
    body: string;
    diff_hunk: string;
    id: number;
    path: string;
    position: number | null;
    user: { login: string };
  };
  pull_request: {
    head: { ref: string };
    html_url: string;
    number: number;
    title: string;
    user: { login: string };
  };
  repository: { full_name: string };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function findProjectByRepo(
  repoFullName: string
): Promise<{ id: string; orgId: string } | null> {
  const repoUrl = `https://github.com/${repoFullName}`;

  // First try the projects.repoUrl field
  const projectResult = await db
    .select({ id: projects.id, orgId: projects.orgId })
    .from(projects)
    .where(eq(projects.repoUrl, repoUrl))
    .limit(1);

  if (projectResult[0]) {
    return projectResult[0];
  }

  // Fallback: check the projectRepositories table
  const repoResult = await db
    .select({
      projectId: projectRepositories.projectId,
      orgId: projectRepositories.orgId,
    })
    .from(projectRepositories)
    .where(eq(projectRepositories.repoUrl, repoUrl))
    .limit(1);

  if (repoResult[0]) {
    return { id: repoResult[0].projectId, orgId: repoResult[0].orgId };
  }

  return null;
}

/**
 * Get a GitHub OAuth token for the given org.
 */
async function getGitHubTokenForOrg(orgId: string): Promise<string | null> {
  const tokenRecord = await db.query.oauthTokens.findFirst({
    where: and(
      eq(oauthTokens.orgId, orgId),
      eq(oauthTokens.provider, "github")
    ),
  });
  return tokenRecord?.accessToken ?? null;
}

/**
 * Post a comment on a GitHub issue or PR.
 */
async function postIssueComment(
  repoFullName: string,
  issueNumber: number,
  body: string,
  orgId: string
): Promise<void> {
  const token = await getGitHubTokenForOrg(orgId);
  if (!token) {
    logger.warn(
      { orgId },
      "No GitHub token available for org — cannot post comment"
    );
    return;
  }

  try {
    const response = await fetch(
      `https://api.github.com/repos/${repoFullName}/issues/${issueNumber}/comments`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({
          body: `**Prometheus Agent**\n\n${body}`,
        }),
      }
    );

    if (!response.ok) {
      logger.warn(
        { status: response.status, repoFullName, issueNumber },
        "Failed to post GitHub comment"
      );
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn({ error: msg }, "Failed to post GitHub comment");
  }
}

async function createWebhookTask(params: {
  agentRole: AgentRole | null;
  credits: number;
  description: string;
  metadata?: Record<string, unknown>;
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
    metadata: {
      source: "github",
      prNumber: pr.number,
      prUrl: pr.html_url,
      repoFullName: payload.repository.full_name,
    },
  });

  logger.info(
    { taskId, prNumber: pr.number, repo: payload.repository.full_name },
    "Code review task created from GitHub PR"
  );
}

/**
 * Handle issues.labeled and issues.assigned events.
 * Creates an implementation task and posts an acknowledgment comment.
 */
async function handleIssueEvent(payload: GitHubIssuePayload): Promise<void> {
  const issue = payload.issue;
  const repoFullName = payload.repository.full_name;

  // For "labeled" events: check if the prometheus label was added
  if (payload.action === "labeled") {
    const hasPrometheusLabel = issue.labels.some(
      (l) => l.name === PROMETHEUS_LABEL
    );
    if (!hasPrometheusLabel) {
      return;
    }
  }

  // For "assigned" events: check if assigned to a prometheus bot user
  if (payload.action === "assigned") {
    const assigneeLogin = payload.assignee?.login?.toLowerCase() ?? "";
    if (!BOT_USERS.has(assigneeLogin)) {
      return;
    }
  }

  const project = await findProjectByRepo(repoFullName);
  if (!project) {
    logger.warn({ repo: repoFullName }, "No project found for GitHub repo");
    return;
  }

  const issueUrl =
    issue.html_url ??
    `https://github.com/${repoFullName}/issues/${issue.number}`;

  const description = [
    `Implement issue #${issue.number}: ${issue.title}`,
    `Author: ${issue.user.login}`,
    `URL: ${issueUrl}`,
    "",
    issue.body ?? "No description provided.",
  ].join("\n");

  // Create a synced issue record
  const existingSynced = await db.query.syncedIssues.findFirst({
    where: and(
      eq(syncedIssues.projectId, project.id),
      eq(syncedIssues.provider, "github"),
      eq(syncedIssues.externalId, String(issue.number))
    ),
  });

  const { taskId, sessionId } = await createWebhookTask({
    projectId: project.id,
    orgId: project.orgId,
    title: `GH #${issue.number}: ${issue.title}`,
    description,
    priority: 50,
    agentRole: null,
    credits: 100,
    queueName: `github-issue-${issue.number}`,
    metadata: {
      source: "github",
      issueNumber: issue.number,
      issueUrl,
      repoFullName,
    },
  });

  // Upsert synced issue
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
      externalUrl: issueUrl,
      title: issue.title,
      body: issue.body,
      externalStatus: "open",
      taskId,
      sessionId,
      assignedToAgent: true,
      lastSyncedAt: new Date(),
    });
  }

  // Post acknowledgment comment on the issue
  await postIssueComment(
    repoFullName,
    issue.number,
    "Working on this! I'll create a PR when ready.",
    project.orgId
  );

  logger.info(
    { taskId, issueNumber: issue.number, repo: repoFullName },
    "Implementation task created from GitHub issue"
  );
}

/**
 * Handle pull_request_review events.
 * When a review is submitted on a Prometheus-created PR, create a task
 * to address the feedback.
 */
async function handlePRReview(payload: GitHubPRReviewPayload): Promise<void> {
  const review = payload.review;
  const pr = payload.pull_request;
  const repoFullName = payload.repository.full_name;

  if (payload.action !== "submitted") {
    return;
  }

  // Skip reviews from the bot itself to prevent loops
  if (BOT_USERS.has(review.user.login.toLowerCase())) {
    logger.debug({ reviewer: review.user.login }, "Skipping self-review");
    return;
  }

  // Only respond to change requests and comments
  if (review.state !== "changes_requested" && review.state !== "commented") {
    return;
  }

  const project = await findProjectByRepo(repoFullName);
  if (!project) {
    return;
  }

  const description = [
    `Respond to ${review.state === "changes_requested" ? "change request" : "review comment"} on PR #${pr.number}`,
    `Reviewer: ${review.user.login}`,
    `PR: ${pr.title}`,
    `Branch: ${pr.head.ref}`,
    `URL: ${pr.html_url}`,
    "",
    "Review comment:",
    review.body ?? "No comment body.",
  ].join("\n");

  const { taskId } = await createWebhookTask({
    projectId: project.id,
    orgId: project.orgId,
    title: `Review response: PR #${pr.number} — ${review.user.login}`,
    description,
    priority: 60,
    agentRole: null,
    credits: 50,
    queueName: `github-pr-review-${pr.number}-${Date.now()}`,
    metadata: {
      source: "github",
      prNumber: pr.number,
      prUrl: pr.html_url,
      repoFullName,
      reviewState: review.state,
      reviewerLogin: review.user.login,
    },
  });

  logger.info(
    {
      taskId,
      prNumber: pr.number,
      reviewer: review.user.login,
      state: review.state,
    },
    "PR review response task created"
  );
}

/**
 * Handle pull_request_review_comment events.
 * When a review comment is posted on a Prometheus-created PR, create a task
 * to address the specific comment.
 */
async function handlePRReviewComment(
  payload: GitHubPRReviewCommentPayload
): Promise<void> {
  if (payload.action !== "created") {
    return;
  }

  const comment = payload.comment;
  const pr = payload.pull_request;
  const repoFullName = payload.repository.full_name;

  // Skip comments from the bot itself
  if (BOT_USERS.has(comment.user.login.toLowerCase())) {
    return;
  }

  const project = await findProjectByRepo(repoFullName);
  if (!project) {
    return;
  }

  const description = [
    `Address review comment on PR #${pr.number}: ${pr.title}`,
    `Commenter: ${comment.user.login}`,
    `File: ${comment.path}`,
    `Branch: ${pr.head.ref}`,
    "",
    "Comment:",
    comment.body,
    "",
    "Diff context:",
    comment.diff_hunk,
  ].join("\n");

  const { taskId } = await createWebhookTask({
    projectId: project.id,
    orgId: project.orgId,
    title: `Review comment: PR #${pr.number} — ${comment.path}`,
    description,
    priority: 55,
    agentRole: null,
    credits: 30,
    queueName: `github-review-comment-${pr.number}-${comment.id}`,
    metadata: {
      source: "github",
      prNumber: pr.number,
      prUrl: pr.html_url,
      repoFullName,
      commentId: comment.id,
      commentPath: comment.path,
      commenterLogin: comment.user.login,
    },
  });

  logger.info(
    {
      taskId,
      prNumber: pr.number,
      commentId: comment.id,
      commenter: comment.user.login,
    },
    "PR review comment response task created"
  );
}

/**
 * Handle check_suite.completed with conclusion "failure".
 * Fetches CI logs and creates a fix task.
 */
async function handleCheckSuiteFailure(
  payload: GitHubCheckSuitePayload
): Promise<void> {
  const suite = payload.check_suite;
  const repoFullName = payload.repository.full_name;

  if (suite.conclusion !== "failure") {
    return;
  }

  const project = await findProjectByRepo(repoFullName);
  if (!project) {
    logger.warn(
      { repo: repoFullName },
      "No project found for failed check suite"
    );
    return;
  }

  const prInfo = suite.pull_requests[0];
  const branch = prInfo?.head?.ref ?? payload.repository.default_branch;
  const prNumber = prInfo?.number ?? null;

  const description = [
    `Fix CI failure: Check Suite #${suite.id}`,
    `Repository: ${repoFullName}`,
    `Commit: ${suite.head_sha}`,
    `Branch: ${branch}`,
    prNumber ? `PR: #${prNumber}` : "",
    "",
    "The check suite reported a failure. Investigate the CI logs, identify the root cause, and apply a fix.",
  ]
    .filter(Boolean)
    .join("\n");

  const { taskId } = await createWebhookTask({
    projectId: project.id,
    orgId: project.orgId,
    title: `Fix CI failure: Check Suite #${suite.id}`,
    description,
    priority: 70,
    agentRole: null,
    credits: 80,
    queueName: `github-ci-fix-${suite.id}`,
    metadata: {
      source: "github",
      eventType: "check_suite_failure",
      checkSuiteId: suite.id,
      sha: suite.head_sha,
      branch,
      prNumber,
      repoFullName,
    },
  });

  // Post comment on the commit
  await postCommitComment(
    repoFullName,
    suite.head_sha,
    "CI failed. Prometheus is investigating...",
    project.orgId
  );

  logger.info(
    { taskId, checkSuiteId: suite.id, repo: repoFullName },
    "CI fix task created from check_suite failure"
  );
}

/**
 * Handle workflow_run.completed with conclusion "failure".
 * Fetches workflow logs and creates a fix task.
 */
async function handleWorkflowRunFailure(
  payload: GitHubWorkflowRunPayload
): Promise<void> {
  const run = payload.workflow_run;
  const repoFullName = payload.repository.full_name;

  if (run.conclusion !== "failure") {
    return;
  }

  const project = await findProjectByRepo(repoFullName);
  if (!project) {
    logger.warn(
      { repo: repoFullName },
      "No project found for failed workflow run"
    );
    return;
  }

  const description = [
    `Fix CI failure: ${run.name}`,
    `Repository: ${repoFullName}`,
    `Commit: ${run.head_sha}`,
    `Branch: ${run.head_branch}`,
    `Run URL: ${run.html_url}`,
    `Run ID: ${run.id}`,
    "",
    `The workflow "${run.name}" failed. Fetch the CI logs, diagnose the failure, and apply a fix.`,
    "",
    `Logs URL: ${run.logs_url}`,
  ].join("\n");

  const { taskId } = await createWebhookTask({
    projectId: project.id,
    orgId: project.orgId,
    title: `Fix CI failure: ${run.name}`,
    description,
    priority: 70,
    agentRole: null,
    credits: 80,
    queueName: `github-ci-fix-${run.id}`,
    metadata: {
      source: "github",
      eventType: "workflow_run_failure",
      workflowRunId: run.id,
      workflowName: run.name,
      sha: run.head_sha,
      branch: run.head_branch,
      runUrl: run.html_url,
      logsUrl: run.logs_url,
      repoFullName,
    },
  });

  // Post comment on the commit
  await postCommitComment(
    repoFullName,
    run.head_sha,
    `CI failed on workflow **${run.name}**. Prometheus is investigating...`,
    project.orgId
  );

  logger.info(
    {
      taskId,
      workflowRunId: run.id,
      workflowName: run.name,
      repo: repoFullName,
    },
    "CI fix task created from workflow_run failure"
  );
}

/**
 * Post a comment on a GitHub commit.
 */
async function postCommitComment(
  repoFullName: string,
  sha: string,
  body: string,
  orgId: string
): Promise<void> {
  const token = await getGitHubTokenForOrg(orgId);
  if (!token) {
    logger.warn(
      { orgId },
      "No GitHub token available for org — cannot post commit comment"
    );
    return;
  }

  try {
    const response = await fetch(
      `https://api.github.com/repos/${repoFullName}/commits/${sha}/comments`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({
          body: `**Prometheus Agent**\n\n${body}`,
        }),
      }
    );

    if (!response.ok) {
      logger.warn(
        { status: response.status, repoFullName, sha },
        "Failed to post commit comment"
      );
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn({ error: msg }, "Failed to post commit comment");
  }
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
    metadata: {
      source: "github",
      repoFullName: payload.repository.full_name,
      ref: pushRef,
      commitCount: payload.commits.length,
    },
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
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    logger.warn("Invalid JSON in GitHub webhook body");
    return c.json({ error: "Invalid JSON" }, 400);
  }

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
          issuePayload.action === "opened" ||
          issuePayload.action === "assigned"
        ) {
          await handleIssueEvent(issuePayload);
        }
        break;
      }
      case "pull_request_review": {
        const reviewPayload = payload as unknown as GitHubPRReviewPayload;
        await handlePRReview(reviewPayload);
        break;
      }
      case "pull_request_review_comment": {
        const commentPayload =
          payload as unknown as GitHubPRReviewCommentPayload;
        await handlePRReviewComment(commentPayload);
        break;
      }
      case "push": {
        const pushPayload = payload as unknown as GitHubPushPayload;
        await handlePushToDefault(pushPayload);
        break;
      }
      case "check_suite": {
        const checkSuitePayload = payload as unknown as GitHubCheckSuitePayload;
        if (checkSuitePayload.action === "completed") {
          await handleCheckSuiteFailure(checkSuitePayload);
        }
        break;
      }
      case "workflow_run": {
        const workflowRunPayload =
          payload as unknown as GitHubWorkflowRunPayload;
        if (workflowRunPayload.action === "completed") {
          await handleWorkflowRunFailure(workflowRunPayload);
        }
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
