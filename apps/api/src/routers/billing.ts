import { z } from "zod";
import { router, protectedProcedure } from "../trpc";

export const billingRouter = router({
  getBalance: protectedProcedure.query(async ({ ctx }) => {
    // TODO: Query credit_balances for org
    return {
      balance: 50,
      reserved: 0,
      available: 50,
      planTier: "hobby" as const,
    };
  }),

  getPlan: protectedProcedure.query(async ({ ctx }) => {
    return {
      tier: "hobby" as const,
      name: "Hobby",
      creditsIncluded: 50,
      maxParallelAgents: 1,
      maxTasksPerDay: 5,
    };
  }),

  createCheckout: protectedProcedure
    .input(z.object({
      planTier: z.enum(["starter", "pro", "team", "studio"]),
    }))
    .mutation(async ({ input, ctx }) => {
      // TODO: Create Stripe checkout session
      return { checkoutUrl: "" };
    }),

  createPortalSession: protectedProcedure.mutation(async ({ ctx }) => {
    // TODO: Create Stripe billing portal session
    return { portalUrl: "" };
  }),

  purchaseCredits: protectedProcedure
    .input(z.object({
      amount: z.enum(["100", "500", "1000", "5000"]),
    }))
    .mutation(async ({ input, ctx }) => {
      // TODO: Create Stripe checkout for credit pack
      return { checkoutUrl: "" };
    }),

  getTransactions: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(20),
      cursor: z.string().optional(),
    }))
    .query(async ({ input, ctx }) => {
      // TODO: Query credit_transactions
      return { transactions: [], nextCursor: null as string | null };
    }),

  getUsage: protectedProcedure
    .input(z.object({
      periodStart: z.string().datetime().optional(),
      periodEnd: z.string().datetime().optional(),
    }))
    .query(async ({ input, ctx }) => {
      // TODO: Query usage_rollups
      return {
        totalTokens: 0,
        totalCostUsd: 0,
        taskCount: 0,
        creditsUsed: 0,
        byModel: {} as Record<string, { tokens: number; cost: number; count: number }>,
      };
    }),
});
