/**
 * GitLab Webhook Handler
 *
 * Processes inbound GitLab webhooks for task creation and issue/PR syncing:
 * - Push Hook -> Log push to default branch, optionally create CI/test task
 * - Issue Hook -> On open/update with "prometheus" label, create/update synced issue + task
 * - Merge Request Hook -> On open/update, create/update synced PR, create review task
 * - Pipeline Hook -> On completion, update CI status
 * - Note Hook -> On MR comments mentioning @prometheus, create response task
 *
 * Webhook verification uses a shared secret token via X-Gitlab-Token header.
 */

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

const logger = createLogger("api:webhook:gitlab");

const PROMETHEUS_LABEL = "prometheus";
const BOT_MENTION = "@prometheus";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GitLabPushPayload {
  after: string;
  before: string;
  checkout_sha: string;
  commits: Array<{
    added: string[];
    id: string;
    message: string;
    modified: string[];
    removed: string[];
    url: string;
  }>;
  project: {
    default_branch: string;
    id: number;
    name: string;
    path_with_namespace: string;
    web_url: string;
  };
  ref: string;
  user_name: string;
}

interface GitLabIssuePayload {
  labels: Array<{ title: string }>;
  object_attributes: {
    action: string;
    description: string | null;
    iid: number;
    state: string;
    title: string;
    url: string;
  };
  project: {
    id: number;
    name: string;
    path_with_namespace: string;
    web_url: string;
  };
  user: { name: string; username: string };
}

interface GitLabMergeRequestPayload {
  object_attributes: {
    action: string;
    description: string | null;
    iid: number;
    last_commit: { id: string } | null;
    source_branch: string;
    state: string;
    target_branch: string;
    title: string;
    url: string;
  };
  project: {
    default_branch: string;
    id: number;
    name: string;
    path_with_namespace: string;
    web_url: string;
  };
  user: { name: string; username: string };
}

interface GitLabPipelinePayload {
  object_attributes: {
    duration: number | null;
    id: number;
    ref: string;
    sha: string;
    status: string;
  };
  project: {
    id: number;
    name: string;
    path_with_namespace: string;
    web_url: string;
  };
}

interface GitLabNotePayload {
  merge_request?: {
    iid: number;
    source_branch: string;
    target_branch: string;
    title: string;
    url: string;
  };
  object_attributes: {
    note: string;
    noteable_type: string;
    url: string;
  };
  project: {
    id: number;
    name: string;
    path_with_namespace: string;
    web_url: string;
  };
  user: { name: string; username: string };
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

// ---------------------------------------------------------------------------
// Event Handlers
// ---------------------------------------------------------------------------

/**
 * Handle GitLab Push Hook events.
 * Logs pushes to the default branch and creates a CI/test task.
 */
async function handlePushHook(
  db: Database,
  payload: GitLabPushPayload,
  orgId: string,
  projectId: string
): Promise<void> {
  const defaultBranch = payload.project.default_branch;
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
    logger.debug(
      { project: payload.project.path_with_namespace },
      "Push to default branch with no file changes"
    );
    return;
  }

  const fileList = [...changedFiles].slice(0, 50).join("\n- ");
  const commitMessages = payload.commits
    .map((c) => `- ${c.message.split("\n")[0]}`)
    .join("\n");

  const description = [
    `CI/Test task for push to ${defaultBranch}`,
    `Repository: ${payload.project.path_with_namespace}`,
    `Pushed by: ${payload.user_name}`,
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
      project: payload.project.path_with_namespace,
    },
    "CI task created from GitLab push"
  );
}

/**
 * Handle GitLab Issue Hook events.
 * Creates or updates a synced issue and task when the "prometheus" label is present.
 */
async function handleIssueHook(
  db: Database,
  payload: GitLabIssuePayload,
  orgId: string,
  projectId: string
): Promise<void> {
  const issue = payload.object_attributes;
  const action = issue.action;

  // Only handle open/update actions
  if (action !== "open" && action !== "update") {
    return;
  }

  // Check for the "prometheus" label
  const hasLabel = payload.labels.some(
    (l) => l.title.toLowerCase() === PROMETHEUS_LABEL
  );
  if (!hasLabel) {
    return;
  }

  const issueUrl =
    issue.url || `${payload.project.web_url}/-/issues/${issue.iid}`;

  // Check for existing synced issue
  const existingSynced = await db
    .select()
    .from(syncedIssues)
    .where(
      and(
        eq(syncedIssues.projectId, projectId),
        eq(syncedIssues.provider, "gitlab"),
        eq(syncedIssues.externalId, String(issue.iid))
      )
    )
    .limit(1);

  const description = [
    `GitLab Issue !${issue.iid}: ${issue.title}`,
    `Author: ${payload.user.username}`,
    `URL: ${issueUrl}`,
    "",
    issue.description ?? "No description provided.",
  ].join("\n");

  const { taskId, sessionId } = await createWebhookTask(db, {
    projectId,
    orgId,
    title: `GL#${issue.iid}: ${issue.title}`,
    description,
    priority: 50,
  });

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
        externalStatus: issue.state,
        lastSyncedAt: new Date(),
      })
      .where(eq(syncedIssues.id, existingSynced[0].id));
  } else {
    await db.insert(syncedIssues).values({
      id: generateId("si"),
      projectId,
      orgId,
      provider: "gitlab",
      externalId: String(issue.iid),
      externalUrl: issueUrl,
      title: issue.title,
      body: issue.description,
      externalStatus: issue.state,
      taskId,
      sessionId,
      assignedToAgent: true,
      lastSyncedAt: new Date(),
    });
  }

  logger.info(
    {
      taskId,
      issueIid: issue.iid,
      action,
      project: payload.project.path_with_namespace,
    },
    "Task created from GitLab issue"
  );
}

/**
 * Handle GitLab Merge Request Hook events.
 * Creates or updates a synced PR and creates a review task.
 */
async function handleMergeRequestHook(
  db: Database,
  payload: GitLabMergeRequestPayload,
  orgId: string,
  projectId: string
): Promise<void> {
  const mr = payload.object_attributes;
  const action = mr.action;

  // Only handle open/update actions
  if (action !== "open" && action !== "update") {
    return;
  }

  const mrUrl =
    mr.url || `${payload.project.web_url}/-/merge_requests/${mr.iid}`;

  const description = [
    `Review MR !${mr.iid}: ${mr.title}`,
    `Author: ${payload.user.username}`,
    `Branch: ${mr.source_branch} -> ${mr.target_branch}`,
    `URL: ${mrUrl}`,
    "",
    mr.description ?? "No description provided.",
  ].join("\n");

  const { taskId, sessionId } = await createWebhookTask(db, {
    projectId,
    orgId,
    title: `Review MR !${mr.iid}: ${mr.title}`,
    description,
    priority: 60,
  });

  // Check for existing synced PR
  const existingSynced = await db
    .select()
    .from(syncedPullRequests)
    .where(
      and(
        eq(syncedPullRequests.projectId, projectId),
        eq(syncedPullRequests.provider, "gitlab"),
        eq(syncedPullRequests.externalId, String(mr.iid))
      )
    )
    .limit(1);

  // Upsert synced pull request
  if (existingSynced[0]) {
    await db
      .update(syncedPullRequests)
      .set({
        title: mr.title,
        branch: mr.source_branch,
        baseBranch: mr.target_branch,
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
      provider: "gitlab",
      externalId: String(mr.iid),
      externalUrl: mrUrl,
      title: mr.title,
      branch: mr.source_branch,
      baseBranch: mr.target_branch,
      sessionId,
      reviewStatus: "pending",
      lastSyncedAt: new Date(),
    });
  }

  logger.info(
    {
      taskId,
      mrIid: mr.iid,
      action,
      project: payload.project.path_with_namespace,
    },
    "Review task created from GitLab merge request"
  );
}

/**
 * Handle GitLab Pipeline Hook events.
 * Logs pipeline completion status.
 */
async function handlePipelineHook(
  db: Database,
  payload: GitLabPipelinePayload,
  _orgId: string,
  _projectId: string
): Promise<void> {
  const pipeline = payload.object_attributes;
  const status = pipeline.status;

  // Only act on completed pipelines
  if (status !== "success" && status !== "failed") {
    return;
  }

  logger.info(
    {
      pipelineId: pipeline.id,
      status,
      ref: pipeline.ref,
      sha: pipeline.sha,
      duration: pipeline.duration,
      project: payload.project.path_with_namespace,
    },
    "GitLab pipeline completed"
  );

  // If the pipeline failed, create a task to investigate
  if (status === "failed") {
    const description = [
      `GitLab pipeline #${pipeline.id} failed`,
      `Repository: ${payload.project.path_with_namespace}`,
      `Branch: ${pipeline.ref}`,
      `Commit: ${pipeline.sha}`,
      `Duration: ${pipeline.duration ?? "N/A"} seconds`,
      "",
      "Investigate the pipeline failure and fix the issues.",
    ].join("\n");

    const { taskId } = await createWebhookTask(db, {
      projectId: _projectId,
      orgId: _orgId,
      title: `Fix CI: GitLab pipeline #${pipeline.id} failed`,
      description,
      priority: 65,
    });

    logger.info(
      { taskId, pipelineId: pipeline.id },
      "CI fix task created from failed GitLab pipeline"
    );
  }
}

/**
 * Handle GitLab Note Hook events.
 * Creates a response task when a MR comment mentions @prometheus.
 */
async function handleNoteHook(
  db: Database,
  payload: GitLabNotePayload,
  orgId: string,
  projectId: string
): Promise<void> {
  const note = payload.object_attributes;

  // Only handle MR comments
  if (note.noteable_type !== "MergeRequest") {
    return;
  }

  // Only respond to comments mentioning @prometheus
  if (!note.note.includes(BOT_MENTION)) {
    return;
  }

  const mr = payload.merge_request;
  if (!mr) {
    return;
  }

  const taskDescription = note.note.replace(BOT_MENTION, "").trim();
  if (!taskDescription) {
    return;
  }

  const mrUrl =
    mr.url || `${payload.project.web_url}/-/merge_requests/${mr.iid}`;

  const description = [
    `Respond to MR comment on !${mr.iid}: ${mr.title}`,
    `Commenter: ${payload.user.username}`,
    `Branch: ${mr.source_branch} -> ${mr.target_branch}`,
    `URL: ${mrUrl}`,
    "",
    "Comment:",
    taskDescription,
  ].join("\n");

  const { taskId } = await createWebhookTask(db, {
    projectId,
    orgId,
    title: `MR comment task: !${mr.iid} from ${payload.user.username}`,
    description,
    priority: 55,
  });

  logger.info(
    {
      taskId,
      mrIid: mr.iid,
      commenter: payload.user.username,
      project: payload.project.path_with_namespace,
    },
    "Task created from GitLab MR comment mention"
  );
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

/**
 * Handle inbound GitLab webhook requests.
 *
 * Verifies the request via X-Gitlab-Token header, parses the event type
 * from X-Gitlab-Event, and dispatches to the appropriate handler.
 */
export async function handleGitLabWebhook(
  c: Context,
  db: Database,
  orgId: string
): Promise<Response> {
  // Verify shared secret token
  const token = c.req.header("X-Gitlab-Token");
  const secret = process.env.GITLAB_WEBHOOK_SECRET;

  if (secret && token !== secret) {
    logger.warn("GitLab webhook signature mismatch");
    return c.json({ error: "Invalid token" }, 401);
  }

  if (!secret) {
    logger.warn("GITLAB_WEBHOOK_SECRET not configured, skipping verification");
  }

  const event = c.req.header("X-Gitlab-Event") ?? "";
  let body: Record<string, unknown>;

  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    logger.warn("Invalid JSON in GitLab webhook body");
    return c.json({ error: "Invalid JSON" }, 400);
  }

  // Extract projectId from the payload's project.id or use a default lookup
  // For now, we use the orgId to find a default project
  const projectId = await resolveProjectId(db, body, orgId);
  if (!projectId) {
    logger.warn({ orgId, event }, "No project found for GitLab webhook");
    return c.json({ error: "No project found" }, 404);
  }

  logger.info({ event, orgId, projectId }, "GitLab webhook received");

  try {
    switch (event) {
      case "Push Hook":
        await handlePushHook(
          db,
          body as unknown as GitLabPushPayload,
          orgId,
          projectId
        );
        break;

      case "Issue Hook":
        await handleIssueHook(
          db,
          body as unknown as GitLabIssuePayload,
          orgId,
          projectId
        );
        break;

      case "Merge Request Hook":
        await handleMergeRequestHook(
          db,
          body as unknown as GitLabMergeRequestPayload,
          orgId,
          projectId
        );
        break;

      case "Pipeline Hook":
        await handlePipelineHook(
          db,
          body as unknown as GitLabPipelinePayload,
          orgId,
          projectId
        );
        break;

      case "Note Hook":
        await handleNoteHook(
          db,
          body as unknown as GitLabNotePayload,
          orgId,
          projectId
        );
        break;

      default:
        logger.debug({ event }, "Unhandled GitLab webhook event type");
    }

    return c.json({ ok: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(
      { error: msg, event, orgId },
      "GitLab webhook processing failed"
    );
    return c.json({ error: "Webhook processing failed" }, 500);
  }
}

/**
 * Resolve a project ID from the webhook payload or fall back to the first
 * project in the org.
 */
async function resolveProjectId(
  db: Database,
  body: Record<string, unknown>,
  orgId: string
): Promise<string | null> {
  // Try to find a project whose repoUrl matches the GitLab project URL
  const project = body.project as { web_url?: string } | undefined;
  const webUrl = project?.web_url;

  if (webUrl) {
    const result = await db.query.projects.findFirst({
      where: eq((await import("@prometheus/db")).projects.repoUrl, webUrl),
      columns: { id: true },
    });

    if (result) {
      return result.id;
    }
  }

  // Fall back to the first project in the org
  const fallback = await db.query.projects.findFirst({
    where: eq((await import("@prometheus/db")).projects.orgId, orgId),
    columns: { id: true },
  });

  return fallback?.id ?? null;
}
