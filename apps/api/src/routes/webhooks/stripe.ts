import { Hono } from "hono";
import { createLogger } from "@prometheus/logger";
import { StripeService } from "@prometheus/billing/stripe";
import { PRICING_TIERS } from "@prometheus/billing/products";
import { db } from "@prometheus/db";
import {
  organizations, subscriptions, subscriptionPlans,
  creditBalances, creditTransactions,
} from "@prometheus/db";
import { generateId } from "@prometheus/utils";
import { eq, sql } from "drizzle-orm";

const logger = createLogger("api:webhooks:stripe");
const stripeService = new StripeService();
const stripeWebhookApp = new Hono();

stripeWebhookApp.post("/", async (c) => {
  const signature = c.req.header("stripe-signature");
  if (!signature) {
    return c.json({ error: "Missing stripe-signature header" }, 400);
  }

  const body = await c.req.text();

  try {
    const event = await stripeService.constructWebhookEvent(body, signature);

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Record<string, unknown>;
        const orgId = (session.metadata as Record<string, string>)?.orgId;
        const planTier = (session.metadata as Record<string, string>)?.planTier;
        const creditsAmount = (session.metadata as Record<string, string>)?.credits;

        if (orgId && creditsAmount) {
          // Credit pack purchase
          const amount = parseInt(creditsAmount, 10);
          await db.update(creditBalances)
            .set({
              balance: sql`${creditBalances.balance} + ${amount}`,
              updatedAt: new Date(),
            })
            .where(eq(creditBalances.orgId, orgId));

          const currentBalance = await db.query.creditBalances.findFirst({
            where: eq(creditBalances.orgId, orgId),
          });

          await db.insert(creditTransactions).values({
            id: generateId("ctx"),
            orgId,
            type: "purchase",
            amount,
            balanceAfter: currentBalance?.balance ?? amount,
            description: `Purchased ${amount} credits`,
          });

          logger.info({ orgId, amount }, "Credits purchased");
        }

        if (orgId && planTier) {
          // Subscription upgrade
          await db.update(organizations)
            .set({ planTier: planTier as "hobby" | "starter" | "pro" | "team" | "studio" | "enterprise", updatedAt: new Date() })
            .where(eq(organizations.id, orgId));

          logger.info({ orgId, planTier }, "Plan upgraded via checkout");
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object as Record<string, unknown>;
        const customerId = sub.customer as string;

        const org = await db.query.organizations.findFirst({
          where: eq(organizations.stripeCustomerId, customerId),
        });

        if (org) {
          const status = sub.status as string;
          logger.info({ orgId: org.id, status, type: event.type }, "Subscription changed");
        }
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Record<string, unknown>;
        const customerId = sub.customer as string;

        const org = await db.query.organizations.findFirst({
          where: eq(organizations.stripeCustomerId, customerId),
        });

        if (org) {
          await db.update(organizations)
            .set({ planTier: "hobby", updatedAt: new Date() })
            .where(eq(organizations.id, org.id));

          logger.info({ orgId: org.id }, "Subscription cancelled, downgraded to hobby");
        }
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object as Record<string, unknown>;
        const customerId = invoice.customer as string;

        const org = await db.query.organizations.findFirst({
          where: eq(organizations.stripeCustomerId, customerId),
        });

        if (org) {
          const plan = PRICING_TIERS[org.planTier];
          if (plan?.creditsIncluded) {
            await db.update(creditBalances)
              .set({
                balance: sql`${creditBalances.balance} + ${plan.creditsIncluded}`,
                updatedAt: new Date(),
              })
              .where(eq(creditBalances.orgId, org.id));

            const currentBalance = await db.query.creditBalances.findFirst({
              where: eq(creditBalances.orgId, org.id),
            });

            await db.insert(creditTransactions).values({
              id: generateId("ctx"),
              orgId: org.id,
              type: "subscription_grant",
              amount: plan.creditsIncluded,
              balanceAfter: currentBalance?.balance ?? plan.creditsIncluded,
              description: `Monthly ${plan.name} plan credit grant`,
            });

            logger.info({ orgId: org.id, credits: plan.creditsIncluded }, "Monthly credits granted");
          }
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Record<string, unknown>;
        const customerId = invoice.customer as string;

        const org = await db.query.organizations.findFirst({
          where: eq(organizations.stripeCustomerId, customerId),
        });

        if (org) {
          logger.warn({ orgId: org.id }, "Invoice payment failed");
        }
        break;
      }

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
