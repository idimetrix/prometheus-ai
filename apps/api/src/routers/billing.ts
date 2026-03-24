import { CreditService } from "@prometheus/billing/credits";
import {
  CREDIT_PACKS,
  comparePlans,
  type PlanSlug,
  PRICING_TIERS,
} from "@prometheus/billing/products";
import { StripeService } from "@prometheus/billing/stripe";
import {
  creditBalances,
  creditTransactions,
  modelUsage,
  organizations,
  subscriptions,
} from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, lt, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

const logger = createLogger("api:billing");
const stripe = new StripeService();
const _creditService = new CreditService();

export const billingRouter = router({
  // ---------------------------------------------------------------------------
  // Credit balance
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // All available plans
  // ---------------------------------------------------------------------------
  getPlans: protectedProcedure.query(() => {
    return {
      plans: Object.entries(PRICING_TIERS).map(([slug, tier]) => ({
        slug,
        name: tier.name,
        price: tier.price,
        creditsIncluded: tier.creditsIncluded,
        maxParallelAgents: tier.maxParallelAgents,
        maxTasksPerDay: tier.maxTasksPerDay,
        features: tier.features,
        selfService: !!tier.stripePriceId,
      })),
    };
  }),

  // ---------------------------------------------------------------------------
  // Plan info
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // Subscription status (full detail)
  // ---------------------------------------------------------------------------
  getSubscription: protectedProcedure.query(async ({ ctx }) => {
    const org = await ctx.db.query.organizations.findFirst({
      where: eq(organizations.id, ctx.orgId),
      columns: { planTier: true, stripeCustomerId: true },
    });

    const sub = await ctx.db.query.subscriptions.findFirst({
      where: and(
        eq(subscriptions.orgId, ctx.orgId),
        eq(subscriptions.status, "active")
      ),
    });

    const tier = org?.planTier ?? "hobby";
    const plan = PRICING_TIERS[tier];

    return {
      tier,
      name: plan?.name ?? "Hobby",
      status: sub?.status ?? (tier === "hobby" ? "active" : "incomplete"),
      stripeSubscriptionId: sub?.stripeSubscriptionId ?? null,
      currentPeriodStart: sub?.currentPeriodStart?.toISOString() ?? null,
      currentPeriodEnd: sub?.currentPeriodEnd?.toISOString() ?? null,
      hasStripeCustomer: !!org?.stripeCustomerId,
      creditsIncluded: plan?.creditsIncluded ?? 50,
      maxParallelAgents: plan?.maxParallelAgents ?? 1,
      maxTasksPerDay: plan?.maxTasksPerDay ?? 5,
      features: plan?.features ?? [],
    };
  }),

  // ---------------------------------------------------------------------------
  // Checkout session (subscription)
  // ---------------------------------------------------------------------------
  createCheckout: protectedProcedure
    .input(
      z.object({
        planTier: z.enum(["starter", "pro", "team", "studio"]),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const plan = PRICING_TIERS[input.planTier];
      if (!plan?.stripePriceId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Plan not available for self-service checkout",
        });
      }

      const org = await ctx.db.query.organizations.findFirst({
        where: eq(organizations.id, ctx.orgId),
        columns: { stripeCustomerId: true },
      });

      if (!org?.stripeCustomerId) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Stripe customer not configured. Please contact support.",
        });
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

      logger.info(
        { orgId: ctx.orgId, planTier: input.planTier },
        "Checkout session created"
      );
      return { checkoutUrl };
    }),

  // ---------------------------------------------------------------------------
  // Manage subscription (upgrade / downgrade / cancel)
  // ---------------------------------------------------------------------------
  changePlan: protectedProcedure
    .input(
      z.object({
        newPlan: z.enum(["starter", "pro", "team", "studio"]),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const org = await ctx.db.query.organizations.findFirst({
        where: eq(organizations.id, ctx.orgId),
        columns: { planTier: true, stripeCustomerId: true },
      });

      if (!org) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found",
        });
      }

      const currentPlan = org.planTier as PlanSlug;
      if (currentPlan === input.newPlan) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Already on this plan",
        });
      }

      const sub = await ctx.db.query.subscriptions.findFirst({
        where: and(
          eq(subscriptions.orgId, ctx.orgId),
          eq(subscriptions.status, "active")
        ),
      });

      if (!sub?.stripeSubscriptionId) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "No active subscription found. Please start a checkout first.",
        });
      }

      const _result = await stripe.changePlan({
        orgId: ctx.orgId,
        currentPlan,
        newPlan: input.newPlan,
        stripeSubscriptionId: sub.stripeSubscriptionId,
      });

      const direction = comparePlans(currentPlan, input.newPlan);
      logger.info(
        {
          orgId: ctx.orgId,
          from: currentPlan,
          to: input.newPlan,
          direction: direction > 0 ? "upgrade" : "downgrade",
        },
        "Plan changed"
      );

      return {
        success: true,
        direction:
          direction > 0 ? ("upgrade" as const) : ("downgrade" as const),
        effectiveAt:
          direction > 0 ? ("immediately" as const) : ("end_of_period" as const),
      };
    }),

  cancelSubscription: protectedProcedure
    .input(
      z.object({
        immediate: z.boolean().default(false),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const sub = await ctx.db.query.subscriptions.findFirst({
        where: and(
          eq(subscriptions.orgId, ctx.orgId),
          eq(subscriptions.status, "active")
        ),
      });

      if (!sub?.stripeSubscriptionId) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No active subscription to cancel",
        });
      }

      await stripe.cancelSubscription(
        sub.stripeSubscriptionId,
        input.immediate
      );

      logger.info(
        { orgId: ctx.orgId, immediate: input.immediate },
        "Subscription cancelled"
      );

      return {
        success: true,
        effectiveAt: input.immediate
          ? ("immediately" as const)
          : ("end_of_period" as const),
      };
    }),

  reactivateSubscription: protectedProcedure.mutation(async ({ ctx }) => {
    const sub = await ctx.db.query.subscriptions.findFirst({
      where: and(
        eq(subscriptions.orgId, ctx.orgId),
        eq(subscriptions.status, "cancelled")
      ),
    });

    if (!sub?.stripeSubscriptionId) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "No cancelled subscription to reactivate",
      });
    }

    await stripe.reactivateSubscription(sub.stripeSubscriptionId);

    logger.info({ orgId: ctx.orgId }, "Subscription reactivated");
    return { success: true };
  }),

  // ---------------------------------------------------------------------------
  // Billing portal URL
  // ---------------------------------------------------------------------------
  createPortalSession: protectedProcedure.mutation(async ({ ctx }) => {
    const org = await ctx.db.query.organizations.findFirst({
      where: eq(organizations.id, ctx.orgId),
      columns: { stripeCustomerId: true },
    });

    if (!org?.stripeCustomerId) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Stripe customer not configured",
      });
    }

    const appUrl = process.env.APP_URL ?? "http://localhost:3000";
    const portalUrl = await stripe.createPortalSession(
      org.stripeCustomerId,
      `${appUrl}/settings`
    );

    return { portalUrl };
  }),

  // ---------------------------------------------------------------------------
  // Purchase credit pack
  // ---------------------------------------------------------------------------
  getCreditPacks: protectedProcedure.query(() => {
    return {
      packs: CREDIT_PACKS.map((p) => ({
        id: p.id,
        name: p.name,
        credits: p.credits,
        priceUsd: p.priceUsd,
        perCreditCents: p.perCreditCents,
      })),
    };
  }),

  purchaseCredits: protectedProcedure
    .input(
      z.object({
        creditPackId: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const pack = CREDIT_PACKS.find((p) => p.id === input.creditPackId);
      if (!pack) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Unknown credit pack",
        });
      }

      const org = await ctx.db.query.organizations.findFirst({
        where: eq(organizations.id, ctx.orgId),
        columns: { stripeCustomerId: true },
      });

      if (!org?.stripeCustomerId) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Stripe customer not configured",
        });
      }

      const appUrl = process.env.APP_URL ?? "http://localhost:3000";
      const checkoutUrl = await stripe.createCreditPackCheckout({
        customerId: org.stripeCustomerId,
        creditPackId: input.creditPackId,
        orgId: ctx.orgId,
        successUrl: `${appUrl}/settings?credits=success`,
        cancelUrl: `${appUrl}/settings?credits=cancelled`,
      });

      logger.info(
        { orgId: ctx.orgId, pack: input.creditPackId },
        "Credit pack checkout created"
      );
      return { checkoutUrl };
    }),

  // ---------------------------------------------------------------------------
  // Transaction history (paginated)
  // ---------------------------------------------------------------------------
  getTransactions: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(20),
        cursor: z.string().optional(),
        type: z
          .enum([
            "purchase",
            "consumption",
            "refund",
            "bonus",
            "subscription_grant",
          ])
          .optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const conditions = [eq(creditTransactions.orgId, ctx.orgId)];

      if (input.type) {
        conditions.push(eq(creditTransactions.type, input.type));
      }

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
        nextCursor: hasMore ? items.at(-1)?.id : null,
      };
    }),

  // ---------------------------------------------------------------------------
  // Usage history with model breakdown
  // ---------------------------------------------------------------------------
  getUsage: protectedProcedure
    .input(
      z.object({
        periodStart: z.string().datetime().optional(),
        periodEnd: z.string().datetime().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const start = input.periodStart
        ? new Date(input.periodStart)
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const _end = input.periodEnd ? new Date(input.periodEnd) : new Date();

      const usage = await ctx.db
        .select({
          totalTokensIn: sql<number>`COALESCE(SUM(${modelUsage.tokensIn}), 0)`,
          totalTokensOut: sql<number>`COALESCE(SUM(${modelUsage.tokensOut}), 0)`,
          totalCostUsd: sql<number>`COALESCE(SUM(${modelUsage.costUsd}), 0)`,
          count: sql<number>`COUNT(*)`,
        })
        .from(modelUsage)
        .where(
          and(eq(modelUsage.orgId, ctx.orgId), gte(modelUsage.createdAt, start))
        );

      const byModel = await ctx.db
        .select({
          model: modelUsage.model,
          provider: modelUsage.provider,
          tokens: sql<number>`SUM(${modelUsage.tokensIn} + ${modelUsage.tokensOut})`,
          cost: sql<number>`SUM(${modelUsage.costUsd})`,
          count: sql<number>`COUNT(*)`,
        })
        .from(modelUsage)
        .where(
          and(eq(modelUsage.orgId, ctx.orgId), gte(modelUsage.createdAt, start))
        )
        .groupBy(modelUsage.model, modelUsage.provider);

      // Credits consumed in same period
      const [creditData] = await ctx.db
        .select({
          consumed: sql<number>`COALESCE(SUM(ABS(${creditTransactions.amount})), 0)`,
        })
        .from(creditTransactions)
        .where(
          and(
            eq(creditTransactions.orgId, ctx.orgId),
            eq(creditTransactions.type, "consumption"),
            gte(creditTransactions.createdAt, start)
          )
        );

      const row = usage[0];
      const modelMap: Record<
        string,
        { provider: string; tokens: number; cost: number; count: number }
      > = {};
      for (const m of byModel) {
        modelMap[m.model] = {
          provider: m.provider,
          tokens: Number(m.tokens),
          cost: Number(m.cost),
          count: Number(m.count),
        };
      }

      return {
        totalTokens:
          Number(row?.totalTokensIn ?? 0) + Number(row?.totalTokensOut ?? 0),
        totalCostUsd: Number(row?.totalCostUsd ?? 0),
        taskCount: Number(row?.count ?? 0),
        creditsUsed: Number(creditData?.consumed ?? 0),
        byModel: modelMap,
      };
    }),

  // ---------------------------------------------------------------------------
  // Checkout session (with billing period and custom URLs)
  // ---------------------------------------------------------------------------
  createCheckoutSession: protectedProcedure
    .input(
      z.object({
        planTier: z.enum(["starter", "pro", "team", "studio"]),
        billingPeriod: z.enum(["monthly", "annual"]).default("monthly"),
        successUrl: z.string().url(),
        cancelUrl: z.string().url(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const plan = PRICING_TIERS[input.planTier];
      if (!plan?.stripePriceId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Plan not available for self-service checkout",
        });
      }

      const org = await ctx.db.query.organizations.findFirst({
        where: eq(organizations.id, ctx.orgId),
        columns: { stripeCustomerId: true },
      });

      if (!org?.stripeCustomerId) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Stripe customer not configured. Please contact support.",
        });
      }

      const checkoutUrl = await stripe.createCheckoutSession({
        customerId: org.stripeCustomerId,
        priceId: plan.stripePriceId,
        successUrl: input.successUrl,
        cancelUrl: input.cancelUrl,
        mode: "subscription",
        metadata: {
          orgId: ctx.orgId,
          planTier: input.planTier,
          billingPeriod: input.billingPeriod,
        },
      });

      logger.info(
        {
          orgId: ctx.orgId,
          planTier: input.planTier,
          billingPeriod: input.billingPeriod,
        },
        "Checkout session created"
      );
      return { url: checkoutUrl };
    }),

  // ---------------------------------------------------------------------------
  // Current plan (convenience endpoint)
  // ---------------------------------------------------------------------------
  getCurrentPlan: protectedProcedure.query(async ({ ctx }) => {
    const org = await ctx.db.query.organizations.findFirst({
      where: eq(organizations.id, ctx.orgId),
      columns: { planTier: true },
    });

    const tier = org?.planTier ?? "hobby";
    const plan = PRICING_TIERS[tier];

    const sub = await ctx.db.query.subscriptions.findFirst({
      where: and(
        eq(subscriptions.orgId, ctx.orgId),
        eq(subscriptions.status, "active")
      ),
    });

    const balance = await ctx.db.query.creditBalances.findFirst({
      where: eq(creditBalances.orgId, ctx.orgId),
    });

    // Credits consumed this period
    const periodStart =
      sub?.currentPeriodStart ?? new Date(Date.now() - 30 * 86_400_000);
    const [creditData] = await ctx.db
      .select({
        consumed: sql<number>`COALESCE(SUM(ABS(${creditTransactions.amount})), 0)`,
      })
      .from(creditTransactions)
      .where(
        and(
          eq(creditTransactions.orgId, ctx.orgId),
          eq(creditTransactions.type, "consumption"),
          gte(creditTransactions.createdAt, periodStart)
        )
      );

    const creditsUsed = Number(creditData?.consumed ?? 0);
    const _creditsTotal = plan?.creditsIncluded ?? 50;

    return {
      tier,
      status: sub?.status ?? (tier === "hobby" ? "active" : "incomplete"),
      currentPeriodEnd:
        sub?.currentPeriodEnd ?? new Date(Date.now() + 30 * 86_400_000),
      creditsRemaining: Math.max(
        0,
        (balance?.balance ?? 0) - (balance?.reserved ?? 0)
      ),
      creditsUsed,
    };
  }),

  // ---------------------------------------------------------------------------
  // Usage history (grouped by day/week/month)
  // ---------------------------------------------------------------------------
  getUsageHistory: protectedProcedure
    .input(
      z.object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        groupBy: z.enum(["day", "week", "month"]).default("day"),
      })
    )
    .query(async ({ input, ctx }) => {
      const start = input.startDate
        ? new Date(input.startDate)
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const end = input.endDate ? new Date(input.endDate) : new Date();

      let truncFn: SQL;
      if (input.groupBy === "day") {
        truncFn = sql`date_trunc('day', ${creditTransactions.createdAt})`;
      } else if (input.groupBy === "week") {
        truncFn = sql`date_trunc('week', ${creditTransactions.createdAt})`;
      } else {
        truncFn = sql`date_trunc('month', ${creditTransactions.createdAt})`;
      }

      const usage = await ctx.db
        .select({
          period: truncFn.as("period"),
          totalCredits: sql<number>`COALESCE(SUM(ABS(${creditTransactions.amount})), 0)`,
          count: sql<number>`COUNT(*)`,
        })
        .from(creditTransactions)
        .where(
          and(
            eq(creditTransactions.orgId, ctx.orgId),
            eq(creditTransactions.type, "consumption"),
            gte(creditTransactions.createdAt, start),
            lt(creditTransactions.createdAt, end)
          )
        )
        .groupBy(truncFn)
        .orderBy(truncFn);

      return {
        usage: usage.map((row) => ({
          period: String(row.period),
          credits: Number(row.totalCredits),
          transactions: Number(row.count),
        })),
        period: input.groupBy,
      };
    }),

  // ---------------------------------------------------------------------------
  // Invoices
  // ---------------------------------------------------------------------------
  getInvoices: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(50).default(10),
      })
    )
    .query(async ({ input, ctx }) => {
      const org = await ctx.db.query.organizations.findFirst({
        where: eq(organizations.id, ctx.orgId),
        columns: { stripeCustomerId: true },
      });

      if (!org?.stripeCustomerId) {
        return { invoices: [] };
      }

      const invoices = await stripe.listInvoices(
        org.stripeCustomerId,
        input.limit
      );
      return {
        invoices: invoices.map((inv) => ({
          id: inv.id,
          number: inv.number,
          status: inv.status,
          amountDue: inv.amount_due,
          amountPaid: inv.amount_paid,
          currency: inv.currency,
          createdAt: inv.created
            ? new Date(inv.created * 1000).toISOString()
            : null,
          paidAt: inv.status_transitions?.paid_at
            ? new Date(inv.status_transitions.paid_at * 1000).toISOString()
            : null,
          hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
          invoicePdf: inv.invoice_pdf ?? null,
        })),
      };
    }),
});
