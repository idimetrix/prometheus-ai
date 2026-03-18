import { Hono } from "hono";
import { createLogger } from "@prometheus/logger";

const logger = createLogger("api:webhooks:clerk");
const clerkWebhookApp = new Hono();

clerkWebhookApp.post("/", async (c) => {
  const body = await c.req.json();
  const eventType = body.type as string;

  try {
    switch (eventType) {
      case "user.created":
        logger.info({ userId: body.data?.id }, "User created");
        // TODO: Create user record in DB
        break;

      case "user.updated":
        logger.info({ userId: body.data?.id }, "User updated");
        // TODO: Sync user data to DB
        break;

      case "user.deleted":
        logger.info({ userId: body.data?.id }, "User deleted");
        // TODO: Soft delete user
        break;

      case "organization.created":
        logger.info({ orgId: body.data?.id }, "Organization created");
        // TODO: Create org record in DB with hobby plan
        break;

      case "organizationMembership.created":
        logger.info("Org member added");
        // TODO: Add org_member record
        break;

      case "organizationMembership.deleted":
        logger.info("Org member removed");
        // TODO: Remove org_member record
        break;

      default:
        logger.debug({ type: eventType }, "Unhandled Clerk webhook");
    }

    return c.json({ received: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ error: msg }, "Clerk webhook failed");
    return c.json({ error: "Webhook processing failed" }, 400);
  }
});

export { clerkWebhookApp };
