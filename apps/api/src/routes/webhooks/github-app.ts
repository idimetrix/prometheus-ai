/**
 * GitHub App Webhook Route
 *
 * POST /webhooks/github-app
 *
 * Processes inbound GitHub App webhooks with full event handling:
 * - issues.labeled (label = "prometheus" or "prometheus-auto") -> Issue-to-PR pipeline
 * - issues.assigned (assigned to bot) -> Issue-to-PR pipeline
 * - pull_request.opened -> Code review task
 * - pull_request.review_requested -> Code review task
 * - pull_request_review.submitted -> Review response task
 * - pull_request_review_comment.created -> Inline comment response task
 * - issue_comment.created -> Bot mention response
 * - push (to default branch) -> Incremental project indexing
 * - workflow_run.completed (failure) -> CI-fix pipeline
 * - check_suite.completed (failure) -> CI-fix pipeline
 *
 * Signature verification uses HMAC SHA-256 with GITHUB_WEBHOOK_SECRET.
 * Idempotency via X-GitHub-Delivery header stored in processedWebhookEvents.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import {
  db,
  oauthTokens,
  processedWebhookEvents,
  projectRepositories,
  projects,
  syncedIssues,
  tasks,
} from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { agentTaskQueue, indexingQueue } from "@prometheus/queue";
import type { AgentMode, AgentRole } from "@prometheus/types";
import { generateId } from "@prometheus/utils";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";

const logger = createLogger("api:webhooks:github-app");

const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET ?? "";
const PROMETHEUS_LABEL = "prometheus";
const AUTO_LABEL = "prometheus-auto";
const BOT_MENTION = "@prometheus-bot";
const BOT_USERS = new Set([
  "prometheus-bot",
  "prometheus[bot]",
  "prometheus-ai",
]);

// ---------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------

interface GitHubRepository {
  clone_url?: string;
  default_branch?: string;
  full_name: string;
}

interface GitHubUser {
  login: string;
}

interface GitHubIssue {
  body: string | null;
  html_url: string;
  labels: Array<{ name: string }>;
  number: number;
  title: string;
  user: GitHubUser;
}

interface GitHubPullRequest {
  base: { ref: string };
  body: string | null;
  head: { ref: string; sha: string };
  html_url: string;
  number: number;
  title: string;
  user: GitHubUser;
}

interface GitHubWebhookPayload {
  action: string;
  assignee?: GitHubUser;
  check_suite?: {
    conclusion: string | null;
    head_sha: string;
    id: number;
    pull_requests: Array<{ head: { ref: string }; number: number }>;
  };
  comment?: {
    body: string;
    diff_hunk?: string;
    id?: number;
    path?: string;
    position?: number | null;
    user: GitHubUser;
  };
  commits?: Array<{
    added: string[];
    id: string;
    message: string;
    modified: string[];
    removed: string[];
  }>;
  installation?: { id: number };
  issue?: GitHubIssue;
  pull_request?: GitHubPullRequest;
  ref?: string;
  repository?: GitHubRepository;
  review?: {
    body: string | null;
    state: string;
    user: GitHubUser;
  };
  sender: GitHubUser;
  workflow_run?: {
    conclusion: string | null;
    head_branch: string;
    head_sha: string;
    html_url: string;
    id: number;
    logs_url: string;
    name: string;
  };
}

// ---------------------------------------------------------------------------
// Signature verification (HMAC SHA-256)
// ---------------------------------------------------------------------------

function verifyGitHubSignature(
  payload: string,
  signatureHeader: string | undefined
): boolean {
  if (!GITHUB_WEBHOOK_SECRET) {
    logger.warn("GITHUB_WEBHOOK_SECRET not set — rejecting webhook");
    return false;
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
// Helpers
// ---------------------------------------------------------------------------

async function findProjectByRepo(
  repoFullName: string
): Promise<{ id: string; orgId: string } | null> {
  const repoUrl = `https://github.com/${repoFullName}`;

  // Try the projects.repoUrl field first
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
      orgId: projectRepositories.orgId,
      projectId: projectRepositories.projectId,
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
 * Retrieve a GitHub OAuth token for the given organization.
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
 * Post a comment on a GitHub issue or pull request.
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
        "Failed to post GitHub issue comment"
      );
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn({ error: msg }, "Failed to post GitHub issue comment");
  }
}

/**
 * Post a comment on a specific commit SHA.
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

/**
 * Create a task and enqueue it for the agent pipeline.
 */
async function createAndEnqueueTask(params: {
  agentRole: AgentRole | null;
  credits: number;
  description: string;
  metadata?: Record<string, unknown>;
  mode: AgentMode;
  orgId: string;
  priority: number;
  projectId: string;
  queueName: string;
  title: string;
}): Promise<{ sessionId: string; taskId: string }> {
  const taskId = generateId("task");
  const sessionId = generateId("ses");

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
    mode: params.mode,
    agentRole: params.agentRole,
    creditsReserved: params.credits,
    planTier: "pro",
  });

  return { taskId, sessionId };
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

/**
 * Handle issues.labeled and issues.assigned events.
 *
 * For "labeled": triggers when the "prometheus" or "prometheus-auto" label is added.
 * For "assigned": triggers when the issue is assigned to a bot user.
 *
 * Creates an implementation task, syncs the issue record, posts an
 * acknowledgment comment on the issue, and enqueues the agent pipeline.
 */
async function handleIssueEvent(payload: GitHubWebhookPayload): Promise<void> {
  const issue = payload.issue;
  if (!issue) {
    return;
  }

  const repoFullName = payload.repository?.full_name;
  if (!repoFullName) {
    logger.warn("Issue event missing repository field");
    return;
  }

  // For "labeled" events: check if a prometheus label was added
  if (payload.action === "labeled") {
    const hasPrometheusLabel = issue.labels.some(
      (l) => l.name === PROMETHEUS_LABEL || l.name === AUTO_LABEL
    );
    if (!hasPrometheusLabel) {
      return;
    }
  }

  // For "assigned" events: check if assigned to a known bot user
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

  // Upsert synced issue record
  const existingSynced = await db.query.syncedIssues.findFirst({
    where: and(
      eq(syncedIssues.projectId, project.id),
      eq(syncedIssues.provider, "github"),
      eq(syncedIssues.externalId, String(issue.number))
    ),
  });

  const { taskId, sessionId } = await createAndEnqueueTask({
    projectId: project.id,
    orgId: project.orgId,
    title: `GH #${issue.number}: ${issue.title}`,
    description,
    priority: 50,
    agentRole: null,
    credits: 100,
    mode: "task",
    queueName: `github-issue-${issue.number}`,
    metadata: {
      source: "github",
      issueNumber: issue.number,
      issueUrl,
      repoFullName,
    },
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
    "Working on this! I'll analyze the issue and create a PR when ready.",
    project.orgId
  );

  logger.info(
    { taskId, issueNumber: issue.number, repo: repoFullName },
    "Implementation task created from GitHub issue"
  );
}

/**
 * Handle pull_request events.
 *
 * - "opened": Creates a code review task for newly opened PRs.
 * - "review_requested": Creates a code review task when review is requested.
 */
async function handlePREvent(payload: GitHubWebhookPayload): Promise<void> {
  const pr = payload.pull_request;
  if (!(pr && payload.repository)) {
    return;
  }

  const repoFullName = payload.repository.full_name;

  if (payload.action === "opened") {
    // Skip PRs created by the bot itself to prevent loops
    if (BOT_USERS.has(pr.user.login.toLowerCase())) {
      logger.debug({ prAuthor: pr.user.login }, "Skipping self-opened PR");
      return;
    }

    const project = await findProjectByRepo(repoFullName);
    if (!project) {
      logger.warn(
        { repo: repoFullName },
        "No project found for GitHub repo on PR open"
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

    const { taskId } = await createAndEnqueueTask({
      projectId: project.id,
      orgId: project.orgId,
      title: `Code Review: PR #${pr.number} -- ${pr.title}`,
      description,
      priority: 60,
      agentRole: "security_auditor",
      credits: 50,
      mode: "task",
      queueName: `github-pr-${pr.number}`,
      metadata: {
        source: "github",
        prNumber: pr.number,
        prUrl: pr.html_url,
        repoFullName,
      },
    });

    // Post initial review comment on the PR
    await postIssueComment(
      repoFullName,
      pr.number,
      "Prometheus is reviewing this pull request. I'll post my findings shortly.",
      project.orgId
    );

    logger.info(
      { taskId, prNumber: pr.number, repo: repoFullName },
      "Code review task created from PR opened"
    );
    return;
  }

  if (payload.action === "review_requested") {
    const project = await findProjectByRepo(repoFullName);
    if (!project) {
      return;
    }

    const { taskId } = await createAndEnqueueTask({
      projectId: project.id,
      orgId: project.orgId,
      title: `Review PR#${pr.number}: ${pr.title}`,
      description: `Review this pull request:\n\n${pr.body ?? "No description"}\n\nBranch: ${pr.head.ref} -> ${pr.base.ref}`,
      priority: 50,
      agentRole: "security_auditor",
      credits: 50,
      mode: "task",
      queueName: `github-pr-review-${pr.number}`,
      metadata: {
        source: "github",
        prNumber: pr.number,
        prUrl: pr.html_url,
        repoFullName,
      },
    });

    logger.info(
      { taskId, prNumber: pr.number },
      "Review task created from GitHub PR review request"
    );
  }
}

/**
 * Handle pull_request_review.submitted events.
 *
 * When a review with "changes_requested" or "commented" state is submitted,
 * creates a task to address the review feedback.
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

  // Only respond to change requests and comments
  if (review.state !== "changes_requested" && review.state !== "commented") {
    return;
  }

  const repoFullName = payload.repository.full_name;
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

  const { taskId } = await createAndEnqueueTask({
    projectId: project.id,
    orgId: project.orgId,
    title: `Review response: PR #${pr.number} -- ${review.user.login}`,
    description,
    priority: 60,
    agentRole: null,
    credits: 50,
    mode: "task",
    queueName: `github-pr-review-response-${pr.number}-${Date.now()}`,
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
 * Handle pull_request_review_comment.created and issue_comment.created events.
 *
 * For review comments: processes inline code review comments that mention the bot.
 * For issue comments: processes issue comments that mention the bot.
 */
async function handleCommentEvent(
  payload: GitHubWebhookPayload
): Promise<void> {
  if (payload.action !== "created") {
    return;
  }

  const comment = payload.comment;
  if (!comment) {
    return;
  }

  // Skip comments from the bot itself
  if (BOT_USERS.has(comment.user.login.toLowerCase())) {
    return;
  }

  if (!payload.repository) {
    return;
  }

  const repoFullName = payload.repository.full_name;

  // For review comments with diff context, handle them as inline feedback
  if (comment.path && comment.diff_hunk && payload.pull_request) {
    const pr = payload.pull_request;
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

    const { taskId } = await createAndEnqueueTask({
      projectId: project.id,
      orgId: project.orgId,
      title: `Review comment: PR #${pr.number} -- ${comment.path}`,
      description,
      priority: 55,
      agentRole: null,
      credits: 30,
      mode: "task",
      queueName: `github-review-comment-${pr.number}-${comment.id ?? Date.now()}`,
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
    return;
  }

  // For issue/PR comments mentioning the bot
  if (!comment.body.includes(BOT_MENTION)) {
    return;
  }

  const project = await findProjectByRepo(repoFullName);
  if (!project) {
    return;
  }

  const taskDescription = comment.body.replace(BOT_MENTION, "").trim();
  if (!taskDescription) {
    return;
  }

  const issueNumber = payload.issue?.number ?? payload.pull_request?.number;

  const { taskId } = await createAndEnqueueTask({
    projectId: project.id,
    orgId: project.orgId,
    title: `GitHub comment task from ${payload.sender.login}`,
    description: taskDescription,
    priority: 50,
    agentRole: null,
    credits: 20,
    mode: "ask",
    queueName: `github-comment-${Date.now()}`,
    metadata: {
      source: "github",
      repoFullName,
      senderLogin: payload.sender.login,
      issueNumber,
    },
  });

  // Acknowledge the mention with a comment
  if (issueNumber) {
    await postIssueComment(
      repoFullName,
      issueNumber,
      "Got it! Working on your request...",
      project.orgId
    );
  }

  logger.info(
    { taskId, sender: payload.sender.login },
    "Task created from GitHub comment mention"
  );
}

/**
 * Handle push events to the default branch.
 *
 * Triggers incremental project indexing for the changed files.
 */
async function handlePushEvent(payload: GitHubWebhookPayload): Promise<void> {
  if (!payload.repository) {
    return;
  }

  const repoFullName = payload.repository.full_name;
  const defaultBranch = payload.repository.default_branch;

  // Only index pushes to the default branch
  if (defaultBranch && payload.ref !== `refs/heads/${defaultBranch}`) {
    return;
  }

  const project = await findProjectByRepo(repoFullName);
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

  const filePaths = [...changedFiles];

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
    "Incremental re-index triggered from GitHub push"
  );
}

/**
 * Handle workflow_run.completed events where the conclusion is "failure".
 *
 * Creates a CI-fix task that fetches logs and attempts to fix the failure.
 */
async function handleWorkflowRunEvent(
  payload: GitHubWebhookPayload
): Promise<void> {
  if (payload.action !== "completed") {
    return;
  }

  const run = payload.workflow_run;
  if (!run || run.conclusion !== "failure") {
    return;
  }

  if (!payload.repository) {
    return;
  }

  const repoFullName = payload.repository.full_name;
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

  const { taskId } = await createAndEnqueueTask({
    projectId: project.id,
    orgId: project.orgId,
    title: `Fix CI failure: ${run.name}`,
    description,
    priority: 70,
    agentRole: null,
    credits: 80,
    mode: "task",
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
    `CI failed on workflow **${run.name}**. Prometheus is investigating and will attempt a fix.`,
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
 * Handle check_suite.completed events where the conclusion is "failure".
 *
 * Creates a CI-fix task to investigate and fix the failure.
 */
async function handleCheckSuiteEvent(
  payload: GitHubWebhookPayload
): Promise<void> {
  if (payload.action !== "completed") {
    return;
  }

  const suite = payload.check_suite;
  if (!suite || suite.conclusion !== "failure") {
    return;
  }

  if (!payload.repository) {
    return;
  }

  const repoFullName = payload.repository.full_name;
  const project = await findProjectByRepo(repoFullName);
  if (!project) {
    logger.warn(
      { repo: repoFullName },
      "No project found for failed check suite"
    );
    return;
  }

  const prInfo = suite.pull_requests[0];
  const branch =
    prInfo?.head?.ref ?? payload.repository.default_branch ?? "main";
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

  const { taskId } = await createAndEnqueueTask({
    projectId: project.id,
    orgId: project.orgId,
    title: `Fix CI failure: Check Suite #${suite.id}`,
    description,
    priority: 70,
    agentRole: null,
    credits: 80,
    mode: "task",
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
    "CI failed. Prometheus is investigating and will attempt a fix.",
    project.orgId
  );

  logger.info(
    { taskId, checkSuiteId: suite.id, repo: repoFullName },
    "CI fix task created from check_suite failure"
  );
}

// ---------------------------------------------------------------------------
// Hono route
// ---------------------------------------------------------------------------

const githubAppWebhookApp = new Hono();

githubAppWebhookApp.post("/", async (c) => {
  const rawBody = await c.req.text();

  // Verify GitHub HMAC SHA-256 signature
  const verified = verifyGitHubSignature(
    rawBody,
    c.req.header("x-hub-signature-256")
  );
  if (!verified) {
    logger.warn("GitHub App webhook signature verification failed");
    return c.json({ error: "Invalid signature" }, 401);
  }

  let payload: GitHubWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as GitHubWebhookPayload;
  } catch {
    logger.warn("Invalid JSON in GitHub App webhook body");
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const event = c.req.header("x-github-event") ?? "";
  const deliveryId = c.req.header("x-github-delivery") ?? `gh_${Date.now()}`;

  // Idempotency: skip already-processed deliveries
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
      case "workflow_run":
        await handleWorkflowRunEvent(payload);
        break;
      case "check_suite":
        await handleCheckSuiteEvent(payload);
        break;
      case "ping":
        logger.info("GitHub webhook ping received");
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
});

export { githubAppWebhookApp };
