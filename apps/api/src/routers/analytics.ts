import { z } from "zod";
import { eq, and, gte, sql, desc } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import {
  tasks, sessions, projects, modelUsage,
  creditTransactions, usageRollups, agents,
} from "@prometheus/db";

export const analyticsRouter = router({
  overview: protectedProcedure
    .input(z.object({
      days: z.number().min(1).max(365).default(30),
    }))
    .query(async ({ input, ctx }) => {
      const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);

      const orgProjects = await ctx.db.query.projects.findMany({
        where: eq(projects.orgId, ctx.orgId),
        columns: { id: true },
      });
      const projectIds = orgProjects.map((p) => p.id);

      if (projectIds.length === 0) {
        return {
          tasksCompleted: 0,
          creditsUsed: 0,
          avgTaskDuration: 0,
          successRate: 0,
          activeProjects: 0,
          sessionsCreated: 0,
        };
      }

      const [taskStats] = await ctx.db
        .select({
          total: sql<number>`COUNT(*)`,
          completed: sql<number>`COUNT(*) FILTER (WHERE ${tasks.status} = 'completed')`,
          failed: sql<number>`COUNT(*) FILTER (WHERE ${tasks.status} = 'failed')`,
          totalCredits: sql<number>`COALESCE(SUM(${tasks.creditsConsumed}), 0)`,
          avgDuration: sql<number>`AVG(EXTRACT(EPOCH FROM (${tasks.completedAt} - ${tasks.startedAt})))`,
        })
        .from(tasks)
        .where(gte(tasks.createdAt, since));

      const [sessionStats] = await ctx.db
        .select({
          count: sql<number>`COUNT(*)`,
        })
        .from(sessions)
        .where(gte(sessions.startedAt, since));

      const total = Number(taskStats?.total ?? 0);
      const completed = Number(taskStats?.completed ?? 0);

      return {
        tasksCompleted: completed,
        creditsUsed: Number(taskStats?.totalCredits ?? 0),
        avgTaskDuration: Number(taskStats?.avgDuration ?? 0),
        successRate: total > 0 ? completed / total : 0,
        activeProjects: projectIds.length,
        sessionsCreated: Number(sessionStats?.count ?? 0),
      };
    }),

  taskMetrics: protectedProcedure
    .input(z.object({
      days: z.number().min(1).max(365).default(30),
      groupBy: z.enum(["day", "week", "month"]).default("day"),
    }))
    .query(async ({ input, ctx }) => {
      const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);

      const truncFn = input.groupBy === "day"
        ? sql`date_trunc('day', ${tasks.createdAt})`
        : input.groupBy === "week"
        ? sql`date_trunc('week', ${tasks.createdAt})`
        : sql`date_trunc('month', ${tasks.createdAt})`;

      const results = await ctx.db
        .select({
          date: truncFn.as("date"),
          completed: sql<number>`COUNT(*) FILTER (WHERE ${tasks.status} = 'completed')`,
          failed: sql<number>`COUNT(*) FILTER (WHERE ${tasks.status} = 'failed')`,
          credits: sql<number>`COALESCE(SUM(${tasks.creditsConsumed}), 0)`,
        })
        .from(tasks)
        .where(gte(tasks.createdAt, since))
        .groupBy(sql`date`)
        .orderBy(sql`date`);

      return {
        dataPoints: results.map((r) => ({
          date: String(r.date),
          completed: Number(r.completed),
          failed: Number(r.failed),
          credits: Number(r.credits),
        })),
      };
    }),

  agentPerformance: protectedProcedure.query(async ({ ctx }) => {
    const results = await ctx.db
      .select({
        role: agents.role,
        total: sql<number>`COUNT(*)`,
        avgTokensIn: sql<number>`AVG(${agents.tokensIn})`,
        avgTokensOut: sql<number>`AVG(${agents.tokensOut})`,
        avgSteps: sql<number>`AVG(${agents.stepsCompleted})`,
      })
      .from(agents)
      .groupBy(agents.role);

    const byRole: Record<string, {
      tasksCompleted: number;
      avgDuration: number;
      successRate: number;
      tokensUsed: number;
    }> = {};

    for (const r of results) {
      byRole[r.role] = {
        tasksCompleted: Number(r.total),
        avgDuration: 0,
        successRate: 0,
        tokensUsed: Number(r.avgTokensIn ?? 0) + Number(r.avgTokensOut ?? 0),
      };
    }

    return { byRole };
  }),

  modelUsage: protectedProcedure
    .input(z.object({
      days: z.number().min(1).max(365).default(30),
    }))
    .query(async ({ input, ctx }) => {
      const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);

      const results = await ctx.db
        .select({
          model: modelUsage.model,
          requests: sql<number>`COUNT(*)`,
          tokens: sql<number>`SUM(${modelUsage.tokensIn} + ${modelUsage.tokensOut})`,
          cost: sql<number>`SUM(${modelUsage.costUsd})`,
        })
        .from(modelUsage)
        .where(and(
          eq(modelUsage.orgId, ctx.orgId),
          gte(modelUsage.createdAt, since),
        ))
        .groupBy(modelUsage.model)
        .orderBy(desc(sql`SUM(${modelUsage.tokensIn} + ${modelUsage.tokensOut})`));

      return {
        byModel: results.map((r) => ({
          model: r.model,
          requests: Number(r.requests),
          tokens: Number(r.tokens),
          cost: Number(r.cost),
        })),
      };
    }),

  roi: protectedProcedure.query(async ({ ctx }) => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [stats] = await ctx.db
      .select({
        tasksCompleted: sql<number>`COUNT(*) FILTER (WHERE ${tasks.status} = 'completed')`,
        totalCredits: sql<number>`COALESCE(SUM(${tasks.creditsConsumed}), 0)`,
        totalDuration: sql<number>`COALESCE(SUM(EXTRACT(EPOCH FROM (${tasks.completedAt} - ${tasks.startedAt}))), 0)`,
      })
      .from(tasks)
      .where(gte(tasks.createdAt, thirtyDaysAgo));

    // Estimate: each completed task saves ~30 min of developer time
    const hoursSaved = (Number(stats?.tasksCompleted ?? 0) * 30) / 60;
    const hourlyRate = 75; // $75/hr average developer rate
    const estimatedValue = hoursSaved * hourlyRate;
    const creditsCost = Number(stats?.totalCredits ?? 0);

    return {
      estimatedHoursSaved: Math.round(hoursSaved * 10) / 10,
      estimatedValueUsd: Math.round(estimatedValue),
      creditsCost,
      roiMultiplier: creditsCost > 0 ? Math.round((estimatedValue / creditsCost) * 10) / 10 : 0,
    };
  }),
});
