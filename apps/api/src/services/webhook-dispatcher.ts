import { webhookSubscriptions } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { webhookDeliveryQueue } from "@prometheus/queue";
import { and, eq } from "drizzle-orm";
import type { ProtectedContext } from "../context";

const logger = createLogger("api:webhook-dispatcher");

/** Supported outbound webhook event types */
export const WEBHOOK_EVENT_TYPES = [
  "task.completed",
  "task.failed",
  "session.completed",
  "pr.created",
  "deployment.completed",
  "ci.passed",
  "ci.failed",
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

/**
 * Dispatch a webhook event to all matching subscriptions for an organization.
 *
 * Finds active subscriptions that listen for the given event type and enqueues
 * a delivery job for each one.
 */
export async function dispatchWebhook(
  db: ProtectedContext["db"],
  event: string,
  orgId: string,
  payload: Record<string, unknown>
): Promise<{ dispatched: number }> {
  // Find all active subscriptions for this org that match the event
  const subscriptions = await db
    .select({
      id: webhookSubscriptions.id,
      events: webhookSubscriptions.events,
    })
    .from(webhookSubscriptions)
    .where(
      and(
        eq(webhookSubscriptions.orgId, orgId),
        eq(webhookSubscriptions.enabled, true)
      )
    );

  const matchingSubs = subscriptions.filter((sub) => {
    const events = sub.events as string[];
    // Empty events array means subscribe to all events
    return events.length === 0 || events.includes(event);
  });

  if (matchingSubs.length === 0) {
    logger.debug({ orgId, event }, "No matching webhook subscriptions");
    return { dispatched: 0 };
  }

  // Enqueue a delivery job for each matching subscription
  const enrichedPayload = {
    ...payload,
    event,
    timestamp: new Date().toISOString(),
    orgId,
  };

  const jobs = matchingSubs.map((sub) => ({
    name: `webhook-delivery:${event}:${sub.id}`,
    data: {
      subscriptionId: sub.id,
      event,
      payload: enrichedPayload,
      attempt: 1,
    },
  }));

  await webhookDeliveryQueue.addBulk(jobs);

  logger.info(
    { orgId, event, dispatched: matchingSubs.length },
    "Webhook deliveries enqueued"
  );

  return { dispatched: matchingSubs.length };
}
