/**
 * E-commerce Skill Pack
 *
 * Provides agent hints, patterns, and conventions for building
 * e-commerce features: payment processing, cart management,
 * checkout flows, inventory, and order management.
 */

export interface SkillPack {
  agentHints: Record<string, string>;
  category: string;
  description: string;
  id: string;
  name: string;
  patterns: SkillPattern[];
  tags: string[];
}

export interface SkillPattern {
  context: string;
  description: string;
  implementation: string;
  name: string;
}

export const ECOMMERCE_SKILL_PACK: SkillPack = {
  id: "skill-pack-ecommerce",
  name: "E-commerce",
  description:
    "Payment processing, cart management, checkout flows, inventory, and order management patterns",
  category: "skill-pack",
  tags: ["ecommerce", "payments", "cart", "checkout", "stripe", "orders"],

  patterns: [
    {
      name: "Shopping Cart",
      description:
        "Persistent cart with optimistic updates and conflict resolution",
      context:
        "Users need to add/remove items, update quantities, and see real-time totals",
      implementation: `
- Cart stored server-side (DB) with session/user association
- CartItem table: id, cartId, productId, variantId, quantity, price (snapshotted at add-time)
- Use optimistic updates on the client, reconcile on server response
- Price verification at checkout (re-check current price vs snapshot)
- Cart expiry: auto-clear carts older than 30 days
- Guest cart merging: merge anonymous cart into user cart on login
`,
    },
    {
      name: "Payment Processing (Stripe)",
      description:
        "Stripe integration with Payment Intents for SCA-compliant payments",
      context: "Process credit card payments with 3D Secure support",
      implementation: `
- Use Stripe Payment Intents API (not Charges)
- Create PaymentIntent server-side with amount and metadata
- Use Stripe Elements or Checkout Sessions on frontend
- Handle webhook events: payment_intent.succeeded, payment_intent.payment_failed
- Store Stripe customer ID on user record for repeat purchases
- Idempotency keys on all Stripe API calls
- Never log or store raw card numbers
`,
    },
    {
      name: "Checkout Flow",
      description:
        "Multi-step checkout with address, shipping, payment, and confirmation",
      context: "Convert cart to order through a validated checkout process",
      implementation: `
- Steps: Cart Review -> Shipping Address -> Shipping Method -> Payment -> Confirmation
- Validate inventory availability at checkout start and before payment
- Reserve inventory during checkout (with timeout)
- Calculate shipping costs based on address and items
- Apply discount codes/coupons with server-side validation
- Create Order record only after successful payment
- Send confirmation email via background job
- Order statuses: pending, paid, processing, shipped, delivered, cancelled, refunded
`,
    },
    {
      name: "Inventory Management",
      description: "Stock tracking with reservations and low-stock alerts",
      context: "Track product availability across variants and warehouses",
      implementation: `
- Inventory table: productId, variantId, warehouseId, quantity, reservedQuantity
- Available = quantity - reservedQuantity
- Reserve on checkout start, release on timeout or cancellation
- Use database transactions for stock updates (prevent overselling)
- Low-stock alerts when available < threshold
- Backorder support: allow orders when out of stock with longer fulfillment time
`,
    },
    {
      name: "Order Management",
      description: "Order lifecycle from placement to fulfillment",
      context: "Track and manage orders through their lifecycle",
      implementation: `
- Order table: id, orgId, userId, status, subtotal, tax, shippingCost, total, currency
- OrderItem table: id, orderId, productId, variantId, quantity, unitPrice, total
- OrderEvent table: id, orderId, type, data, createdAt (audit trail)
- Status machine: pending -> paid -> processing -> shipped -> delivered
- Cancellation: only allowed before 'shipped' status
- Refund flow: create refund record, process via payment provider, update inventory
`,
    },
  ],

  agentHints: {
    architect:
      "Design with Stripe Payment Intents for SCA compliance. Use database transactions for inventory. Event-sourced order history. Separate cart from order models.",
    frontend_coder:
      "Multi-step checkout with form validation at each step. Stripe Elements for PCI-compliant card input. Optimistic cart updates.",
    backend_coder:
      "Idempotent payment processing. Webhook handlers for async payment events. Inventory reservation with timeouts. Never trust client-side prices.",
    test_engineer:
      "Test payment flows with Stripe test mode. Test inventory edge cases (concurrent purchases, stock depletion). Test order state transitions.",
    security_auditor:
      "Verify PCI DSS compliance. No card data in logs. Validate webhook signatures. Check for price manipulation vulnerabilities.",
  },
};
