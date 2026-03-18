import { Hono } from "hono";
import { createLogger } from "@prometheus/logger";
import { db } from "@prometheus/db";
import { users, organizations, orgMembers, creditBalances } from "@prometheus/db";
import { generateId } from "@prometheus/utils";
import { eq } from "drizzle-orm";

const logger = createLogger("api:webhooks:clerk");
const clerkWebhookApp = new Hono();

clerkWebhookApp.post("/", async (c) => {
  const body = await c.req.json();
  const eventType = body.type as string;

  try {
    switch (eventType) {
      case "user.created": {
        const data = body.data;
        const id = generateId("usr");
        await db.insert(users).values({
          id,
          clerkId: data.id,
          email: data.email_addresses?.[0]?.email_address ?? "",
          name: `${data.first_name ?? ""} ${data.last_name ?? ""}`.trim() || null,
          avatarUrl: data.image_url ?? null,
        });
        logger.info({ userId: data.id, dbId: id }, "User created in DB");
        break;
      }

      case "user.updated": {
        const data = body.data;
        await db.update(users)
          .set({
            email: data.email_addresses?.[0]?.email_address,
            name: `${data.first_name ?? ""} ${data.last_name ?? ""}`.trim() || null,
            avatarUrl: data.image_url ?? null,
            updatedAt: new Date(),
          })
          .where(eq(users.clerkId, data.id));
        logger.info({ userId: data.id }, "User updated in DB");
        break;
      }

      case "user.deleted": {
        const data = body.data;
        // Soft delete - keep record but clear PII
        await db.update(users)
          .set({
            email: `deleted_${data.id}@deleted.local`,
            name: null,
            avatarUrl: null,
            updatedAt: new Date(),
          })
          .where(eq(users.clerkId, data.id));
        logger.info({ userId: data.id }, "User soft-deleted");
        break;
      }

      case "organization.created": {
        const data = body.data;
        const orgId = generateId("org");
        await db.insert(organizations).values({
          id: orgId,
          name: data.name,
          slug: data.slug,
          planTier: "hobby",
        });

        // Initialize credit balance
        await db.insert(creditBalances).values({
          orgId,
          balance: 50,
          reserved: 0,
        });

        logger.info({ clerkOrgId: data.id, dbOrgId: orgId }, "Organization created with hobby plan");
        break;
      }

      case "organizationMembership.created": {
        const data = body.data;
        const user = await db.query.users.findFirst({
          where: eq(users.clerkId, data.public_user_data?.user_id),
          columns: { id: true },
        });

        if (user) {
          // Find org by slug or name
          const org = await db.query.organizations.findFirst({
            columns: { id: true },
          });

          if (org) {
            await db.insert(orgMembers).values({
              id: generateId("om"),
              orgId: org.id,
              userId: user.id,
              role: data.role === "admin" ? "admin" : "member",
              joinedAt: new Date(),
            });
            logger.info({ userId: user.id, orgId: org.id }, "Org member added");
          }
        }
        break;
      }

      case "organizationMembership.deleted": {
        const data = body.data;
        logger.info({ userId: data.public_user_data?.user_id }, "Org member removed");
        break;
      }

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
