import { modelUsageLogs } from "@prometheus/db";
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
});
