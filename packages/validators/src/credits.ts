import { z } from "zod";

// ---------- Purchase ----------
export const purchaseCreditsSchema = z.object({
  amount: z.enum(["100", "500", "1000", "5000"]),
});

// ---------- Billing / Checkout ----------
export const createCheckoutSchema = z.object({
  planTier: z.enum(["hobby", "starter", "pro", "team", "studio", "enterprise"]),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
});

export const creditPurchaseCheckoutSchema = z.object({
  creditAmount: z.enum(["100", "500", "1000", "5000"]),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
});

// ---------- Subscription ----------
export const updateSubscriptionSchema = z.object({
  planTier: z.enum(["hobby", "starter", "pro", "team", "studio", "enterprise"]),
});

export const cancelSubscriptionSchema = z.object({
  reason: z.string().max(500).optional(),
  cancelAtPeriodEnd: z.boolean().default(true),
});

// ---------- Credit transactions ----------
export const creditTransactionTypeSchema = z.enum([
  "purchase",
  "consumption",
  "refund",
  "bonus",
  "subscription_grant",
]);

export const listTransactionsSchema = z.object({
  type: creditTransactionTypeSchema.optional(),
  limit: z.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

// ---------- Credit grant (admin) ----------
export const grantCreditsSchema = z.object({
  orgId: z.string().min(1),
  amount: z.number().int().positive().max(100_000),
  reason: z.string().min(1).max(500),
});

// ---------- Output schemas ----------
export const creditBalanceOutputSchema = z.object({
  balance: z.number(),
  reserved: z.number(),
  available: z.number(),
  updatedAt: z.string().datetime(),
});

export const creditTransactionOutputSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  type: creditTransactionTypeSchema,
  amount: z.number(),
  balanceAfter: z.number(),
  taskId: z.string().nullable(),
  description: z.string(),
  createdAt: z.string().datetime(),
});

export const transactionListOutputSchema = z.object({
  items: z.array(creditTransactionOutputSchema),
  nextCursor: z.string().nullable(),
});

export const subscriptionOutputSchema = z.object({
  id: z.string(),
  planTier: z.string(),
  status: z.enum(["active", "past_due", "cancelled", "trialing", "incomplete"]),
  creditsIncluded: z.number(),
  currentPeriodStart: z.string().datetime().nullable(),
  currentPeriodEnd: z.string().datetime().nullable(),
});

// ---------- Types ----------
export type PurchaseCreditsInput = z.infer<typeof purchaseCreditsSchema>;
export type CreateCheckoutInput = z.infer<typeof createCheckoutSchema>;
export type CreditPurchaseCheckoutInput = z.infer<
  typeof creditPurchaseCheckoutSchema
>;
export type UpdateSubscriptionInput = z.infer<typeof updateSubscriptionSchema>;
export type CancelSubscriptionInput = z.infer<typeof cancelSubscriptionSchema>;
export type ListTransactionsInput = z.infer<typeof listTransactionsSchema>;
export type GrantCreditsInput = z.infer<typeof grantCreditsSchema>;
export type CreditBalanceOutput = z.infer<typeof creditBalanceOutputSchema>;
export type CreditTransactionOutput = z.infer<
  typeof creditTransactionOutputSchema
>;
export type TransactionListOutput = z.infer<typeof transactionListOutputSchema>;
export type SubscriptionOutput = z.infer<typeof subscriptionOutputSchema>;
