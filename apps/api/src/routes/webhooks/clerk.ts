import {
  creditBalances,
  db,
  organizations,
  orgMembers,
  users,
} from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { eq } from "drizzle-orm";
import { Hono } from "hono";

const logger = createLogger("api:webhooks:clerk");
const clerkWebhookApp = new Hono();

async function handleUserCreated(data: Record<string, unknown>) {
  const id = generateId("usr");
  await db.insert(users).values({
    id,
    clerkId: data.id as string,
    email:
      (
        data.email_addresses as Array<{ email_address: string }> | undefined
      )?.[0]?.email_address ?? "",
    name:
      `${(data.first_name as string) ?? ""} ${(data.last_name as string) ?? ""}`.trim() ||
      null,
    avatarUrl: (data.image_url as string) ?? null,
  });
  logger.info({ userId: data.id, dbId: id }, "User created in DB");
}

async function handleUserUpdated(data: Record<string, unknown>) {
  await db
    .update(users)
    .set({
      email: (
        data.email_addresses as Array<{ email_address: string }> | undefined
      )?.[0]?.email_address,
      name:
        `${(data.first_name as string) ?? ""} ${(data.last_name as string) ?? ""}`.trim() ||
        null,
      avatarUrl: (data.image_url as string) ?? null,
      updatedAt: new Date(),
    })
    .where(eq(users.clerkId, data.id as string));
  logger.info({ userId: data.id }, "User updated in DB");
}

async function handleUserDeleted(data: Record<string, unknown>) {
  await db
    .update(users)
    .set({
      email: `deleted_${data.id}@deleted.local`,
      name: null,
      avatarUrl: null,
      updatedAt: new Date(),
    })
    .where(eq(users.clerkId, data.id as string));
  logger.info({ userId: data.id }, "User soft-deleted");
}

async function handleOrgCreated(data: Record<string, unknown>) {
  const orgId = generateId("org");
  await db.insert(organizations).values({
    id: orgId,
    name: data.name as string,
    slug: data.slug as string,
    planTier: "hobby",
  });

  await db.insert(creditBalances).values({
    orgId,
    balance: 50,
    reserved: 0,
  });

  logger.info(
    { clerkOrgId: data.id, dbOrgId: orgId },
    "Organization created with hobby plan"
  );
}

async function handleMembershipCreated(data: Record<string, unknown>) {
  const publicUserData = data.public_user_data as
    | Record<string, unknown>
    | undefined;
  const user = await db.query.users.findFirst({
    where: eq(users.clerkId, publicUserData?.user_id as string),
    columns: { id: true },
  });

  if (!user) {
    return;
  }

  const org = await db.query.organizations.findFirst({
    columns: { id: true },
  });

  if (!org) {
    return;
  }

  await db.insert(orgMembers).values({
    id: generateId("om"),
    orgId: org.id,
    userId: user.id,
    role: data.role === "admin" ? "admin" : "member",
    joinedAt: new Date(),
  });
  logger.info({ userId: user.id, orgId: org.id }, "Org member added");
}

function handleMembershipDeleted(data: Record<string, unknown>) {
  const publicUserData = data.public_user_data as
    | Record<string, unknown>
    | undefined;
  logger.info({ userId: publicUserData?.user_id }, "Org member removed");
}

const EVENT_HANDLERS: Record<
  string,
  (data: Record<string, unknown>) => void | Promise<void>
> = {
  "user.created": handleUserCreated,
  "user.updated": handleUserUpdated,
  "user.deleted": handleUserDeleted,
  "organization.created": handleOrgCreated,
  "organizationMembership.created": handleMembershipCreated,
  "organizationMembership.deleted": handleMembershipDeleted,
};

clerkWebhookApp.post("/", async (c) => {
  const body = await c.req.json();
  const eventType = body.type as string;

  try {
    const handler = EVENT_HANDLERS[eventType];
    if (handler) {
      await handler(body.data as Record<string, unknown>);
    } else {
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
