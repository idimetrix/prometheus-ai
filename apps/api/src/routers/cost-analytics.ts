import { creditBalances, modelUsage, modelUsageLogs } from "@prometheus/db";
import { and, desc, eq, gte, lte, sql, sum } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

const dateRangeInput = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
});

export const costAnalyticsRouter = router({
  getBreakdown: protectedProcedure
    .input(dateRangeInput)
    .query(async ({ input, ctx }) => {
      const rows = await ctx.db
        .select({
          modelKey: modelUsageLogs.modelKey,
          provider: modelUsageLogs.provider,
          totalCost: sum(modelUsageLogs.costUsd).mapWith(Number),
          totalPromptTokens: sum(modelUsageLogs.promptTokens).mapWith(Number),
          totalCompletionTokens: sum(modelUsageLogs.completionTokens).mapWith(
            Number
          ),
          requestCount: sql<number>`count(*)`.mapWith(Number),
        })
        .from(modelUsageLogs)
        .where(
          and(
            eq(modelUsageLogs.orgId, ctx.orgId),
            gte(modelUsageLogs.createdAt, new Date(input.from)),
            lte(modelUsageLogs.createdAt, new Date(input.to))
          )
        )
        .groupBy(modelUsageLogs.modelKey, modelUsageLogs.provider)
        .orderBy(desc(sum(modelUsageLogs.costUsd)));

      return { breakdown: rows };
    }),

  getDaily: protectedProcedure
    .input(dateRangeInput)
    .query(async ({ input, ctx }) => {
      const rows = await ctx.db
        .select({
          date: sql<string>`date_trunc('day', ${modelUsageLogs.createdAt})::date`.as(
            "date"
          ),
          totalCost: sum(modelUsageLogs.costUsd).mapWith(Number),
          requestCount: sql<number>`count(*)`.mapWith(Number),
        })
        .from(modelUsageLogs)
        .where(
          and(
            eq(modelUsageLogs.orgId, ctx.orgId),
            gte(modelUsageLogs.createdAt, new Date(input.from)),
            lte(modelUsageLogs.createdAt, new Date(input.to))
          )
        )
        .groupBy(sql`date_trunc('day', ${modelUsageLogs.createdAt})::date`)
        .orderBy(sql`date_trunc('day', ${modelUsageLogs.createdAt})::date`);

      return { daily: rows };
    }),

  getSavings: protectedProcedure
    .input(dateRangeInput)
    .query(async ({ input, ctx }) => {
      const rows = await ctx.db
        .select({
          slot: modelUsageLogs.slot,
          modelKey: modelUsageLogs.modelKey,
          totalCost: sum(modelUsageLogs.costUsd).mapWith(Number),
          totalTokens: sum(modelUsageLogs.totalTokens).mapWith(Number),
        })
        .from(modelUsageLogs)
        .where(
          and(
            eq(modelUsageLogs.orgId, ctx.orgId),
            gte(modelUsageLogs.createdAt, new Date(input.from)),
            lte(modelUsageLogs.createdAt, new Date(input.to))
          )
        )
        .groupBy(modelUsageLogs.slot, modelUsageLogs.modelKey);

      const actualCost = rows.reduce((acc, r) => acc + (r.totalCost ?? 0), 0);

      // Estimate premium cost: assume all tokens were processed by the most
      // expensive model slot ("primary") at a fixed premium rate.
      const totalTokens = rows.reduce(
        (acc, r) => acc + (r.totalTokens ?? 0),
        0
      );
      const premiumRatePerToken = 0.000_03; // estimated premium model $/token
      const premiumCost = totalTokens * premiumRatePerToken;

      return {
        actualCost,
        premiumCost,
        savings: premiumCost - actualCost,
        savingsPercent:
          premiumCost > 0
            ? ((premiumCost - actualCost) / premiumCost) * 100
            : 0,
        bySlot: rows,
      };
    }),

  getTopUsers: protectedProcedure
    .input(
      dateRangeInput.extend({
        limit: z.number().min(1).max(100).default(10),
      })
    )
    .query(async ({ input, ctx }) => {
      const rows = await ctx.db
        .select({
          sessionId: modelUsageLogs.sessionId,
          totalCost: sum(modelUsageLogs.costUsd).mapWith(Number),
          requestCount: sql<number>`count(*)`.mapWith(Number),
          totalTokens: sum(modelUsageLogs.totalTokens).mapWith(Number),
        })
        .from(modelUsageLogs)
        .where(
          and(
            eq(modelUsageLogs.orgId, ctx.orgId),
            gte(modelUsageLogs.createdAt, new Date(input.from)),
            lte(modelUsageLogs.createdAt, new Date(input.to))
          )
        )
        .groupBy(modelUsageLogs.sessionId)
        .orderBy(desc(sum(modelUsageLogs.costUsd)))
        .limit(input.limit);

      return { topUsers: rows };
    }),

  // -------------------------------------------------------------------------
  // Real cost breakdown by provider (CT04) — from model_usage table
  // -------------------------------------------------------------------------
  costByProvider: protectedProcedure
    .input(dateRangeInput)
    .query(async ({ input, ctx }) => {
      const rows = await ctx.db
        .select({
          provider: modelUsage.provider,
          totalCost:
            sql<number>`COALESCE(SUM(${modelUsage.costUsd}), 0)`.mapWith(
              Number
            ),
          requestCount: sql<number>`COUNT(*)`.mapWith(Number),
          totalTokensIn:
            sql<number>`COALESCE(SUM(${modelUsage.tokensIn}), 0)`.mapWith(
              Number
            ),
          totalTokensOut:
            sql<number>`COALESCE(SUM(${modelUsage.tokensOut}), 0)`.mapWith(
              Number
            ),
        })
        .from(modelUsage)
        .where(
          and(
            eq(modelUsage.orgId, ctx.orgId),
            gte(modelUsage.createdAt, new Date(input.from)),
            lte(modelUsage.createdAt, new Date(input.to))
          )
        )
        .groupBy(modelUsage.provider)
        .orderBy(desc(sql`SUM(${modelUsage.costUsd})`));

      const totalCost = rows.reduce((s, r) => s + (r.totalCost ?? 0), 0);

      return {
        byProvider: rows.map((r) => ({
          ...r,
          costPercent:
            totalCost > 0
              ? Math.round(((r.totalCost ?? 0) / totalCost) * 1000) / 10
              : 0,
        })),
        totalCostUsd: Math.round(totalCost * 100) / 100,
      };
    }),

  // -------------------------------------------------------------------------
  // Cost trend over time (CT04) — daily cost from model_usage
  // -------------------------------------------------------------------------
  costTrend: protectedProcedure
    .input(
      dateRangeInput.extend({
        groupBy: z.enum(["day", "week", "month"]).default("day"),
      })
    )
    .query(async ({ input, ctx }) => {
      const truncMap = {
        day: sql`date_trunc('day', ${modelUsage.createdAt})`,
        week: sql`date_trunc('week', ${modelUsage.createdAt})`,
        month: sql`date_trunc('month', ${modelUsage.createdAt})`,
      };
      const dateTrunc = truncMap[input.groupBy];

      const rows = await ctx.db
        .select({
          date: dateTrunc.as("date"),
          totalCost:
            sql<number>`COALESCE(SUM(${modelUsage.costUsd}), 0)`.mapWith(
              Number
            ),
          requestCount: sql<number>`COUNT(*)`.mapWith(Number),
          totalTokens:
            sql<number>`COALESCE(SUM(${modelUsage.tokensIn} + ${modelUsage.tokensOut}), 0)`.mapWith(
              Number
            ),
        })
        .from(modelUsage)
        .where(
          and(
            eq(modelUsage.orgId, ctx.orgId),
            gte(modelUsage.createdAt, new Date(input.from)),
            lte(modelUsage.createdAt, new Date(input.to))
          )
        )
        .groupBy(sql`date`)
        .orderBy(sql`date`);

      return {
        dataPoints: rows.map((r) => ({
          date: String(r.date),
          totalCost: r.totalCost ?? 0,
          requestCount: r.requestCount ?? 0,
          totalTokens: r.totalTokens ?? 0,
        })),
      };
    }),

  // -------------------------------------------------------------------------
  // Budget utilization (CT04) — current credit balance vs spend
  // -------------------------------------------------------------------------
  budgetUtilization: protectedProcedure
    .input(dateRangeInput)
    .query(async ({ input, ctx }) => {
      // Get current credit balance
      const [balance] = await ctx.db
        .select({
          balance: creditBalances.balance,
          reserved: creditBalances.reserved,
        })
        .from(creditBalances)
        .where(eq(creditBalances.orgId, ctx.orgId));

      // Get total spend in the period
      const [spend] = await ctx.db
        .select({
          totalCost:
            sql<number>`COALESCE(SUM(${modelUsage.costUsd}), 0)`.mapWith(
              Number
            ),
          totalRequests: sql<number>`COUNT(*)`.mapWith(Number),
        })
        .from(modelUsage)
        .where(
          and(
            eq(modelUsage.orgId, ctx.orgId),
            gte(modelUsage.createdAt, new Date(input.from)),
            lte(modelUsage.createdAt, new Date(input.to))
          )
        );

      const currentBalance = Number(balance?.balance ?? 0);
      const reserved = Number(balance?.reserved ?? 0);
      const available = currentBalance - reserved;
      const totalSpend = spend?.totalCost ?? 0;

      // Estimate days remaining based on daily burn rate
      const fromDate = new Date(input.from);
      const toDate = new Date(input.to);
      const periodDays = Math.max(
        1,
        (toDate.getTime() - fromDate.getTime()) / (24 * 60 * 60 * 1000)
      );
      const dailyBurnRate = totalSpend / periodDays;
      const estimatedDaysRemaining =
        dailyBurnRate > 0 ? Math.round(available / dailyBurnRate) : null;

      return {
        currentBalance,
        reserved,
        available,
        totalSpendInPeriod: Math.round(totalSpend * 100) / 100,
        dailyBurnRate: Math.round(dailyBurnRate * 100) / 100,
        estimatedDaysRemaining,
        totalRequests: spend?.totalRequests ?? 0,
      };
    }),
});
