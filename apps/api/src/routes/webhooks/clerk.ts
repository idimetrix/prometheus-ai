import { createHmac, timingSafeEqual } from "node:crypto";
import {
  creditBalances,
  db,
  organizations,
  orgMembers,
  processedWebhookEvents,
  users,
} from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { eq } from "drizzle-orm";
import { Hono } from "hono";

const logger = createLogger("api:webhooks:clerk");
const clerkWebhookApp = new Hono();

const CLERK_WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET ?? "";

// ---------------------------------------------------------------------------
// Svix signature verification
// ---------------------------------------------------------------------------

function verifySvixSignature(
  payload: string,
  headers: {
    svixId: string | undefined;
    svixTimestamp: string | undefined;
    svixSignature: string | undefined;
  }
): boolean {
  if (!CLERK_WEBHOOK_SECRET) {
    logger.warn("CLERK_WEBHOOK_SECRET not set — skipping verification");
    return true;
  }

  const { svixId, svixTimestamp, svixSignature } = headers;
  if (!(svixId && svixTimestamp && svixSignature)) {
    return false;
  }

  // Reject timestamps older than 5 minutes to prevent replay attacks
  const ts = Number.parseInt(svixTimestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  if (Number.isNaN(ts) || Math.abs(now - ts) > 300) {
    return false;
  }

  // Svix secret is base64-encoded with "whsec_" prefix
  const secretBytes = Buffer.from(
    CLERK_WEBHOOK_SECRET.startsWith("whsec_")
      ? CLERK_WEBHOOK_SECRET.slice(6)
      : CLERK_WEBHOOK_SECRET,
    "base64"
  );

  const signedContent = `${svixId}.${svixTimestamp}.${payload}`;
  const expectedSignature = createHmac("sha256", secretBytes)
    .update(signedContent)
    .digest("base64");

  // Svix sends multiple signatures separated by spaces, each prefixed with "v1,"
  const signatures = svixSignature.split(" ");
  for (const sig of signatures) {
    const sigValue = sig.startsWith("v1,") ? sig.slice(3) : sig;
    try {
      const expected = Buffer.from(expectedSignature, "base64");
      const actual = Buffer.from(sigValue, "base64");
      if (
        expected.length === actual.length &&
        timingSafeEqual(expected, actual)
      ) {
        return true;
      }
    } catch {
      // Skip invalid signatures
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

async function isEventAlreadyProcessed(eventId: string): Promise<boolean> {
  const existing = await db.query.processedWebhookEvents.findFirst({
    where: eq(processedWebhookEvents.eventId, eventId),
  });
  return !!existing;
}

async function recordProcessedEvent(
  eventId: string,
  eventType: string
): Promise<void> {
  await db
    .insert(processedWebhookEvents)
    .values({
      eventId,
      eventType,
      processedAt: new Date(),
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    })
    .onConflictDoNothing();
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

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
    logger.warn(
      { userId: publicUserData?.user_id },
      "User not found for membership — skipping"
    );
    return;
  }

  // Look up org by slug from the Clerk organization data
  const orgSlug = (data.organization as Record<string, unknown> | undefined)
    ?.slug as string | undefined;
  const org = orgSlug
    ? await db.query.organizations.findFirst({
        where: eq(organizations.slug, orgSlug),
        columns: { id: true },
      })
    : null;

  if (!org) {
    logger.warn(
      { orgSlug },
      "Organization not found for membership — skipping"
    );
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
  const rawBody = await c.req.text();

  // Verify Svix signature
  const verified = verifySvixSignature(rawBody, {
    svixId: c.req.header("svix-id"),
    svixTimestamp: c.req.header("svix-timestamp"),
    svixSignature: c.req.header("svix-signature"),
  });

  if (!verified) {
    logger.warn("Clerk webhook signature verification failed");
    return c.json({ error: "Invalid signature" }, 401);
  }

  const body = JSON.parse(rawBody) as {
    type: string;
    data: Record<string, unknown>;
  };
  const eventType = body.type;

  // Idempotency: use svix-id as event identifier
  const eventId = c.req.header("svix-id") ?? `clerk_${Date.now()}`;
  if (await isEventAlreadyProcessed(eventId)) {
    logger.debug(
      { eventId, type: eventType },
      "Duplicate Clerk webhook — skipping"
    );
    return c.json({ received: true, duplicate: true });
  }

  try {
    const handler = EVENT_HANDLERS[eventType];
    if (handler) {
      await handler(body.data);
    } else {
      logger.debug({ type: eventType }, "Unhandled Clerk webhook");
    }

    await recordProcessedEvent(eventId, eventType);
    return c.json({ received: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ error: msg, eventType }, "Clerk webhook failed");
    return c.json({ error: "Webhook processing failed" }, 400);
  }
});

export { clerkWebhookApp };
