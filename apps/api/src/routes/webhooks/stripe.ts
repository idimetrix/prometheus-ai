import { Hono } from "hono";
import { createLogger } from "@prometheus/logger";

const logger = createLogger("api:webhooks:stripe");
const stripeWebhookApp = new Hono();

stripeWebhookApp.post("/", async (c) => {
  const signature = c.req.header("stripe-signature");
  if (!signature) {
    return c.json({ error: "Missing stripe-signature header" }, 400);
  }

  const body = await c.req.text();

  try {
    // TODO: Verify webhook signature and process events
    // const event = await stripeService.constructWebhookEvent(body, signature);

    const event = JSON.parse(body) as { type: string; data: { object: Record<string, unknown> } };

    switch (event.type) {
      case "checkout.session.completed":
        logger.info("Checkout session completed");
        // TODO: Activate subscription or add credits
        break;

      case "customer.subscription.created":
      case "customer.subscription.updated":
        logger.info({ type: event.type }, "Subscription changed");
        // TODO: Update subscription status in DB
        break;

      case "customer.subscription.deleted":
        logger.info("Subscription cancelled");
        // TODO: Downgrade to hobby tier
        break;

      case "invoice.paid":
        logger.info("Invoice paid");
        // TODO: Grant monthly credits
        break;

      case "invoice.payment_failed":
        logger.warn("Invoice payment failed");
        // TODO: Notify user, mark subscription as past_due
        break;

      default:
        logger.debug({ type: event.type }, "Unhandled webhook event");
    }

    return c.json({ received: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ error: msg }, "Webhook processing failed");
    return c.json({ error: "Webhook processing failed" }, 400);
  }
});

export { stripeWebhookApp };
