/**
 * Azure DevOps Webhook Handler
 *
 * Processes inbound Azure DevOps service hooks:
 * - workitem.created / workitem.updated -> Sync to syncedIssues table
 * - git.pullrequest.created / git.pullrequest.updated -> Sync to syncedPullRequests table
 * - build.complete -> Log CI completion status
 *
 * Verification uses Basic auth or a shared secret in the Authorization header.
 */

import { timingSafeEqual } from "node:crypto";
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

const logger = createLogger("api:webhook:azure-devops");

const BEARER_RE = /^Bearer\s+/i;
const BASIC_RE = /^Basic\s+/i;

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/**
 * Verify the Azure DevOps webhook request using Basic auth or a shared secret.
 * Azure DevOps supports Basic auth and personal access tokens for webhook
 * authentication.
 */
function verifyAzureDevOpsRequest(c: Context): boolean {
  const secret = process.env.AZURE_DEVOPS_WEBHOOK_SECRET;

  if (!secret) {
    logger.warn(
      "AZURE_DEVOPS_WEBHOOK_SECRET not configured, rejecting webhook"
    );
    return false;
  }

  const authHeader = c.req.header("Authorization") ?? "";

  // Support Bearer token
  if (BEARER_RE.test(authHeader)) {
    const token = authHeader.replace(BEARER_RE, "").trim();
    return safeCompare(token, secret);
  }

  // Support Basic auth (decode and compare password portion)
  if (BASIC_RE.test(authHeader)) {
    try {
      const decoded = Buffer.from(
        authHeader.replace(BASIC_RE, "").trim(),
        "base64"
      ).toString("utf-8");
      const password = decoded.split(":").slice(1).join(":");
      return safeCompare(password, secret);
    } catch {
      return false;
    }
  }

  // Fall back to direct token comparison
  return safeCompare(authHeader, secret);
}

/**
 * Timing-safe string comparison.
 */
function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AzureDevOpsPayload {
  eventType: string;
  message?: { text: string };
  resource: Record<string, unknown>;
}

interface AzureWorkItemResource {
  _links?: { html?: { href: string } };
  fields?: {
    "System.AssignedTo"?: { displayName: string } | string;
    "System.Description"?: string;
    "System.State"?: string;
    "System.Title"?: string;
    "System.WorkItemType"?: string;
  };
  id: number;
  url: string;
}

interface AzurePullRequestResource {
  _links?: { web?: { href: string } };
  createdBy?: { displayName: string; uniqueName: string };
  description?: string;
  pullRequestId: number;
  repository?: {
    name: string;
    project?: { name: string };
  };
  sourceRefName?: string;
  status?: string;
  targetRefName?: string;
  title?: string;
  url: string;
}

interface AzureBuildResource {
  _links?: { web?: { href: string } };
  buildNumber?: string;
  definition?: { name: string };
  id: number;
  result?: string;
  sourceBranch?: string;
  sourceVersion?: string;
  status?: string;
  url: string;
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

/**
 * Strip Azure DevOps ref prefix (e.g., "refs/heads/main" -> "main").
 */
const REFS_HEADS_RE = /^refs\/heads\//;

function stripRefPrefix(ref: string | undefined): string {
  if (!ref) {
    return "";
  }
  return ref.replace(REFS_HEADS_RE, "");
}

// ---------------------------------------------------------------------------
// Event Handlers
// ---------------------------------------------------------------------------

/**
 * Handle workitem.created and workitem.updated events.
 * Syncs the work item to the syncedIssues table and creates a task.
 */
async function handleWorkItemEvent(
  db: Database,
  resource: AzureWorkItemResource,
  eventType: string,
  orgId: string,
  projectId: string
): Promise<void> {
  const fields = resource.fields;
  if (!fields) {
    logger.debug("Azure DevOps work item missing fields, skipping");
    return;
  }

  const title = fields["System.Title"] ?? "Untitled work item";
  const description = fields["System.Description"] ?? "";
  const state = fields["System.State"] ?? "New";
  const workItemType = fields["System.WorkItemType"] ?? "Task";
  const externalId = String(resource.id);
  const externalUrl = resource._links?.html?.href ?? resource.url;

  const assignee =
    typeof fields["System.AssignedTo"] === "string"
      ? fields["System.AssignedTo"]
      : (fields["System.AssignedTo"]?.displayName ?? "Unassigned");

  const taskDescription = [
    `Azure DevOps ${workItemType} #${resource.id}: ${title}`,
    `State: ${state}`,
    `Assignee: ${assignee}`,
    `URL: ${externalUrl}`,
    "",
    description || "No description provided.",
  ].join("\n");

  const { taskId, sessionId } = await createWebhookTask(db, {
    projectId,
    orgId,
    title: `ADO#${resource.id}: ${title}`,
    description: taskDescription,
    priority: 50,
  });

  // Sync work item to database (best-effort; uses "jira" provider as the
  // closest match since the DB enum does not yet include "azure_devops").
  // The externalId is prefixed with "ado-" to distinguish from actual Jira issues.
  try {
    const adoExternalId = `ado-${externalId}`;

    const existingSynced = await db
      .select()
      .from(syncedIssues)
      .where(
        and(
          eq(syncedIssues.projectId, projectId),
          eq(syncedIssues.provider, "jira"),
          eq(syncedIssues.externalId, adoExternalId)
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
          title,
          body: description,
          externalStatus: state,
          lastSyncedAt: new Date(),
        })
        .where(eq(syncedIssues.id, existingSynced[0].id));
    } else {
      await db.insert(syncedIssues).values({
        id: generateId("si"),
        projectId,
        orgId,
        provider: "jira",
        externalId: adoExternalId,
        externalUrl,
        title,
        body: description,
        externalStatus: state,
        taskId,
        sessionId,
        assignedToAgent: true,
        lastSyncedAt: new Date(),
      });
    }
  } catch (syncError) {
    const syncMsg =
      syncError instanceof Error ? syncError.message : String(syncError);
    logger.warn(
      { error: syncMsg },
      "Failed to sync Azure DevOps work item to database"
    );
  }

  logger.info(
    {
      taskId,
      workItemId: resource.id,
      eventType,
      workItemType,
    },
    "Task created from Azure DevOps work item"
  );
}

/**
 * Handle git.pullrequest.created and git.pullrequest.updated events.
 * Syncs the pull request to the syncedPullRequests table and creates a review task.
 */
async function handlePullRequestEvent(
  db: Database,
  resource: AzurePullRequestResource,
  eventType: string,
  orgId: string,
  projectId: string
): Promise<void> {
  const title = resource.title ?? "Untitled pull request";
  const description = resource.description ?? "";
  const externalId = String(resource.pullRequestId);
  const externalUrl = resource._links?.web?.href ?? resource.url;
  const sourceBranch = stripRefPrefix(resource.sourceRefName);
  const targetBranch = stripRefPrefix(resource.targetRefName);
  const author = resource.createdBy?.displayName ?? "Unknown";

  const taskDescription = [
    `Review Azure DevOps PR #${resource.pullRequestId}: ${title}`,
    `Author: ${author}`,
    `Branch: ${sourceBranch} -> ${targetBranch}`,
    `Repository: ${resource.repository?.project?.name ?? ""}/${resource.repository?.name ?? ""}`,
    `URL: ${externalUrl}`,
    "",
    description || "No description provided.",
  ].join("\n");

  const { taskId, sessionId } = await createWebhookTask(db, {
    projectId,
    orgId,
    title: `Review ADO PR #${resource.pullRequestId}: ${title}`,
    description: taskDescription,
    priority: 60,
  });

  // Sync PR to database (best-effort; uses "github" provider as a fallback
  // since the DB enum does not yet include "azure_devops").
  // The externalId is prefixed with "ado-" to distinguish from actual GitHub PRs.
  try {
    const adoExternalId = `ado-${externalId}`;

    const existingSynced = await db
      .select()
      .from(syncedPullRequests)
      .where(
        and(
          eq(syncedPullRequests.projectId, projectId),
          eq(syncedPullRequests.provider, "github"),
          eq(syncedPullRequests.externalId, adoExternalId)
        )
      )
      .limit(1);

    if (existingSynced[0]) {
      await db
        .update(syncedPullRequests)
        .set({
          title,
          branch: sourceBranch,
          baseBranch: targetBranch,
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
        externalId: adoExternalId,
        externalUrl,
        title,
        branch: sourceBranch,
        baseBranch: targetBranch,
        sessionId,
        reviewStatus: "pending",
        lastSyncedAt: new Date(),
      });
    }
  } catch (syncError) {
    const syncMsg =
      syncError instanceof Error ? syncError.message : String(syncError);
    logger.warn(
      { error: syncMsg },
      "Failed to sync Azure DevOps pull request to database"
    );
  }

  logger.info(
    {
      taskId,
      pullRequestId: resource.pullRequestId,
      eventType,
    },
    "Review task created from Azure DevOps pull request"
  );
}

/**
 * Handle build.complete events.
 * Logs CI build completion and creates a fix task on failure.
 */
async function handleBuildComplete(
  db: Database,
  resource: AzureBuildResource,
  orgId: string,
  projectId: string
): Promise<void> {
  const buildUrl = resource._links?.web?.href ?? resource.url;
  const result = resource.result ?? "unknown";
  const branch = stripRefPrefix(resource.sourceBranch);

  logger.info(
    {
      buildId: resource.id,
      buildNumber: resource.buildNumber,
      result,
      branch,
      definitionName: resource.definition?.name,
    },
    "Azure DevOps build completed"
  );

  // Create a fix task on build failure
  if (result === "failed" || result === "partiallySucceeded") {
    const description = [
      `Azure DevOps build #${resource.buildNumber ?? resource.id} ${result}`,
      `Definition: ${resource.definition?.name ?? "Unknown"}`,
      `Branch: ${branch}`,
      `Commit: ${resource.sourceVersion ?? "N/A"}`,
      `URL: ${buildUrl}`,
      "",
      "Investigate the build failure and fix the issues.",
    ].join("\n");

    const { taskId } = await createWebhookTask(db, {
      projectId,
      orgId,
      title: `Fix CI: ADO build #${resource.buildNumber ?? resource.id} ${result}`,
      description,
      priority: 65,
    });

    logger.info(
      { taskId, buildId: resource.id, result },
      "CI fix task created from failed Azure DevOps build"
    );
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

/**
 * Handle inbound Azure DevOps webhook requests.
 *
 * Verifies the request via Basic auth or shared secret in the Authorization
 * header, parses the event type from body.eventType, and dispatches to the
 * appropriate handler.
 */
export async function handleAzureDevOpsWebhook(
  c: Context,
  db: Database,
  orgId: string
): Promise<Response> {
  // Verify authorization
  if (!verifyAzureDevOpsRequest(c)) {
    logger.warn("Invalid Azure DevOps webhook authorization");
    return c.json({ error: "Unauthorized" }, 401);
  }

  let payload: AzureDevOpsPayload;
  try {
    payload = (await c.req.json()) as AzureDevOpsPayload;
  } catch {
    logger.warn("Invalid JSON in Azure DevOps webhook body");
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const eventType = payload.eventType ?? "";

  // Resolve project for this org
  const projectId = await resolveProjectId(db, orgId);
  if (!projectId) {
    logger.warn({ orgId }, "No project found for Azure DevOps webhook");
    return c.json({ error: "No project found" }, 404);
  }

  logger.info({ eventType, orgId, projectId }, "Azure DevOps webhook received");

  try {
    switch (eventType) {
      case "workitem.created":
      case "workitem.updated":
        await handleWorkItemEvent(
          db,
          payload.resource as unknown as AzureWorkItemResource,
          eventType,
          orgId,
          projectId
        );
        break;

      case "git.pullrequest.created":
      case "git.pullrequest.updated":
        await handlePullRequestEvent(
          db,
          payload.resource as unknown as AzurePullRequestResource,
          eventType,
          orgId,
          projectId
        );
        break;

      case "build.complete":
        await handleBuildComplete(
          db,
          payload.resource as unknown as AzureBuildResource,
          orgId,
          projectId
        );
        break;

      default:
        logger.debug(
          { eventType },
          "Unhandled Azure DevOps webhook event type"
        );
    }

    return c.json({ ok: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(
      { error: msg, eventType, orgId },
      "Azure DevOps webhook processing failed"
    );
    return c.json({ error: "Webhook processing failed" }, 500);
  }
}
