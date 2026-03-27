/**
 * Inbound Webhook Router
 *
 * Routes inbound webhooks from external services to their handlers:
 * - POST /webhooks/github   -> GitHub webhook handler (HMAC verification)
 * - POST /webhooks/jira     -> Jira webhook handler (JWT verification)
 * - POST /webhooks/custom/:orgId -> Custom webhook handler (HMAC verification)
 *
 * All routes support idempotency via delivery ID headers:
 * - GitHub: X-GitHub-Delivery
 * - Jira: X-Atlassian-Webhook-Identifier
 * - Custom: X-Webhook-Delivery-Id
 */

import { db, processedWebhookEvents } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { handleAzureDevOpsWebhook } from "../../webhooks/azure-devops-handler";
import { handleCustomWebhook } from "../../webhooks/custom-handler";
import { handleGiteaWebhook } from "../../webhooks/gitea-handler";
import { handleGitHubWebhook } from "../../webhooks/github-handler";
import { handleGitLabWebhook } from "../../webhooks/gitlab-handler";
import { handleJiraWebhook } from "../../webhooks/jira-handler";
import { handleLinearWebhook } from "../../webhooks/linear-handler";

const logger = createLogger("api:webhooks:inbound");
const inboundWebhookApp = new Hono();

/** TTL for webhook idempotency records: 48 hours */
const WEBHOOK_IDEMPOTENCY_TTL_MS = 48 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Idempotency helpers
// ---------------------------------------------------------------------------

async function isDeliveryAlreadyProcessed(
  deliveryId: string
): Promise<boolean> {
  if (!deliveryId) {
    return false;
  }
  const existing = await db.query.processedWebhookEvents.findFirst({
    where: eq(processedWebhookEvents.eventId, deliveryId),
  });
  return !!existing;
}

async function recordDelivery(
  deliveryId: string,
  source: string
): Promise<void> {
  if (!deliveryId) {
    return;
  }
  await db
    .insert(processedWebhookEvents)
    .values({
      eventId: deliveryId,
      eventType: source,
      processedAt: new Date(),
      expiresAt: new Date(Date.now() + WEBHOOK_IDEMPOTENCY_TTL_MS),
    })
    .onConflictDoNothing();
}

// ---------------------------------------------------------------------------
// GitHub webhook
// ---------------------------------------------------------------------------
inboundWebhookApp.post("/github", async (c) => {
  const deliveryId = c.req.header("x-github-delivery") ?? "";

  if (deliveryId) {
    const duplicate = await isDeliveryAlreadyProcessed(deliveryId);
    if (duplicate) {
      logger.info(
        { deliveryId },
        "Duplicate GitHub webhook delivery, skipping"
      );
      return c.json({ ok: true, duplicate: true });
    }
  }

  logger.info({ deliveryId }, "Received inbound GitHub webhook");
  const response = await handleGitHubWebhook(c);

  if (deliveryId && response.status < 400) {
    await recordDelivery(deliveryId, "github");
  }

  return response;
});

// ---------------------------------------------------------------------------
// Jira webhook
// ---------------------------------------------------------------------------
inboundWebhookApp.post("/jira", async (c) => {
  const deliveryId = c.req.header("x-atlassian-webhook-identifier") ?? "";

  if (deliveryId) {
    const duplicate = await isDeliveryAlreadyProcessed(deliveryId);
    if (duplicate) {
      logger.info({ deliveryId }, "Duplicate Jira webhook delivery, skipping");
      return c.json({ ok: true, duplicate: true });
    }
  }

  logger.info({ deliveryId }, "Received inbound Jira webhook");
  const response = await handleJiraWebhook(c);

  if (deliveryId && response.status < 400) {
    await recordDelivery(deliveryId, "jira");
  }

  return response;
});

// ---------------------------------------------------------------------------
// Custom webhook (per-org)
// ---------------------------------------------------------------------------
inboundWebhookApp.post("/custom/:orgId", async (c) => {
  const orgId = c.req.param("orgId");
  const deliveryId = c.req.header("x-webhook-delivery-id") ?? "";

  if (deliveryId) {
    const duplicate = await isDeliveryAlreadyProcessed(deliveryId);
    if (duplicate) {
      logger.info(
        { deliveryId, orgId },
        "Duplicate custom webhook delivery, skipping"
      );
      return c.json({ ok: true, duplicate: true });
    }
  }

  logger.info({ orgId, deliveryId }, "Received inbound custom webhook");
  const response = await handleCustomWebhook(c, orgId);

  if (deliveryId && response.status < 400) {
    await recordDelivery(deliveryId, `custom:${orgId}`);
  }

  return response;
});

// ---------------------------------------------------------------------------
// GitLab webhook
// ---------------------------------------------------------------------------
inboundWebhookApp.post("/gitlab", async (c) => {
  const deliveryId =
    c.req.header("x-gitlab-event-uuid") ?? `gitlab_${Date.now()}`;

  if (deliveryId) {
    const duplicate = await isDeliveryAlreadyProcessed(deliveryId);
    if (duplicate) {
      logger.info(
        { deliveryId },
        "Duplicate GitLab webhook delivery, skipping"
      );
      return c.json({ ok: true, duplicate: true });
    }
  }

  logger.info({ deliveryId }, "Received inbound GitLab webhook");
  const response = await handleGitLabWebhook(c, db, "");

  if (deliveryId && response.status < 400) {
    await recordDelivery(deliveryId, "gitlab");
  }

  return response;
});

// ---------------------------------------------------------------------------
// Linear webhook
// ---------------------------------------------------------------------------
inboundWebhookApp.post("/linear", async (c) => {
  const deliveryId = c.req.header("linear-delivery") ?? `linear_${Date.now()}`;

  if (deliveryId) {
    const duplicate = await isDeliveryAlreadyProcessed(deliveryId);
    if (duplicate) {
      logger.info(
        { deliveryId },
        "Duplicate Linear webhook delivery, skipping"
      );
      return c.json({ ok: true, duplicate: true });
    }
  }

  logger.info({ deliveryId }, "Received inbound Linear webhook");
  const response = await handleLinearWebhook(c, db, "");

  if (deliveryId && response.status < 400) {
    await recordDelivery(deliveryId, "linear");
  }

  return response;
});

// ---------------------------------------------------------------------------
// Azure DevOps webhook
// ---------------------------------------------------------------------------
inboundWebhookApp.post("/azure-devops", async (c) => {
  const deliveryId = `azdo_${Date.now()}`;

  logger.info({ deliveryId }, "Received inbound Azure DevOps webhook");
  const response = await handleAzureDevOpsWebhook(c, db, "");

  await recordDelivery(deliveryId, "azure-devops");

  return response;
});

// ---------------------------------------------------------------------------
// Gitea webhook
// ---------------------------------------------------------------------------
inboundWebhookApp.post("/gitea", async (c) => {
  const deliveryId = c.req.header("x-gitea-delivery") ?? `gitea_${Date.now()}`;

  if (deliveryId) {
    const duplicate = await isDeliveryAlreadyProcessed(deliveryId);
    if (duplicate) {
      logger.info({ deliveryId }, "Duplicate Gitea webhook delivery, skipping");
      return c.json({ ok: true, duplicate: true });
    }
  }

  logger.info({ deliveryId }, "Received inbound Gitea webhook");
  const response = await handleGiteaWebhook(c, db, "");

  if (deliveryId && response.status < 400) {
    await recordDelivery(deliveryId, "gitea");
  }

  return response;
});

export { inboundWebhookApp };
