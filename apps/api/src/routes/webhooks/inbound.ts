/**
 * Inbound Webhook Router
 *
 * Routes inbound webhooks from external services to their handlers:
 * - POST /webhooks/github   -> GitHub webhook handler (HMAC verification)
 * - POST /webhooks/jira     -> Jira webhook handler (JWT verification)
 * - POST /webhooks/custom/:orgId -> Custom webhook handler (HMAC verification)
 */

import { createLogger } from "@prometheus/logger";
import { Hono } from "hono";
import { handleCustomWebhook } from "../../webhooks/custom-handler";
import { handleGitHubWebhook } from "../../webhooks/github-handler";
import { handleJiraWebhook } from "../../webhooks/jira-handler";

const logger = createLogger("api:webhooks:inbound");
const inboundWebhookApp = new Hono();

// ---------------------------------------------------------------------------
// GitHub webhook
// ---------------------------------------------------------------------------
inboundWebhookApp.post("/github", (c) => {
  logger.info("Received inbound GitHub webhook");
  return handleGitHubWebhook(c);
});

// ---------------------------------------------------------------------------
// Jira webhook
// ---------------------------------------------------------------------------
inboundWebhookApp.post("/jira", (c) => {
  logger.info("Received inbound Jira webhook");
  return handleJiraWebhook(c);
});

// ---------------------------------------------------------------------------
// Custom webhook (per-org)
// ---------------------------------------------------------------------------
inboundWebhookApp.post("/custom/:orgId", (c) => {
  const orgId = c.req.param("orgId");
  logger.info({ orgId }, "Received inbound custom webhook");
  return handleCustomWebhook(c, orgId);
});

export { inboundWebhookApp };
