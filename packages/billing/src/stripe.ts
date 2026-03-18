import { db, organizations, subscriptions } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { eq } from "drizzle-orm";
import Stripe from "stripe";
import {
  CREDIT_PACKS,
  comparePlans,
  type PlanSlug,
  PRICING_TIERS,
} from "./products";

const logger = createLogger("billing:stripe");

// ---------------------------------------------------------------------------
// Stripe singleton
// ---------------------------------------------------------------------------

let stripeInstance: Stripe | null = null;

function getStripe(): Stripe {
  if (!stripeInstance) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error("STRIPE_SECRET_KEY is required");
    }
    stripeInstance = new Stripe(key, {
      apiVersion: "2025-02-24.acacia" as Stripe.LatestApiVersion,
    });
  }
  return stripeInstance;
}

// ---------------------------------------------------------------------------
// StripeService
// ---------------------------------------------------------------------------

export class StripeService {
  private readonly stripe: Stripe;

  constructor() {
    this.stripe = getStripe();
  }

  // -----------------------------------------------------------------------
  // Customer management
  // -----------------------------------------------------------------------

  async createCustomer(params: {
    email: string;
    name: string;
    orgId: string;
  }): Promise<string> {
    const customer = await this.stripe.customers.create({
      email: params.email,
      name: params.name,
      metadata: { orgId: params.orgId },
    });

    // Persist the Stripe customer ID on the organization
    await db
      .update(organizations)
      .set({ stripeCustomerId: customer.id, updatedAt: new Date() })
      .where(eq(organizations.id, params.orgId));

    logger.info(
      { customerId: customer.id, orgId: params.orgId },
      "Stripe customer created"
    );
    return customer.id;
  }

  async getOrCreateCustomer(params: {
    email: string;
    name: string;
    orgId: string;
  }): Promise<string> {
    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, params.orgId),
    });

    if (org?.stripeCustomerId) {
      return org.stripeCustomerId;
    }

    return this.createCustomer(params);
  }

  async getCustomer(customerId: string): Promise<Stripe.Customer | null> {
    try {
      const customer = await this.stripe.customers.retrieve(customerId);
      if (customer.deleted) {
        return null;
      }
      return customer as Stripe.Customer;
    } catch {
      return null;
    }
  }

  async updateCustomer(
    customerId: string,
    params: { email?: string; name?: string; metadata?: Record<string, string> }
  ): Promise<void> {
    await this.stripe.customers.update(customerId, params);
    logger.info({ customerId }, "Stripe customer updated");
  }

  // -----------------------------------------------------------------------
  // Subscription lifecycle
  // -----------------------------------------------------------------------

  async createSubscription(params: {
    customerId: string;
    priceId: string;
    orgId: string;
    trialDays?: number;
  }): Promise<Stripe.Subscription> {
    const subscription = await this.stripe.subscriptions.create({
      customer: params.customerId,
      items: [{ price: params.priceId }],
      payment_behavior: "default_incomplete",
      payment_settings: { save_default_payment_method: "on_subscription" },
      expand: ["latest_invoice.payment_intent"],
      metadata: { orgId: params.orgId },
      ...(params.trialDays ? { trial_period_days: params.trialDays } : {}),
    });

    // Persist subscription record
    await db.insert(subscriptions).values({
      id: generateId("sub"),
      orgId: params.orgId,
      planId: this.planIdFromPriceId(params.priceId),
      stripeSubscriptionId: subscription.id,
      status: subscription.status === "active" ? "active" : "incomplete",
      currentPeriodStart: new Date(
        (subscription.items.data[0]?.current_period_start ??
          subscription.start_date) * 1000
      ),
      currentPeriodEnd: new Date(
        (subscription.items.data[0]?.current_period_end ??
          subscription.start_date) * 1000
      ),
    });

    logger.info(
      { subscriptionId: subscription.id, orgId: params.orgId },
      "Subscription created"
    );
    return subscription;
  }

  async upgradeSubscription(params: {
    orgId: string;
    newPriceId: string;
    stripeSubscriptionId: string;
  }): Promise<Stripe.Subscription> {
    const sub = await this.stripe.subscriptions.retrieve(
      params.stripeSubscriptionId
    );
    const currentItemId = sub.items.data[0]?.id;
    if (!currentItemId) {
      throw new Error("No subscription items found");
    }

    // Prorate immediately for upgrades
    const updated = await this.stripe.subscriptions.update(
      params.stripeSubscriptionId,
      {
        items: [{ id: currentItemId, price: params.newPriceId }],
        proration_behavior: "always_invoice",
        metadata: { orgId: params.orgId },
      }
    );

    // Update the local subscription and org plan tier
    const newPlan = this.planSlugFromPriceId(params.newPriceId);
    await db
      .update(subscriptions)
      .set({
        planId: newPlan,
        status: "active",
        currentPeriodStart: new Date(
          (updated.items.data[0]?.current_period_start ?? updated.start_date) *
            1000
        ),
        currentPeriodEnd: new Date(
          (updated.items.data[0]?.current_period_end ?? updated.start_date) *
            1000
        ),
      })
      .where(
        eq(subscriptions.stripeSubscriptionId, params.stripeSubscriptionId)
      );

    await db
      .update(organizations)
      .set({ planTier: newPlan as PlanSlug, updatedAt: new Date() })
      .where(eq(organizations.id, params.orgId));

    logger.info(
      {
        orgId: params.orgId,
        newPlan,
        subscriptionId: params.stripeSubscriptionId,
      },
      "Subscription upgraded"
    );
    return updated;
  }

  async downgradeSubscription(params: {
    orgId: string;
    newPriceId: string;
    stripeSubscriptionId: string;
  }): Promise<Stripe.Subscription> {
    const sub = await this.stripe.subscriptions.retrieve(
      params.stripeSubscriptionId
    );
    const currentItemId = sub.items.data[0]?.id;
    if (!currentItemId) {
      throw new Error("No subscription items found");
    }

    // Downgrade takes effect at end of billing period
    const updated = await this.stripe.subscriptions.update(
      params.stripeSubscriptionId,
      {
        items: [{ id: currentItemId, price: params.newPriceId }],
        proration_behavior: "none",
        metadata: { orgId: params.orgId },
      }
    );

    logger.info(
      { orgId: params.orgId, subscriptionId: params.stripeSubscriptionId },
      "Subscription downgrade scheduled for end of period"
    );
    return updated;
  }

  /**
   * Change plan — automatically detects upgrade vs downgrade.
   */
  async changePlan(params: {
    orgId: string;
    currentPlan: PlanSlug;
    newPlan: PlanSlug;
    stripeSubscriptionId: string;
  }): Promise<Stripe.Subscription> {
    const newTier = PRICING_TIERS[params.newPlan];
    if (!newTier.stripePriceId) {
      throw new Error(`Plan ${params.newPlan} has no Stripe price configured`);
    }

    const direction = comparePlans(params.currentPlan, params.newPlan);
    if (direction === 0) {
      throw new Error("Already on this plan");
    }

    if (direction > 0) {
      return await this.upgradeSubscription({
        orgId: params.orgId,
        newPriceId: newTier.stripePriceId,
        stripeSubscriptionId: params.stripeSubscriptionId,
      });
    }

    return await this.downgradeSubscription({
      orgId: params.orgId,
      newPriceId: newTier.stripePriceId,
      stripeSubscriptionId: params.stripeSubscriptionId,
    });
  }

  async cancelSubscription(
    subscriptionId: string,
    immediate = false
  ): Promise<void> {
    if (immediate) {
      await this.stripe.subscriptions.cancel(subscriptionId);
    } else {
      // Cancel at end of period
      await this.stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: true,
      });
    }

    await db
      .update(subscriptions)
      .set({ status: "cancelled" })
      .where(eq(subscriptions.stripeSubscriptionId, subscriptionId));

    logger.info({ subscriptionId, immediate }, "Subscription cancelled");
  }

  async reactivateSubscription(subscriptionId: string): Promise<void> {
    await this.stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: false,
    });

    await db
      .update(subscriptions)
      .set({ status: "active" })
      .where(eq(subscriptions.stripeSubscriptionId, subscriptionId));

    logger.info({ subscriptionId }, "Subscription reactivated");
  }

  async getSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
    return await this.stripe.subscriptions.retrieve(subscriptionId);
  }

  // -----------------------------------------------------------------------
  // Checkout sessions
  // -----------------------------------------------------------------------

  /**
   * Create a checkout session for a subscription plan.
   */
  async createSubscriptionCheckout(params: {
    customerId: string;
    priceId: string;
    orgId: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<string> {
    const session = await this.stripe.checkout.sessions.create({
      customer: params.customerId,
      line_items: [{ price: params.priceId, quantity: 1 }],
      mode: "subscription",
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      metadata: { orgId: params.orgId, type: "subscription" },
      subscription_data: { metadata: { orgId: params.orgId } },
    });
    logger.info(
      { sessionId: session.id, orgId: params.orgId },
      "Subscription checkout created"
    );
    return session.url ?? "";
  }

  /**
   * Create a checkout session for a credit pack purchase.
   */
  async createCreditPackCheckout(params: {
    customerId: string;
    creditPackId: string;
    orgId: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<string> {
    const pack = CREDIT_PACKS.find((p) => p.id === params.creditPackId);
    if (!pack) {
      throw new Error(`Unknown credit pack: ${params.creditPackId}`);
    }
    if (!pack.stripePriceId) {
      throw new Error(`Credit pack ${params.creditPackId} has no Stripe price`);
    }

    const session = await this.stripe.checkout.sessions.create({
      customer: params.customerId,
      line_items: [{ price: pack.stripePriceId, quantity: 1 }],
      mode: "payment",
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      metadata: {
        orgId: params.orgId,
        type: "credit_pack",
        creditPackId: pack.id,
        credits: String(pack.credits),
      },
    });

    logger.info(
      { sessionId: session.id, orgId: params.orgId, pack: pack.id },
      "Credit pack checkout created"
    );
    return session.url ?? "";
  }

  /**
   * Generic checkout session creation (backward-compatible).
   */
  async createCheckoutSession(params: {
    customerId: string;
    priceId: string;
    successUrl: string;
    cancelUrl: string;
    mode: "subscription" | "payment";
    metadata?: Record<string, string>;
  }): Promise<string> {
    const session = await this.stripe.checkout.sessions.create({
      customer: params.customerId,
      line_items: [{ price: params.priceId, quantity: 1 }],
      mode: params.mode,
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      metadata: params.metadata,
    });
    return session.url ?? "";
  }

  // -----------------------------------------------------------------------
  // Billing portal
  // -----------------------------------------------------------------------

  async createPortalSession(
    customerId: string,
    returnUrl: string
  ): Promise<string> {
    const session = await this.stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
    return session.url;
  }

  // -----------------------------------------------------------------------
  // Webhooks
  // -----------------------------------------------------------------------

  constructWebhookEvent(body: string, signature: string): Stripe.Event {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      throw new Error("STRIPE_WEBHOOK_SECRET is required");
    }
    return this.stripe.webhooks.constructEvent(body, signature, secret);
  }

  // -----------------------------------------------------------------------
  // Invoices
  // -----------------------------------------------------------------------

  async getUpcomingInvoice(customerId: string): Promise<Stripe.Invoice> {
    return await this.stripe.invoices.createPreview({ customer: customerId });
  }

  async listInvoices(
    customerId: string,
    limit = 10
  ): Promise<Stripe.Invoice[]> {
    const list = await this.stripe.invoices.list({
      customer: customerId,
      limit,
    });
    return list.data;
  }

  // -----------------------------------------------------------------------
  // Payment methods
  // -----------------------------------------------------------------------

  async listPaymentMethods(
    customerId: string
  ): Promise<Stripe.PaymentMethod[]> {
    const list = await this.stripe.paymentMethods.list({
      customer: customerId,
      type: "card",
    });
    return list.data;
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  /**
   * Resolve a Stripe price ID to the internal plan slug.
   */
  private planSlugFromPriceId(priceId: string): PlanSlug {
    for (const [slug, tier] of Object.entries(PRICING_TIERS)) {
      if (tier.stripePriceId === priceId) {
        return slug as PlanSlug;
      }
    }
    return "hobby";
  }

  /**
   * Alias returning plan slug as the planId for the subscriptions table.
   */
  private planIdFromPriceId(priceId: string): string {
    return this.planSlugFromPriceId(priceId);
  }
}
