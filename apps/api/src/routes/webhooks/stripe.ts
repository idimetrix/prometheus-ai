import { CreditService } from "@prometheus/billing/credits";
import type { PlanSlug } from "@prometheus/billing/products";
import {
  getCreditPackByPriceId,
  PRICING_TIERS,
} from "@prometheus/billing/products";
import { StripeService } from "@prometheus/billing/stripe";
import {
  db,
  organizations,
  processedWebhookEvents,
  subscriptions,
} from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { and, eq, lt } from "drizzle-orm";
import { Hono } from "hono";

const logger = createLogger("api:webhooks:stripe");
const stripeService = new StripeService();
const creditService = new CreditService();
const stripeWebhookApp = new Hono();

/** TTL for webhook idempotency records: 48 hours */
const WEBHOOK_IDEMPOTENCY_TTL_MS = 48 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// DB-backed idempotency
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
      expiresAt: new Date(Date.now() + WEBHOOK_IDEMPOTENCY_TTL_MS),
    })
    .onConflictDoNothing();
}

function pruneExpiredWebhookEvents(): void {
  db.delete(processedWebhookEvents)
    .where(lt(processedWebhookEvents.expiresAt, new Date()))
    .then(() => {
      // pruning complete
    })
    .catch((err: unknown) => {
      logger.warn(
        { error: String(err) },
        "Failed to prune expired webhook events"
      );
    });
}

// ---------------------------------------------------------------------------
// Stripe status mapping
// ---------------------------------------------------------------------------

function mapStripeStatus(
  status: string
): "active" | "past_due" | "cancelled" | "trialing" | "incomplete" {
  switch (status) {
    case "active":
      return "active";
    case "past_due":
      return "past_due";
    case "canceled":
    case "cancelled":
      return "cancelled";
    case "trialing":
      return "trialing";
    default:
      return "incomplete";
  }
}

async function handleCheckoutCompleted(session: Record<string, unknown>) {
  const metadata = session.metadata as Record<string, string> | undefined;
  const orgId = metadata?.orgId;

  if (!orgId) {
    logger.warn(
      { sessionId: session.id },
      "Checkout completed with no orgId in metadata"
    );
    return;
  }

  const sessionMode = session.mode as string;

  if (sessionMode === "payment") {
    await handleCheckoutPayment(orgId, metadata);
  }

  if (sessionMode === "subscription") {
    await handleCheckoutSubscription(orgId, metadata, session);
  }
}

async function handleCheckoutPayment(
  orgId: string,
  metadata: Record<string, string> | undefined
) {
  const creditsStr = metadata?.credits;
  const creditPackId = metadata?.creditPackId;

  let creditAmount = 0;
  if (creditPackId) {
    const pack = getCreditPackByPriceId(creditPackId);
    creditAmount = pack?.credits ?? Number.parseInt(creditsStr ?? "0", 10);
  } else if (creditsStr) {
    creditAmount = Number.parseInt(creditsStr, 10);
  }

  if (creditAmount > 0) {
    await creditService.addCredits({
      orgId,
      amount: creditAmount,
      type: "purchase",
      description: `Purchased ${creditAmount} credits`,
    });

    logger.info(
      { orgId, amount: creditAmount },
      "Credits purchased via checkout"
    );
  }
}

async function handleCheckoutSubscription(
  orgId: string,
  metadata: Record<string, string> | undefined,
  session: Record<string, unknown>
) {
  const planTier = metadata?.planTier;
  if (planTier) {
    await db
      .update(organizations)
      .set({
        planTier: planTier as PlanSlug,
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, orgId));

    logger.info({ orgId, planTier }, "Plan activated via checkout");
  }

  const stripeSubscriptionId = session.subscription as string | undefined;
  if (stripeSubscriptionId && planTier) {
    const existingSub = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.stripeSubscriptionId, stripeSubscriptionId),
    });

    if (existingSub) {
      await db
        .update(subscriptions)
        .set({ status: "active", planId: planTier })
        .where(eq(subscriptions.id, existingSub.id));
    } else {
      await db.insert(subscriptions).values({
        id: generateId("sub"),
        orgId,
        planId: planTier,
        stripeSubscriptionId,
        status: "active",
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });
    }
  }
}

async function handleSubscriptionCreated(sub: Record<string, unknown>) {
  const customerId = sub.customer as string;
  const stripeSubId = sub.id as string;
  const status = sub.status as string;
  const metadata = sub.metadata as Record<string, string> | undefined;

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.stripeCustomerId, customerId),
  });

  if (!org) {
    logger.warn({ customerId }, "Subscription created for unknown customer");
    return;
  }

  const existingSub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.stripeSubscriptionId, stripeSubId),
  });

  const planId = metadata?.orgId ? org.planTier : "starter";

  const periodStart = sub.current_period_start
    ? new Date((sub.current_period_start as number) * 1000)
    : new Date();
  const periodEnd = sub.current_period_end
    ? new Date((sub.current_period_end as number) * 1000)
    : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  if (!existingSub) {
    await db.insert(subscriptions).values({
      id: generateId("sub"),
      orgId: org.id,
      planId,
      stripeSubscriptionId: stripeSubId,
      status: mapStripeStatus(status),
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
    });
  }

  logger.info({ orgId: org.id, status, stripeSubId }, "Subscription created");
}

async function handleSubscriptionUpdated(sub: Record<string, unknown>) {
  const customerId = sub.customer as string;
  const stripeSubId = sub.id as string;
  const status = sub.status as string;
  const cancelAtPeriodEnd = sub.cancel_at_period_end as boolean;

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.stripeCustomerId, customerId),
  });

  if (!org) {
    logger.warn({ customerId }, "Subscription updated for unknown customer");
    return;
  }

  const periodStart = sub.current_period_start
    ? new Date((sub.current_period_start as number) * 1000)
    : undefined;
  const periodEnd = sub.current_period_end
    ? new Date((sub.current_period_end as number) * 1000)
    : undefined;

  const items = sub.items as
    | { data?: Array<{ price?: { id?: string } }> }
    | undefined;
  const priceId = items?.data?.[0]?.price?.id;
  let newPlanTier: PlanSlug | null = null;

  if (priceId) {
    for (const [slug, tier] of Object.entries(PRICING_TIERS)) {
      if (tier.stripePriceId === priceId) {
        newPlanTier = slug as PlanSlug;
        break;
      }
    }
  }

  const mappedStatus = cancelAtPeriodEnd
    ? "cancelled"
    : mapStripeStatus(status);

  await db
    .update(subscriptions)
    .set({
      status: mappedStatus,
      ...(periodStart ? { currentPeriodStart: periodStart } : {}),
      ...(periodEnd ? { currentPeriodEnd: periodEnd } : {}),
      ...(newPlanTier ? { planId: newPlanTier } : {}),
    })
    .where(eq(subscriptions.stripeSubscriptionId, stripeSubId));

  if (newPlanTier && status === "active" && !cancelAtPeriodEnd) {
    await db
      .update(organizations)
      .set({ planTier: newPlanTier, updatedAt: new Date() })
      .where(eq(organizations.id, org.id));
  }

  logger.info(
    {
      orgId: org.id,
      status: mappedStatus,
      newPlanTier,
      cancelAtPeriodEnd,
    },
    "Subscription updated"
  );
}

async function handleSubscriptionDeleted(sub: Record<string, unknown>) {
  const customerId = sub.customer as string;
  const stripeSubId = sub.id as string;

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.stripeCustomerId, customerId),
  });

  if (!org) {
    logger.warn({ customerId }, "Subscription deleted for unknown customer");
    return;
  }

  await db
    .update(subscriptions)
    .set({ status: "cancelled" })
    .where(eq(subscriptions.stripeSubscriptionId, stripeSubId));

  await db
    .update(organizations)
    .set({ planTier: "hobby", updatedAt: new Date() })
    .where(eq(organizations.id, org.id));

  logger.info({ orgId: org.id }, "Subscription deleted, downgraded to hobby");
}

async function handleInvoicePaid(invoice: Record<string, unknown>) {
  const customerId = invoice.customer as string;
  const billingReason = invoice.billing_reason as string | undefined;

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.stripeCustomerId, customerId),
  });

  if (!org) {
    logger.warn({ customerId }, "Invoice paid for unknown customer");
    return;
  }

  const plan = PRICING_TIERS[org.planTier];

  if (plan?.creditsIncluded && plan.creditsIncluded > 0) {
    const invoiceId = invoice.id as string;
    const description = `Monthly ${plan.name} plan credit grant (invoice: ${invoiceId})`;

    await creditService.addCredits({
      orgId: org.id,
      amount: plan.creditsIncluded,
      type: "subscription_grant",
      description,
    });

    logger.info(
      {
        orgId: org.id,
        credits: plan.creditsIncluded,
        billingReason,
        invoiceId,
      },
      "Monthly credits granted"
    );
  }
}

const GRACE_MAX_ATTEMPTS = 3;

async function handleInvoicePaymentFailed(invoice: Record<string, unknown>) {
  const customerId = invoice.customer as string;
  const attemptCount = (invoice.attempt_count as number | undefined) ?? 0;
  const nextAttempt = invoice.next_payment_attempt as number | undefined;

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.stripeCustomerId, customerId),
  });

  if (!org) {
    logger.warn({ customerId }, "Invoice payment failed for unknown customer");
    return;
  }

  if (attemptCount >= GRACE_MAX_ATTEMPTS && !nextAttempt) {
    await db
      .update(subscriptions)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(subscriptions.orgId, org.id),
          eq(subscriptions.status, "past_due")
        )
      );

    await db
      .update(organizations)
      .set({ planTier: "hobby", updatedAt: new Date() })
      .where(eq(organizations.id, org.id));

    logger.error(
      { orgId: org.id, attemptCount },
      "Payment grace period exhausted — downgraded to hobby"
    );
    return;
  }

  await db
    .update(subscriptions)
    .set({ status: "past_due" })
    .where(
      and(eq(subscriptions.orgId, org.id), eq(subscriptions.status, "active"))
    );

  logger.warn(
    {
      orgId: org.id,
      attemptCount,
      nextAttempt: nextAttempt
        ? new Date(nextAttempt * 1000).toISOString()
        : null,
      gracePeriodRemaining: GRACE_MAX_ATTEMPTS - attemptCount,
    },
    "Invoice payment failed — grace period active"
  );
}

type StripeEventHandler = (data: Record<string, unknown>) => Promise<void>;

const EVENT_HANDLERS: Record<string, StripeEventHandler> = {
  "checkout.session.completed": handleCheckoutCompleted,
  "customer.subscription.created": handleSubscriptionCreated,
  "customer.subscription.updated": handleSubscriptionUpdated,
  "customer.subscription.deleted": handleSubscriptionDeleted,
  "invoice.paid": handleInvoicePaid,
  "invoice.payment_failed": handleInvoicePaymentFailed,
};

stripeWebhookApp.post("/", async (c) => {
  const signature = c.req.header("stripe-signature");
  if (!signature) {
    return c.json({ error: "Missing stripe-signature header" }, 400);
  }

  const body = await c.req.text();

  try {
    const event = await stripeService.constructWebhookEvent(body, signature);

    // DB-backed idempotency: skip already-processed events
    const alreadyProcessed = await isEventAlreadyProcessed(event.id);
    if (alreadyProcessed) {
      logger.info(
        { type: event.type, eventId: event.id },
        "Duplicate webhook event, skipping"
      );
      return c.json({ received: true, duplicate: true });
    }

    logger.info(
      { type: event.type, eventId: event.id },
      "Processing Stripe webhook"
    );

    const handler = EVENT_HANDLERS[event.type];
    if (handler) {
      await handler(event.data.object as unknown as Record<string, unknown>);
    } else {
      logger.debug({ type: event.type }, "Unhandled webhook event");
    }

    // Record event as processed after successful handling
    await recordProcessedEvent(event.id, event.type);

    // Periodically prune expired records (1% chance per request)
    if (Math.random() < 0.01) {
      pruneExpiredWebhookEvents();
    }

    return c.json({ received: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ error: msg }, "Webhook processing failed");
    return c.json({ error: "Webhook processing failed" }, 400);
  }
});

export { stripeWebhookApp };
