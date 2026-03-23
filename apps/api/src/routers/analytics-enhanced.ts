/**
 * Enhanced team analytics router.
 * Provides team velocity, cost-per-task, agent usage, ROI estimates,
 * and quality metrics computed from existing database tables.
 */

import { agents, modelUsage, projects, sessions, tasks } from "@prometheus/db";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

const dateRangeInput = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  days: z.number().min(1).max(365).default(30),
});

function resolveDateRange(input: {
  startDate?: string;
  endDate?: string;
  days: number;
}): { since: Date; until: Date } {
  const until = input.endDate ? new Date(input.endDate) : new Date();
  const since = input.startDate
    ? new Date(input.startDate)
    : new Date(until.getTime() - input.days * 24 * 60 * 60 * 1000);
  return { since, until };
}

export const analyticsEnhancedRouter = router({
  // ---------------------------------------------------------------------------
  // Team Velocity — tasks completed per week with trend
  // ---------------------------------------------------------------------------
  teamVelocity: protectedProcedure
    .input(dateRangeInput)
    .query(async ({ input, ctx }) => {
      const { since } = resolveDateRange(input);

      const weeklyData = await ctx.db
        .select({
          week: sql<string>`date_trunc('week', ${tasks.completedAt})`.as(
            "week"
          ),
          completed: sql<number>`COUNT(*) FILTER (WHERE ${tasks.status} = 'completed')`,
          failed: sql<number>`COUNT(*) FILTER (WHERE ${tasks.status} = 'failed')`,
          total: sql<number>`COUNT(*)`,
          avgDurationSeconds: sql<number>`AVG(EXTRACT(EPOCH FROM (${tasks.completedAt} - ${tasks.startedAt})))`,
        })
        .from(tasks)
        .where(
          and(
            eq(tasks.orgId, ctx.orgId),
            gte(tasks.createdAt, since),
            sql`${tasks.completedAt} IS NOT NULL`
          )
        )
        .groupBy(sql`week`)
        .orderBy(sql`week`);

      const weeks = weeklyData.map((w) => ({
        week: String(w.week),
        completed: Number(w.completed),
        failed: Number(w.failed),
        total: Number(w.total),
        avgDurationSeconds: Math.round(Number(w.avgDurationSeconds ?? 0)),
      }));

      // Calculate trend (comparing last 2 periods)
      let trend: "up" | "down" | "stable" = "stable";
      if (weeks.length >= 2) {
        const current = weeks.at(-1);
        const previous = weeks.at(-2);
        if (current && previous) {
          if (current.completed > previous.completed * 1.1) {
            trend = "up";
          } else if (current.completed < previous.completed * 0.9) {
            trend = "down";
          }
        }
      }

      const totalCompleted = weeks.reduce((s, w) => s + w.completed, 0);
      const avgPerWeek =
        weeks.length > 0 ? Math.round(totalCompleted / weeks.length) : 0;

      return { weeks, trend, totalCompleted, avgPerWeek };
    }),

  // ---------------------------------------------------------------------------
  // Cost Per Task — average LLM cost per task type (agent role)
  // ---------------------------------------------------------------------------
  costPerTask: protectedProcedure
    .input(dateRangeInput)
    .query(async ({ input, ctx }) => {
      const { since } = resolveDateRange(input);

      const results = await ctx.db
        .select({
          agentRole: tasks.agentRole,
          taskCount: sql<number>`COUNT(*)`,
          totalCredits: sql<number>`COALESCE(SUM(${tasks.creditsConsumed}), 0)`,
          avgCredits: sql<number>`AVG(${tasks.creditsConsumed})`,
          totalCostUsd: sql<number>`COALESCE(SUM(${modelUsage.costUsd}), 0)`,
          avgCostUsd: sql<number>`AVG(${modelUsage.costUsd})`,
        })
        .from(tasks)
        .leftJoin(modelUsage, eq(tasks.id, modelUsage.taskId))
        .where(and(eq(tasks.orgId, ctx.orgId), gte(tasks.createdAt, since)))
        .groupBy(tasks.agentRole)
        .orderBy(desc(sql`COALESCE(SUM(${tasks.creditsConsumed}), 0)`));

      const byRole = results.map((r) => ({
        agentRole: r.agentRole ?? "unknown",
        taskCount: Number(r.taskCount),
        totalCredits: Number(r.totalCredits),
        avgCreditsPerTask: Math.round(Number(r.avgCredits ?? 0) * 100) / 100,
        totalCostUsd: Math.round(Number(r.totalCostUsd) * 10_000) / 10_000,
        avgCostPerTask: Math.round(Number(r.avgCostUsd ?? 0) * 10_000) / 10_000,
      }));

      const totalCost = byRole.reduce((s, r) => s + r.totalCostUsd, 0);
      const totalTasks = byRole.reduce((s, r) => s + r.taskCount, 0);

      return {
        byRole,
        totalCostUsd: Math.round(totalCost * 100) / 100,
        overallAvgCost:
          totalTasks > 0
            ? Math.round((totalCost / totalTasks) * 10_000) / 10_000
            : 0,
      };
    }),

  // ---------------------------------------------------------------------------
  // Agent Usage — which agents are used most, breakdown by user
  // ---------------------------------------------------------------------------
  agentUsage: protectedProcedure
    .input(dateRangeInput)
    .query(async ({ input, ctx }) => {
      const { since } = resolveDateRange(input);

      // Overall agent usage by role (join agents -> sessions -> projects for orgId)
      const byRole = await ctx.db
        .select({
          role: agents.role,
          invocations: sql<number>`COUNT(*)`,
          totalTokens: sql<number>`COALESCE(SUM(${agents.tokensIn} + ${agents.tokensOut}), 0)`,
          avgSteps: sql<number>`AVG(${agents.stepsCompleted})`,
          successCount: sql<number>`COUNT(*) FILTER (WHERE ${agents.status} = 'done')`,
          errorCount: sql<number>`COUNT(*) FILTER (WHERE ${agents.status} = 'error')`,
        })
        .from(agents)
        .innerJoin(sessions, eq(agents.sessionId, sessions.id))
        .innerJoin(projects, eq(sessions.projectId, projects.id))
        .where(and(eq(projects.orgId, ctx.orgId), gte(agents.startedAt, since)))
        .groupBy(agents.role)
        .orderBy(desc(sql`COUNT(*)`));

      // Per-user agent usage (top 20 users)
      const byUser = await ctx.db
        .select({
          userId: sessions.userId,
          invocations: sql<number>`COUNT(*)`,
          uniqueRoles: sql<number>`COUNT(DISTINCT ${agents.role})`,
          totalTokens: sql<number>`COALESCE(SUM(${agents.tokensIn} + ${agents.tokensOut}), 0)`,
        })
        .from(agents)
        .innerJoin(sessions, eq(agents.sessionId, sessions.id))
        .innerJoin(projects, eq(sessions.projectId, projects.id))
        .where(and(eq(projects.orgId, ctx.orgId), gte(agents.startedAt, since)))
        .groupBy(sessions.userId)
        .orderBy(desc(sql`COUNT(*)`))
        .limit(20);

      return {
        byRole: byRole.map((r) => ({
          role: r.role,
          invocations: Number(r.invocations),
          totalTokens: Number(r.totalTokens),
          avgSteps: Math.round(Number(r.avgSteps ?? 0) * 10) / 10,
          successRate:
            Number(r.invocations) > 0
              ? Math.round(
                  (Number(r.successCount) / Number(r.invocations)) * 1000
                ) / 10
              : 0,
          errorCount: Number(r.errorCount),
        })),
        byUser: byUser.map((u) => ({
          userId: u.userId,
          invocations: Number(u.invocations),
          uniqueRoles: Number(u.uniqueRoles),
          totalTokens: Number(u.totalTokens),
        })),
      };
    }),

  // ---------------------------------------------------------------------------
  // ROI Estimate — estimated time saved based on credit usage
  // ---------------------------------------------------------------------------
  roiEstimate: protectedProcedure
    .input(dateRangeInput)
    .query(async ({ input, ctx }) => {
      const { since } = resolveDateRange(input);

      const [stats] = await ctx.db
        .select({
          tasksCompleted: sql<number>`COUNT(*) FILTER (WHERE ${tasks.status} = 'completed')`,
          totalCredits: sql<number>`COALESCE(SUM(${tasks.creditsConsumed}), 0)`,
          totalDurationSec: sql<number>`COALESCE(SUM(EXTRACT(EPOCH FROM (${tasks.completedAt} - ${tasks.startedAt}))), 0)`,
        })
        .from(tasks)
        .where(and(eq(tasks.orgId, ctx.orgId), gte(tasks.createdAt, since)));

      const [costData] = await ctx.db
        .select({
          totalCostUsd: sql<number>`COALESCE(SUM(${modelUsage.costUsd}), 0)`,
        })
        .from(modelUsage)
        .where(
          and(eq(modelUsage.orgId, ctx.orgId), gte(modelUsage.createdAt, since))
        );

      const tasksCompleted = Number(stats?.tasksCompleted ?? 0);
      const totalCredits = Number(stats?.totalCredits ?? 0);
      const totalCostUsd = Number(costData?.totalCostUsd ?? 0);

      // Estimate: each completed task saves ~30 min of developer time
      // Average developer rate: $75/hr
      const minutesSavedPerTask = 30;
      const hourlyRate = 75;
      const hoursSaved = (tasksCompleted * minutesSavedPerTask) / 60;
      const estimatedValueUsd = hoursSaved * hourlyRate;

      // Cost is either actual LLM cost or credit-based approximation
      const effectiveCost =
        totalCostUsd > 0 ? totalCostUsd : totalCredits * 0.01;

      return {
        tasksCompleted,
        hoursSaved: Math.round(hoursSaved * 10) / 10,
        estimatedValueUsd: Math.round(estimatedValueUsd),
        totalCreditsUsed: totalCredits,
        totalCostUsd: Math.round(totalCostUsd * 100) / 100,
        roiMultiplier:
          effectiveCost > 0
            ? Math.round((estimatedValueUsd / effectiveCost) * 10) / 10
            : 0,
        costPerTaskUsd:
          tasksCompleted > 0
            ? Math.round((effectiveCost / tasksCompleted) * 10_000) / 10_000
            : 0,
      };
    }),

  // ---------------------------------------------------------------------------
  // Quality Metrics — acceptance rate, revision rate, success by role
  // ---------------------------------------------------------------------------
  qualityMetrics: protectedProcedure
    .input(dateRangeInput)
    .query(async ({ input, ctx }) => {
      const { since } = resolveDateRange(input);

      // Overall quality breakdown
      const [overall] = await ctx.db
        .select({
          total: sql<number>`COUNT(*)`,
          completed: sql<number>`COUNT(*) FILTER (WHERE ${tasks.status} = 'completed')`,
          failed: sql<number>`COUNT(*) FILTER (WHERE ${tasks.status} = 'failed')`,
          cancelled: sql<number>`COUNT(*) FILTER (WHERE ${tasks.status} = 'cancelled')`,
          avgCredits: sql<number>`AVG(${tasks.creditsConsumed})`,
        })
        .from(tasks)
        .where(and(eq(tasks.orgId, ctx.orgId), gte(tasks.createdAt, since)));

      const total = Number(overall?.total ?? 0);
      const completed = Number(overall?.completed ?? 0);
      const failed = Number(overall?.failed ?? 0);
      const cancelled = Number(overall?.cancelled ?? 0);

      // Quality by agent role
      const byRole = await ctx.db
        .select({
          agentRole: tasks.agentRole,
          total: sql<number>`COUNT(*)`,
          completed: sql<number>`COUNT(*) FILTER (WHERE ${tasks.status} = 'completed')`,
          failed: sql<number>`COUNT(*) FILTER (WHERE ${tasks.status} = 'failed')`,
          avgDuration: sql<number>`AVG(EXTRACT(EPOCH FROM (${tasks.completedAt} - ${tasks.startedAt})))`,
        })
        .from(tasks)
        .where(and(eq(tasks.orgId, ctx.orgId), gte(tasks.createdAt, since)))
        .groupBy(tasks.agentRole)
        .orderBy(desc(sql`COUNT(*)`));

      return {
        overall: {
          total,
          completed,
          failed,
          cancelled,
          acceptanceRate:
            total > 0 ? Math.round((completed / total) * 1000) / 10 : 0,
          failureRate: total > 0 ? Math.round((failed / total) * 1000) / 10 : 0,
          cancellationRate:
            total > 0 ? Math.round((cancelled / total) * 1000) / 10 : 0,
          avgCreditsPerTask:
            Math.round(Number(overall?.avgCredits ?? 0) * 100) / 100,
        },
        byRole: byRole.map((r) => {
          const roleTotal = Number(r.total);
          const roleCompleted = Number(r.completed);
          return {
            agentRole: r.agentRole ?? "unknown",
            total: roleTotal,
            completed: roleCompleted,
            failed: Number(r.failed),
            successRate:
              roleTotal > 0
                ? Math.round((roleCompleted / roleTotal) * 1000) / 10
                : 0,
            avgDurationSeconds: Math.round(Number(r.avgDuration ?? 0)),
          };
        }),
      };
    }),
});
