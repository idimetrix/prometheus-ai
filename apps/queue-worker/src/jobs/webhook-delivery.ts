import { createHmac } from "node:crypto";
import { db, webhookDeliveries, webhookSubscriptions } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import type { WebhookDeliveryData } from "@prometheus/queue";
import { generateId } from "@prometheus/utils";
import { eq } from "drizzle-orm";

const logger = createLogger("queue-worker:webhook-delivery");

const MAX_ATTEMPTS = 3;

export async function processWebhookDelivery(
  data: WebhookDeliveryData
): Promise<{ delivered: boolean; statusCode: number | null }> {
  const { subscriptionId, event, payload, attempt } = data;

  logger.info(
    { subscriptionId, event, attempt },
    "Processing webhook delivery"
  );

  // Fetch subscription details
  const [subscription] = await db
    .select()
    .from(webhookSubscriptions)
    .where(eq(webhookSubscriptions.id, subscriptionId))
    .limit(1);

  if (!subscription) {
    logger.warn({ subscriptionId }, "Webhook subscription not found, skipping");
    return { delivered: false, statusCode: null };
  }

  if (!subscription.enabled) {
    logger.info(
      { subscriptionId },
      "Webhook subscription disabled, skipping delivery"
    );
    return { delivered: false, statusCode: null };
  }

  const deliveryId = generateId("whd");
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);

  // Sign payload with HMAC-SHA256
  const signatureInput = `${timestamp}.${body}`;
  const hmac = createHmac("sha256", subscription.secret);
  hmac.update(signatureInput);
  const signature = `sha256=${hmac.digest("hex")}`;

  const startTime = performance.now();
  let statusCode: number | null = null;
  let responseBody = "";
  let success = false;

  try {
    const response = await fetch(subscription.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Prometheus-Event": event,
        "X-Prometheus-Signature": signature,
        "X-Prometheus-Delivery": deliveryId,
        "X-Webhook-Timestamp": String(timestamp),
        "User-Agent": "Prometheus-Webhook/1.0",
      },
      body,
      signal: AbortSignal.timeout(30_000),
    });

    statusCode = response.status;
    success = response.ok;

    try {
      responseBody = await response.text();
      responseBody = responseBody.slice(0, 512);
    } catch {
      // Ignore response body read errors
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    responseBody = errMsg.slice(0, 512);
    logger.warn(
      { subscriptionId, event, attempt, error: errMsg },
      "Webhook delivery network error"
    );
  }

  const durationMs = Math.round(performance.now() - startTime);

  // Record delivery in database
  await db.insert(webhookDeliveries).values({
    id: deliveryId,
    subscriptionId,
    event,
    payload,
    statusCode: statusCode === null ? null : String(statusCode),
    responseBody: responseBody || null,
    success,
    attempt: String(attempt),
  });

  // Update subscription last delivered timestamp
  if (success) {
    await db
      .update(webhookSubscriptions)
      .set({
        lastDeliveredAt: new Date(),
        failureCount: "0",
      })
      .where(eq(webhookSubscriptions.id, subscriptionId));

    logger.info(
      { subscriptionId, event, deliveryId, statusCode, durationMs },
      "Webhook delivered successfully"
    );
  } else {
    // Increment failure count
    const newFailureCount = Number(subscription.failureCount) + 1;

    // On final failure, mark as unhealthy by disabling
    if (attempt >= MAX_ATTEMPTS) {
      const shouldDisable = newFailureCount >= 10;
      await db
        .update(webhookSubscriptions)
        .set({
          failureCount: String(newFailureCount),
          ...(shouldDisable ? { enabled: false } : {}),
        })
        .where(eq(webhookSubscriptions.id, subscriptionId));

      if (shouldDisable) {
        logger.error(
          { subscriptionId, failureCount: newFailureCount },
          "Webhook subscription disabled due to repeated failures"
        );
      }

      logger.error(
        {
          subscriptionId,
          event,
          deliveryId,
          statusCode,
          attempt,
          durationMs,
        },
        "Webhook delivery failed after all retries"
      );
    } else {
      await db
        .update(webhookSubscriptions)
        .set({ failureCount: String(newFailureCount) })
        .where(eq(webhookSubscriptions.id, subscriptionId));

      // Throw to trigger BullMQ retry with exponential backoff
      throw new Error(
        `Webhook delivery failed (status=${statusCode}, attempt=${attempt}/${MAX_ATTEMPTS})`
      );
    }
  }

  return { delivered: success, statusCode };
}
