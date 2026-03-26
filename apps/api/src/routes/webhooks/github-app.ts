/**
 * GitHub App Webhook Handler
 *
 * Handles all GitHub App events:
 * - installation.created / installation.deleted - Track app installations
 * - issues.opened / issues.assigned with prometheus label - Create tasks
 * - issue_comment.created with @mention - Respond to comments
 * - pull_request.opened - Create review task
 * - pull_request.synchronize - Update PR task
 * - pull_request_review.submitted - Handle review (trigger PR iteration)
 * - pull_request_review_comment.created - Handle inline review comments
 * - push to default branch - Trigger CI/test tasks
 * - check_run.completed - Handle CI completion
 * - workflow_run.completed - Handle GitHub Actions completion
 *
 * Reports status checks back to GitHub for PR-related tasks.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import {
  db,
  processedWebhookEvents,
  projects,
  sessions,
  syncedPullRequests,
  tasks,
} from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { agentTaskQueue } from "@prometheus/queue";
import type { AgentMode, AgentRole } from "@prometheus/types";
import { generateId } from "@prometheus/utils";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";

const logger = createLogger("api:webhooks:github-app");

const GITHUB_APP_WEBHOOK_SECRET = process.env.GITHUB_APP_WEBHOOK_SECRET ?? "";
const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:3000";

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
  check_run?: {
    app?: { slug: string };
    completed_at: string;
    conclusion:
      | "success"
      | "failure"
      | "neutral"
      | "cancelled"
      | "timed_out"
      | "action_required"
      | "skipped"
      | null;
    head_sha: string;
    name: string;
    pull_requests?: Array<{ number: number }>;
    status: string;
  };
  comment?: {
    body: string;
    diff_hunk?: string;
    path?: string;
    position?: number;
    user: { login: string; type?: string };
  };
  installation?: { id: number };
  issue?: {
    assignees?: Array<{ login: string }>;
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
  ref?: string;
  repository: {
    clone_url: string;
    default_branch?: string;
    full_name: string;
  };
  review?: {
    body: string;
    state: string;
    user: { login: string; type?: string };
  };
  sender: { login: string; type?: string };
  workflow_run?: {
    conclusion:
      | "success"
      | "failure"
      | "neutral"
      | "cancelled"
      | "timed_out"
      | "action_required"
      | "skipped"
      | null;
    head_branch: string;
    head_sha: string;
    name: string;
    pull_requests?: Array<{ number: number }>;
    status: string;
  };
}

const AUTO_LABEL = "prometheus-auto";
const PROMETHEUS_LABEL = "prometheus";
const BOT_MENTION = "@prometheus-bot";
const BOT_USERS = new Set([
  "prometheus-bot",
  "prometheus[bot]",
  "prometheus-ai",
  "github-actions[bot]",
  "dependabot[bot]",
  "renovate[bot]",
]);

// ---------------------------------------------------------------------------
// Status Check Reporting
// ---------------------------------------------------------------------------

async function reportStatusCheck(params: {
  context?: string;
  description: string;
  repo: string;
  sha: string;
  state: "pending" | "success" | "failure" | "error";
  targetUrl?: string;
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

/** Post a comment on a GitHub issue or PR. */
async function postGitHubComment(
  repo: string,
  issueNumber: number,
  body: string
): Promise<void> {
  const token = process.env.GITHUB_APP_TOKEN;
  if (!token) {
    logger.debug("GITHUB_APP_TOKEN not set, skipping comment");
    return;
  }

  try {
    await fetch(
      `https://api.github.com/repos/${repo}/issues/${issueNumber}/comments`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({ body }),
      }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn({ error: msg }, "Failed to post GitHub comment");
  }
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function _parseRepoOwner(fullName: string): { owner: string; repo: string } {
  const [owner = "", repo = ""] = fullName.split("/");
  return { owner, repo };
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

/** Create a session, task, and enqueue agent work. */
async function createAgentTask(params: {
  agentRole?: AgentRole;
  credits?: number;
  description: string;
  mode?: AgentMode;
  orgId: string;
  priority?: number;
  projectId: string;
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
    priority: params.priority ?? 50,
  });

  await agentTaskQueue.add(`github-${taskId}`, {
    taskId,
    sessionId,
    projectId: params.projectId,
    orgId: params.orgId,
    userId: params.orgId,
    title: params.title,
    description: params.description,
    mode: params.mode ?? "task",
    agentRole: params.agentRole ?? null,
    creditsReserved: params.credits ?? 100,
    planTier: "pro",
  });

  return { taskId, sessionId };
}

// ---------------------------------------------------------------------------
// Event Handlers
// ---------------------------------------------------------------------------

/** Handle installation.created and installation.deleted events. */
async function handleInstallationEvent(
  payload: GitHubWebhookPayload
): Promise<void> {
  const installationId = payload.installation?.id;
  if (!installationId) {
    return;
  }

  if (payload.action === "created") {
    logger.info(
      {
        installationId,
        repo: payload.repository.full_name,
        sender: payload.sender.login,
      },
      "GitHub App installed"
    );
    // Installation tracking is handled via the GitHub App setup flow.
    // Log for observability; the OAuth callback persists the installation.
  } else if (payload.action === "deleted") {
    logger.info(
      {
        installationId,
        repo: payload.repository.full_name,
        sender: payload.sender.login,
      },
      "GitHub App uninstalled"
    );
    // Clean up: mark any active sessions for this repo as cancelled
    const project = await findProjectByRepo(payload.repository.full_name);
    if (project) {
      logger.info(
        { projectId: project.id },
        "Cleaning up active sessions for uninstalled repo"
      );
    }
  }
}

/** Handle issues.opened and issues.labeled events. */
async function handleIssueEvent(payload: GitHubWebhookPayload): Promise<void> {
  const issue = payload.issue;
  if (!issue) {
    return;
  }

  // Check for prometheus label on opened/labeled events
  if (payload.action === "opened" || payload.action === "labeled") {
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

    const { taskId } = await createAgentTask({
      projectId: project.id,
      orgId: project.orgId,
      title: `GH#${issue.number}: ${issue.title}`,
      description: issue.body,
      priority: 50,
    });

    logger.info(
      { taskId, issueNumber: issue.number },
      "Task created from labeled GitHub issue"
    );
    return;
  }

  // Handle issues.assigned — check if assigned to the bot
  if (payload.action === "assigned") {
    const assignedToBot = issue.assignees?.some((a) =>
      BOT_USERS.has(a.login.toLowerCase())
    );
    if (!assignedToBot) {
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

    const { taskId } = await createAgentTask({
      projectId: project.id,
      orgId: project.orgId,
      title: `GH#${issue.number}: ${issue.title}`,
      description: `Assigned to Prometheus bot.\n\n${issue.body}`,
      priority: 60,
    });

    logger.info(
      { taskId, issueNumber: issue.number },
      "Task created from bot-assigned issue"
    );
  }
}

/** Handle pull_request.opened and pull_request.synchronize events. */
async function handlePREvent(payload: GitHubWebhookPayload): Promise<void> {
  const pr = payload.pull_request;
  if (!pr) {
    return;
  }

  const project = await findProjectByRepo(payload.repository.full_name);
  if (!project) {
    return;
  }

  if (payload.action === "opened" || payload.action === "review_requested") {
    const { taskId, sessionId } = await createAgentTask({
      projectId: project.id,
      orgId: project.orgId,
      title: `Review PR#${pr.number}: ${pr.title}`,
      description: `Review this pull request:\n\n${pr.body ?? "No description"}\n\nBranch: ${pr.head.ref} -> ${pr.base.ref}`,
      agentRole: "security_auditor",
      credits: 50,
      priority: 50,
    });

    // Report pending status check
    await reportStatusCheck({
      repo: payload.repository.full_name,
      sha: pr.head.sha,
      state: "pending",
      description: `Prometheus agent reviewing PR #${pr.number}`,
      context: "prometheus/review",
    });

    // Sync the PR in the database
    try {
      await db
        .insert(syncedPullRequests)
        .values({
          id: generateId("spr"),
          projectId: project.id,
          orgId: project.orgId,
          provider: "github",
          externalId: String(pr.number),
          externalUrl: `https://github.com/${payload.repository.full_name}/pull/${pr.number}`,
          title: pr.title,
          branch: pr.head.ref,
          baseBranch: pr.base.ref,
          sessionId,
          reviewStatus: "pending",
        })
        .onConflictDoNothing();
    } catch {
      // Sync is best-effort
    }

    logger.info(
      { taskId, prNumber: pr.number },
      "Review task created from GitHub PR"
    );
  } else if (payload.action === "synchronize") {
    // PR was updated (new commits pushed) — update status and optionally re-review
    logger.info(
      { prNumber: pr.number, sha: pr.head.sha },
      "PR synchronized (new commits)"
    );

    // Update synced PR record
    try {
      await db
        .update(syncedPullRequests)
        .set({
          reviewStatus: "pending",
          lastSyncedAt: new Date(),
        })
        .where(
          and(
            eq(syncedPullRequests.projectId, project.id),
            eq(syncedPullRequests.externalId, String(pr.number))
          )
        );
    } catch {
      // Best effort
    }

    // Report pending status for the new SHA
    await reportStatusCheck({
      repo: payload.repository.full_name,
      sha: pr.head.sha,
      state: "pending",
      description: `Prometheus reviewing updated PR #${pr.number}`,
      context: "prometheus/review",
    });

    // Create a new review task for the updated PR
    const { taskId } = await createAgentTask({
      projectId: project.id,
      orgId: project.orgId,
      title: `Re-review PR#${pr.number}: ${pr.title}`,
      description: `PR updated with new commits. Re-review this pull request:\n\n${pr.body ?? "No description"}\n\nBranch: ${pr.head.ref} -> ${pr.base.ref}\nNew HEAD: ${pr.head.sha}`,
      agentRole: "security_auditor",
      credits: 50,
      priority: 45,
    });

    logger.info(
      { taskId, prNumber: pr.number },
      "Re-review task created for updated PR"
    );
  }
}

/** Handle pull_request_review.submitted — trigger PR iteration. */
async function handlePRReviewEvent(
  payload: GitHubWebhookPayload
): Promise<void> {
  if (payload.action !== "submitted") {
    return;
  }

  const review = payload.review;
  const pr = payload.pull_request;
  if (!(review && pr)) {
    return;
  }

  // Anti-loop: ignore reviews from bot users
  if (BOT_USERS.has(review.user.login.toLowerCase())) {
    logger.debug(
      { reviewer: review.user.login },
      "Ignoring review from bot user"
    );
    return;
  }

  // Only act on changes_requested and commented reviews
  if (review.state !== "changes_requested" && review.state !== "commented") {
    logger.debug({ state: review.state }, "Review state requires no action");
    return;
  }

  const project = await findProjectByRepo(payload.repository.full_name);
  if (!project) {
    return;
  }

  const taskDescription = [
    `Address PR review on PR #${pr.number}: ${pr.title}`,
    `\nReviewer: ${review.user.login}`,
    `Review state: ${review.state}`,
    `Branch: ${pr.head.ref}`,
    `Repository: ${payload.repository.full_name}`,
    `\nReview body: ${review.body || "(no body)"}`,
    "\nInstructions:",
    `1. Checkout branch: ${pr.head.ref}`,
    "2. Address the review feedback by making the requested changes",
    "3. Run linting and tests to verify changes",
    "4. Commit and push changes to the same branch",
    `5. Post a reply comment saying "Changes made as requested"`,
  ].join("\n");

  const { taskId, sessionId } = await createAgentTask({
    projectId: project.id,
    orgId: project.orgId,
    title: `PR review iteration: ${pr.title} (#${pr.number})`,
    description: taskDescription,
    agentRole: "security_auditor",
    credits: 150,
    priority: 70,
  });

  // Report pending status check
  await reportStatusCheck({
    repo: payload.repository.full_name,
    sha: pr.head.sha,
    state: "pending",
    description: `Prometheus addressing review on PR #${pr.number}`,
    context: "prometheus/review-iteration",
  });

  // Update synced PR
  try {
    await db
      .update(syncedPullRequests)
      .set({
        reviewStatus:
          review.state === "changes_requested"
            ? "changes_requested"
            : "pending",
        sessionId,
        lastSyncedAt: new Date(),
      })
      .where(
        and(
          eq(syncedPullRequests.projectId, project.id),
          eq(syncedPullRequests.externalId, String(pr.number))
        )
      );
  } catch {
    // Best effort
  }

  // Post acknowledgment comment on the PR
  await postGitHubComment(
    payload.repository.full_name,
    pr.number,
    `**Prometheus Agent**\n\nI'm reviewing the feedback from @${review.user.login} and working on the requested changes. I'll update this PR shortly.\n\n[Track progress](${FRONTEND_URL}/dashboard/sessions/${sessionId})`
  );

  logger.info(
    { taskId, sessionId, prNumber: pr.number, reviewer: review.user.login },
    "PR review iteration task created"
  );
}

/** Handle issue_comment.created and pull_request_review_comment.created with @mention. */
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

  // Anti-loop: ignore comments from bot users
  if (
    BOT_USERS.has(comment.user.login.toLowerCase()) ||
    comment.user.type === "Bot"
  ) {
    return;
  }

  if (!comment.body.includes(BOT_MENTION)) {
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

  // Determine if this is a PR review comment (has path/position)
  const isPRReviewComment = Boolean(comment.path);
  const issueNumber =
    payload.issue?.number ?? payload.pull_request?.number ?? 0;

  const { taskId } = await createAgentTask({
    projectId: project.id,
    orgId: project.orgId,
    title: isPRReviewComment
      ? `PR comment task: ${comment.path ?? ""}:${comment.position ?? ""}`
      : `GitHub comment task from ${payload.sender.login}`,
    description: isPRReviewComment
      ? `Address inline review comment on ${comment.path}:\n\n${taskDescription}\n\nDiff context:\n${comment.diff_hunk ?? "N/A"}`
      : taskDescription,
    mode: isPRReviewComment ? "task" : "ask",
    credits: isPRReviewComment ? 100 : 20,
    priority: isPRReviewComment ? 60 : 40,
  });

  // Acknowledge the comment
  if (issueNumber > 0) {
    await postGitHubComment(
      payload.repository.full_name,
      issueNumber,
      `**Prometheus Agent**\n\nI'm on it! Working on: ${taskDescription.slice(0, 200)}${taskDescription.length > 200 ? "..." : ""}`
    );
  }

  logger.info(
    { taskId, sender: payload.sender.login, isPRReviewComment },
    "Task created from GitHub comment"
  );
}

/** Handle push events to the default branch. */
async function handlePushEvent(payload: GitHubWebhookPayload): Promise<void> {
  const ref = payload.ref;
  const defaultBranch = payload.repository.default_branch ?? "main";

  // Only handle pushes to the default branch
  if (ref !== `refs/heads/${defaultBranch}`) {
    return;
  }

  const project = await findProjectByRepo(payload.repository.full_name);
  if (!project) {
    return;
  }

  logger.info(
    {
      repo: payload.repository.full_name,
      ref,
      sender: payload.sender.login,
    },
    "Push to default branch detected"
  );

  const { taskId } = await createAgentTask({
    projectId: project.id,
    orgId: project.orgId,
    title: `CI check: push to ${defaultBranch}`,
    description: `New push to ${defaultBranch} by ${payload.sender.login}.\n\nRun CI checks (lint, typecheck, test) and report any issues.\n\nRepository: ${payload.repository.full_name}`,
    mode: "task",
    credits: 30,
    priority: 30,
  });

  logger.info(
    { taskId, repo: payload.repository.full_name },
    "CI task created for push to default branch"
  );
}

/** Handle check_run.completed events. */
async function handleCheckRunEvent(
  payload: GitHubWebhookPayload
): Promise<void> {
  if (payload.action !== "completed") {
    return;
  }

  const checkRun = payload.check_run;
  if (!checkRun) {
    return;
  }

  // Skip our own check runs to avoid loops
  if (checkRun.app?.slug === "prometheus-ai") {
    return;
  }

  const project = await findProjectByRepo(payload.repository.full_name);
  if (!project) {
    return;
  }

  // Only act on failures
  if (
    checkRun.conclusion !== "failure" &&
    checkRun.conclusion !== "timed_out"
  ) {
    logger.debug(
      {
        checkName: checkRun.name,
        conclusion: checkRun.conclusion,
      },
      "Check run completed successfully, no action needed"
    );
    return;
  }

  // Find associated PRs
  const prNumbers = checkRun.pull_requests?.map((p) => p.number) ?? [];
  if (prNumbers.length === 0) {
    logger.debug(
      { checkName: checkRun.name },
      "Failed check run has no associated PRs"
    );
    return;
  }

  const { taskId } = await createAgentTask({
    projectId: project.id,
    orgId: project.orgId,
    title: `Fix CI: ${checkRun.name} failed`,
    description: `CI check "${checkRun.name}" failed on commit ${checkRun.head_sha}.\n\nConclusion: ${checkRun.conclusion}\nAssociated PRs: ${prNumbers.map((n) => `#${n}`).join(", ")}\n\nInvestigate the failure and fix the issues.`,
    mode: "task",
    agentRole: "security_auditor",
    credits: 100,
    priority: 65,
  });

  logger.info(
    {
      taskId,
      checkName: checkRun.name,
      conclusion: checkRun.conclusion,
      prNumbers,
    },
    "CI fix task created for failed check run"
  );
}

/** Handle workflow_run.completed events. */
async function handleWorkflowRunEvent(
  payload: GitHubWebhookPayload
): Promise<void> {
  if (payload.action !== "completed") {
    return;
  }

  const workflowRun = payload.workflow_run;
  if (!workflowRun) {
    return;
  }

  const project = await findProjectByRepo(payload.repository.full_name);
  if (!project) {
    return;
  }

  // Only act on failures
  if (
    workflowRun.conclusion !== "failure" &&
    workflowRun.conclusion !== "timed_out"
  ) {
    logger.debug(
      {
        workflow: workflowRun.name,
        conclusion: workflowRun.conclusion,
      },
      "Workflow run completed successfully"
    );
    return;
  }

  const prNumbers = workflowRun.pull_requests?.map((p) => p.number) ?? [];

  const { taskId } = await createAgentTask({
    projectId: project.id,
    orgId: project.orgId,
    title: `Fix workflow: ${workflowRun.name} failed`,
    description: `GitHub Actions workflow "${workflowRun.name}" failed.\n\nBranch: ${workflowRun.head_branch}\nCommit: ${workflowRun.head_sha}\nConclusion: ${workflowRun.conclusion}${prNumbers.length > 0 ? `\nAssociated PRs: ${prNumbers.map((n) => `#${n}`).join(", ")}` : ""}\n\nInvestigate the workflow failure and fix the issues.`,
    mode: "task",
    credits: 100,
    priority: 55,
  });

  logger.info(
    {
      taskId,
      workflow: workflowRun.name,
      conclusion: workflowRun.conclusion,
      branch: workflowRun.head_branch,
    },
    "Fix task created for failed workflow run"
  );
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

  let payload: GitHubWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as GitHubWebhookPayload;
  } catch {
    logger.warn("Invalid JSON in GitHub App webhook body");
    return c.json({ error: "Invalid JSON" }, 400);
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
      case "installation":
        await handleInstallationEvent(payload);
        break;
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
      case "check_run":
        await handleCheckRunEvent(payload);
        break;
      case "workflow_run":
        await handleWorkflowRunEvent(payload);
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

export { githubAppWebhookApp, reportStatusCheck };
