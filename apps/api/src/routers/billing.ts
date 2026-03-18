import { z } from "zod";
import { eq, desc, lt, and, sql, gte } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import {
  creditBalances, creditTransactions, creditReservations,
  subscriptions, organizations, modelUsage,
} from "@prometheus/db";
import { StripeService } from "@prometheus/billing/stripe";
import { PRICING_TIERS } from "@prometheus/billing/products";

const stripe = new StripeService();

export const billingRouter = router({
  getBalance: protectedProcedure.query(async ({ ctx }) => {
    const balance = await ctx.db.query.creditBalances.findFirst({
      where: eq(creditBalances.orgId, ctx.orgId),
    });

    const org = await ctx.db.query.organizations.findFirst({
      where: eq(organizations.id, ctx.orgId),
      columns: { planTier: true },
    });

    return {
      balance: balance?.balance ?? 0,
      reserved: balance?.reserved ?? 0,
      available: (balance?.balance ?? 0) - (balance?.reserved ?? 0),
      planTier: org?.planTier ?? "hobby",
    };
  }),

  getPlan: protectedProcedure.query(async ({ ctx }) => {
    const org = await ctx.db.query.organizations.findFirst({
      where: eq(organizations.id, ctx.orgId),
      columns: { planTier: true },
    });

    const tier = org?.planTier ?? "hobby";
    const plan = PRICING_TIERS[tier];

    return {
      tier,
      name: plan?.name ?? "Hobby",
      creditsIncluded: plan?.creditsIncluded ?? 50,
      maxParallelAgents: plan?.maxParallelAgents ?? 1,
      maxTasksPerDay: plan?.maxTasksPerDay ?? 5,
      features: plan?.features ?? [],
    };
  }),

  createCheckout: protectedProcedure
    .input(z.object({
      planTier: z.enum(["starter", "pro", "team", "studio"]),
    }))
    .mutation(async ({ input, ctx }) => {
      const plan = PRICING_TIERS[input.planTier];
      if (!plan?.stripePriceId) {
        throw new Error("Plan not available for self-service checkout");
      }

      const org = await ctx.db.query.organizations.findFirst({
        where: eq(organizations.id, ctx.orgId),
        columns: { stripeCustomerId: true },
      });

      if (!org?.stripeCustomerId) {
        throw new Error("Stripe customer not configured");
      }

      const appUrl = process.env.APP_URL ?? "http://localhost:3000";
      const checkoutUrl = await stripe.createCheckoutSession({
        customerId: org.stripeCustomerId,
        priceId: plan.stripePriceId,
        successUrl: `${appUrl}/settings?checkout=success`,
        cancelUrl: `${appUrl}/settings?checkout=cancelled`,
        mode: "subscription",
        metadata: { orgId: ctx.orgId, planTier: input.planTier },
      });

      return { checkoutUrl };
    }),

  createPortalSession: protectedProcedure.mutation(async ({ ctx }) => {
    const org = await ctx.db.query.organizations.findFirst({
      where: eq(organizations.id, ctx.orgId),
      columns: { stripeCustomerId: true },
    });

    if (!org?.stripeCustomerId) {
      throw new Error("Stripe customer not configured");
    }

    const appUrl = process.env.APP_URL ?? "http://localhost:3000";
    const portalUrl = await stripe.createPortalSession(
      org.stripeCustomerId,
      `${appUrl}/settings`,
    );

    return { portalUrl };
  }),

  purchaseCredits: protectedProcedure
    .input(z.object({
      amount: z.enum(["100", "500", "1000", "5000"]),
    }))
    .mutation(async ({ input, ctx }) => {
      const org = await ctx.db.query.organizations.findFirst({
        where: eq(organizations.id, ctx.orgId),
        columns: { stripeCustomerId: true },
      });

      if (!org?.stripeCustomerId) {
        throw new Error("Stripe customer not configured");
      }

      const priceMap: Record<string, string> = {
        "100": process.env.STRIPE_PRICE_CREDITS_100 ?? "",
        "500": process.env.STRIPE_PRICE_CREDITS_500 ?? "",
        "1000": process.env.STRIPE_PRICE_CREDITS_1000 ?? "",
        "5000": process.env.STRIPE_PRICE_CREDITS_5000 ?? "",
      };

      const appUrl = process.env.APP_URL ?? "http://localhost:3000";
      const checkoutUrl = await stripe.createCheckoutSession({
        customerId: org.stripeCustomerId,
        priceId: priceMap[input.amount] ?? "",
        successUrl: `${appUrl}/settings?credits=success`,
        cancelUrl: `${appUrl}/settings?credits=cancelled`,
        mode: "payment",
        metadata: { orgId: ctx.orgId, credits: input.amount },
      });

      return { checkoutUrl };
    }),

  getTransactions: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(20),
      cursor: z.string().optional(),
    }))
    .query(async ({ input, ctx }) => {
      const conditions = [eq(creditTransactions.orgId, ctx.orgId)];

      if (input.cursor) {
        const cursorTx = await ctx.db.query.creditTransactions.findFirst({
          where: eq(creditTransactions.id, input.cursor),
          columns: { createdAt: true },
        });
        if (cursorTx) {
          conditions.push(lt(creditTransactions.createdAt, cursorTx.createdAt));
        }
      }

      const results = await ctx.db.query.creditTransactions.findMany({
        where: and(...conditions),
        orderBy: [desc(creditTransactions.createdAt)],
        limit: input.limit + 1,
      });

      const hasMore = results.length > input.limit;
      const items = hasMore ? results.slice(0, input.limit) : results;

      return {
        transactions: items,
        nextCursor: hasMore ? items[items.length - 1]!.id : null,
      };
    }),

  getUsage: protectedProcedure
    .input(z.object({
      periodStart: z.string().datetime().optional(),
      periodEnd: z.string().datetime().optional(),
    }))
    .query(async ({ input, ctx }) => {
      const start = input.periodStart
        ? new Date(input.periodStart)
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const end = input.periodEnd ? new Date(input.periodEnd) : new Date();

      const usage = await ctx.db
        .select({
          totalTokensIn: sql<number>`COALESCE(SUM(${modelUsage.tokensIn}), 0)`,
          totalTokensOut: sql<number>`COALESCE(SUM(${modelUsage.tokensOut}), 0)`,
          totalCostUsd: sql<number>`COALESCE(SUM(${modelUsage.costUsd}), 0)`,
          count: sql<number>`COUNT(*)`,
        })
        .from(modelUsage)
        .where(and(
          eq(modelUsage.orgId, ctx.orgId),
          gte(modelUsage.createdAt, start),
        ));

      const byModel = await ctx.db
        .select({
          model: modelUsage.model,
          tokens: sql<number>`SUM(${modelUsage.tokensIn} + ${modelUsage.tokensOut})`,
          cost: sql<number>`SUM(${modelUsage.costUsd})`,
          count: sql<number>`COUNT(*)`,
        })
        .from(modelUsage)
        .where(and(
          eq(modelUsage.orgId, ctx.orgId),
          gte(modelUsage.createdAt, start),
        ))
        .groupBy(modelUsage.model);

      const row = usage[0];
      const modelMap: Record<string, { tokens: number; cost: number; count: number }> = {};
      for (const m of byModel) {
        modelMap[m.model] = { tokens: Number(m.tokens), cost: Number(m.cost), count: Number(m.count) };
      }

      return {
        totalTokens: Number(row?.totalTokensIn ?? 0) + Number(row?.totalTokensOut ?? 0),
        totalCostUsd: Number(row?.totalCostUsd ?? 0),
        taskCount: Number(row?.count ?? 0),
        creditsUsed: 0,
        byModel: modelMap,
      };
    }),
});
