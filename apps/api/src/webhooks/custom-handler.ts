/**
 * Custom Webhook Handler
 *
 * Accepts JSON task creation requests from external services.
 * Payload: { task: string, projectId: string, priority?: number }
 *
 * Uses HMAC signature verification with org-specific webhook secrets.
 * The secret is expected in the X-Webhook-Signature-256 header.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { db, organizations, projects, sessions, tasks } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { agentTaskQueue } from "@prometheus/queue";
import { generateId } from "@prometheus/utils";
import { and, eq } from "drizzle-orm";
import type { Context } from "hono";

const logger = createLogger("api:webhooks:custom-handler");
const DASH_RE = /-/g;

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

/**
 * Resolve the webhook secret for an org.
 *
 * In production this would be stored in the organizations table or a
 * dedicated webhook_endpoints table. For now we fall back to an env var.
 */
function getOrgWebhookSecret(orgId: string): string | null {
  // Try org-specific env var first, then fall back to global
  const envKey = `WEBHOOK_SECRET_${orgId.toUpperCase().replace(DASH_RE, "_")}`;
  return process.env[envKey] ?? process.env.CUSTOM_WEBHOOK_SECRET ?? null;
}

function verifyHmacSignature(
  body: string,
  signature: string,
  secret: string
): boolean {
  const expectedSig = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

  // Support both plain sha256= format and timestamp:sha256= format
  const sigToCompare = signature.includes(":")
    ? signature.split(":").slice(1).join(":")
    : signature;

  if (expectedSig.length !== sigToCompare.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(expectedSig), Buffer.from(sigToCompare));
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CustomWebhookPayload {
  priority?: number;
  projectId: string;
  task: string;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function handleCustomWebhook(
  c: Context,
  orgId: string
): Promise<Response> {
  const rawBody = await c.req.text();
  const signature = c.req.header("x-webhook-signature-256") ?? "";

  // Verify org exists
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
  });

  if (!org) {
    logger.warn({ orgId }, "Custom webhook for unknown organization");
    return c.json({ error: "Organization not found" }, 404);
  }

  // Verify HMAC signature
  const secret = getOrgWebhookSecret(orgId);
  if (!secret) {
    logger.warn({ orgId }, "No webhook secret configured for organization");
    return c.json(
      { error: "Webhook not configured for this organization" },
      403
    );
  }

  if (!verifyHmacSignature(rawBody, signature, secret)) {
    logger.warn({ orgId }, "Invalid custom webhook signature");
    return c.json({ error: "Invalid signature" }, 401);
  }

  try {
    const payload = JSON.parse(rawBody) as CustomWebhookPayload;

    // Validate required fields
    if (!(payload.task && payload.projectId)) {
      return c.json({ error: "Missing required fields: task, projectId" }, 400);
    }

    // Verify project belongs to org
    const project = await db
      .select({ id: projects.id, orgId: projects.orgId })
      .from(projects)
      .where(and(eq(projects.id, payload.projectId), eq(projects.orgId, orgId)))
      .limit(1);

    if (!project[0]) {
      return c.json(
        { error: "Project not found or does not belong to organization" },
        404
      );
    }

    const priority = Math.max(1, Math.min(100, payload.priority ?? 50));
    const taskId = generateId("task");
    const sessionId = generateId("ses");

    await db.insert(sessions).values({
      id: sessionId,
      projectId: payload.projectId,
      userId: orgId,
      status: "active",
      mode: "task",
    });

    await db.insert(tasks).values({
      id: taskId,
      sessionId,
      projectId: payload.projectId,
      orgId,
      title: `Webhook: ${payload.task.slice(0, 80)}`,
      description: payload.task,
      status: "queued",
      priority,
    });

    await agentTaskQueue.add(`custom-webhook-${taskId}`, {
      taskId,
      sessionId,
      projectId: payload.projectId,
      orgId,
      userId: orgId,
      title: payload.task.slice(0, 80),
      description: payload.task,
      mode: "task",
      agentRole: null,
      creditsReserved: 100,
      planTier: org.planTier,
    });

    logger.info(
      { taskId, sessionId, orgId, projectId: payload.projectId },
      "Task created from custom webhook"
    );

    return c.json({ ok: true, taskId, sessionId }, 201);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ error: msg, orgId }, "Custom webhook processing failed");
    return c.json({ error: "Webhook processing failed" }, 500);
  }
}
