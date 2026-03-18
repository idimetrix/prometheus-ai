import Stripe from "stripe";
import { createLogger } from "@prometheus/logger";

const logger = createLogger("billing:stripe");

let stripeInstance: Stripe | null = null;

function getStripe(): Stripe {
  if (!stripeInstance) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY is required");
    stripeInstance = new Stripe(key, { apiVersion: "2025-02-24.acacia" as Stripe.LatestApiVersion });
  }
  return stripeInstance;
}

export class StripeService {
  private readonly stripe: Stripe;

  constructor() {
    this.stripe = getStripe();
  }

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
    logger.info({ customerId: customer.id, orgId: params.orgId }, "Stripe customer created");
    return customer.id;
  }

  async createSubscription(params: {
    customerId: string;
    priceId: string;
  }): Promise<Stripe.Subscription> {
    const subscription = await this.stripe.subscriptions.create({
      customer: params.customerId,
      items: [{ price: params.priceId }],
      payment_behavior: "default_incomplete",
      expand: ["latest_invoice.payment_intent"],
    });
    return subscription;
  }

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

  async createPortalSession(customerId: string, returnUrl: string): Promise<string> {
    const session = await this.stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
    return session.url;
  }

  async constructWebhookEvent(body: string, signature: string): Promise<Stripe.Event> {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is required");
    return this.stripe.webhooks.constructEvent(body, signature, secret);
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    await this.stripe.subscriptions.cancel(subscriptionId);
    logger.info({ subscriptionId }, "Subscription cancelled");
  }
}
