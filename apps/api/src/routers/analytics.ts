import {
  agents,
  creditTransactions,
  modelUsage,
  modelUsageLogs,
  projects,
  sessions,
  tasks,
} from "@prometheus/db";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

export const analyticsRouter = router({
  // ---------------------------------------------------------------------------
  // Overview dashboard
  // ---------------------------------------------------------------------------
  overview: protectedProcedure
    .input(
      z.object({
        days: z.number().min(1).max(365).default(30),
        projectId: z.string().optional(),
      })
    )
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

      const taskFilter = input.projectId
        ? and(
            eq(tasks.orgId, ctx.orgId),
            eq(tasks.projectId, input.projectId),
            gte(tasks.createdAt, since)
          )
        : and(eq(tasks.orgId, ctx.orgId), gte(tasks.createdAt, since));

      const [taskStats] = await ctx.db
        .select({
          total: sql<number>`COUNT(*)`,
          completed: sql<number>`COUNT(*) FILTER (WHERE ${tasks.status} = 'completed')`,
          failed: sql<number>`COUNT(*) FILTER (WHERE ${tasks.status} = 'failed')`,
          totalCredits: sql<number>`COALESCE(SUM(${tasks.creditsConsumed}), 0)`,
          avgDuration: sql<number>`AVG(EXTRACT(EPOCH FROM (${tasks.completedAt} - ${tasks.startedAt})))`,
        })
        .from(tasks)
        .where(taskFilter);

      const sessionFilter = input.projectId
        ? and(
            inArray(
              sessions.projectId,
              input.projectId ? [input.projectId] : projectIds
            ),
            gte(sessions.startedAt, since)
          )
        : gte(sessions.startedAt, since);

      const [sessionStats] = await ctx.db
        .select({
          count: sql<number>`COUNT(*)`,
        })
        .from(sessions)
        .where(sessionFilter);

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

  // ---------------------------------------------------------------------------
  // Tasks completed (daily/weekly/monthly aggregation)
  // ---------------------------------------------------------------------------
  taskMetrics: protectedProcedure
    .input(
      z.object({
        days: z.number().min(1).max(365).default(30),
        groupBy: z.enum(["day", "week", "month"]).default("day"),
        projectId: z.string().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);

      const truncMap = {
        day: sql`date_trunc('day', ${tasks.createdAt})`,
        week: sql`date_trunc('week', ${tasks.createdAt})`,
        month: sql`date_trunc('month', ${tasks.createdAt})`,
      };
      const truncFn = truncMap[input.groupBy];

      const conditions = [
        eq(tasks.orgId, ctx.orgId),
        gte(tasks.createdAt, since),
      ];
      if (input.projectId) {
        conditions.push(eq(tasks.projectId, input.projectId));
      }

      const results = await ctx.db
        .select({
          date: truncFn.as("date"),
          completed: sql<number>`COUNT(*) FILTER (WHERE ${tasks.status} = 'completed')`,
          failed: sql<number>`COUNT(*) FILTER (WHERE ${tasks.status} = 'failed')`,
          cancelled: sql<number>`COUNT(*) FILTER (WHERE ${tasks.status} = 'cancelled')`,
          total: sql<number>`COUNT(*)`,
          credits: sql<number>`COALESCE(SUM(${tasks.creditsConsumed}), 0)`,
          avgDuration: sql<number>`AVG(EXTRACT(EPOCH FROM (${tasks.completedAt} - ${tasks.startedAt})))`,
        })
        .from(tasks)
        .where(and(...conditions))
        .groupBy(sql`date`)
        .orderBy(sql`date`);

      return {
        dataPoints: results.map((r) => ({
          date: String(r.date),
          completed: Number(r.completed),
          failed: Number(r.failed),
          cancelled: Number(r.cancelled),
          total: Number(r.total),
          credits: Number(r.credits),
          avgDuration: Number(r.avgDuration ?? 0),
        })),
      };
    }),

  // ---------------------------------------------------------------------------
  // Credits consumed over time
  // ---------------------------------------------------------------------------
  creditConsumption: protectedProcedure
    .input(
      z.object({
        days: z.number().min(1).max(365).default(30),
        groupBy: z.enum(["day", "week", "month"]).default("day"),
      })
    )
    .query(async ({ input, ctx }) => {
      const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);

      const truncMap = {
        day: sql`date_trunc('day', ${creditTransactions.createdAt})`,
        week: sql`date_trunc('week', ${creditTransactions.createdAt})`,
        month: sql`date_trunc('month', ${creditTransactions.createdAt})`,
      };
      const truncFn = truncMap[input.groupBy];

      const results = await ctx.db
        .select({
          date: truncFn.as("date"),
          consumed: sql<number>`COALESCE(SUM(ABS(${creditTransactions.amount})) FILTER (WHERE ${creditTransactions.type} = 'consumption'), 0)`,
          purchased: sql<number>`COALESCE(SUM(${creditTransactions.amount}) FILTER (WHERE ${creditTransactions.type} = 'purchase'), 0)`,
          granted: sql<number>`COALESCE(SUM(${creditTransactions.amount}) FILTER (WHERE ${creditTransactions.type} = 'subscription_grant'), 0)`,
          refunded: sql<number>`COALESCE(SUM(${creditTransactions.amount}) FILTER (WHERE ${creditTransactions.type} = 'refund'), 0)`,
        })
        .from(creditTransactions)
        .where(
          and(
            eq(creditTransactions.orgId, ctx.orgId),
            gte(creditTransactions.createdAt, since)
          )
        )
        .groupBy(sql`date`)
        .orderBy(sql`date`);

      return {
        dataPoints: results.map((r) => ({
          date: String(r.date),
          consumed: Number(r.consumed),
          purchased: Number(r.purchased),
          granted: Number(r.granted),
          refunded: Number(r.refunded),
        })),
      };
    }),

  // ---------------------------------------------------------------------------
  // Cost breakdown by model/provider
  // ---------------------------------------------------------------------------
  costBreakdown: protectedProcedure
    .input(
      z.object({
        days: z.number().min(1).max(365).default(30),
        projectId: z.string().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);

      const conditions = [
        eq(modelUsage.orgId, ctx.orgId),
        gte(modelUsage.createdAt, since),
      ];
      if (input.projectId) {
        // Filter by tasks in the project
        conditions.push(
          sql`${modelUsage.taskId} IN (SELECT id FROM tasks WHERE project_id = ${input.projectId})`
        );
      }

      const byModel = await ctx.db
        .select({
          model: modelUsage.model,
          provider: modelUsage.provider,
          requests: sql<number>`COUNT(*)`,
          tokensIn: sql<number>`COALESCE(SUM(${modelUsage.tokensIn}), 0)`,
          tokensOut: sql<number>`COALESCE(SUM(${modelUsage.tokensOut}), 0)`,
          cost: sql<number>`COALESCE(SUM(${modelUsage.costUsd}), 0)`,
        })
        .from(modelUsage)
        .where(and(...conditions))
        .groupBy(modelUsage.model, modelUsage.provider)
        .orderBy(desc(sql`SUM(${modelUsage.costUsd})`));

      const byProvider = await ctx.db
        .select({
          provider: modelUsage.provider,
          requests: sql<number>`COUNT(*)`,
          tokens: sql<number>`COALESCE(SUM(${modelUsage.tokensIn} + ${modelUsage.tokensOut}), 0)`,
          cost: sql<number>`COALESCE(SUM(${modelUsage.costUsd}), 0)`,
        })
        .from(modelUsage)
        .where(and(...conditions))
        .groupBy(modelUsage.provider)
        .orderBy(desc(sql`SUM(${modelUsage.costUsd})`));

      const totalCost = byProvider.reduce((sum, p) => sum + Number(p.cost), 0);

      return {
        totalCostUsd: Math.round(totalCost * 100) / 100,
        byModel: byModel.map((r) => ({
          model: r.model,
          provider: r.provider,
          requests: Number(r.requests),
          tokensIn: Number(r.tokensIn),
          tokensOut: Number(r.tokensOut),
          cost: Number(r.cost),
          costPercent:
            totalCost > 0
              ? Math.round((Number(r.cost) / totalCost) * 1000) / 10
              : 0,
        })),
        byProvider: byProvider.map((r) => ({
          provider: r.provider,
          requests: Number(r.requests),
          tokens: Number(r.tokens),
          cost: Number(r.cost),
          costPercent:
            totalCost > 0
              ? Math.round((Number(r.cost) / totalCost) * 1000) / 10
              : 0,
        })),
      };
    }),

  // ---------------------------------------------------------------------------
  // Agent performance metrics
  // ---------------------------------------------------------------------------
  agentPerformance: protectedProcedure
    .input(
      z
        .object({
          days: z.number().min(1).max(365).default(30),
        })
        .default({ days: 30 })
    )
    .query(async ({ input, ctx }) => {
      const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);

      const results = await ctx.db
        .select({
          role: agents.role,
          total: sql<number>`COUNT(*)`,
          working: sql<number>`COUNT(*) FILTER (WHERE ${agents.status} = 'working')`,
          errored: sql<number>`COUNT(*) FILTER (WHERE ${agents.status} = 'error')`,
          avgTokensIn: sql<number>`AVG(${agents.tokensIn})`,
          avgTokensOut: sql<number>`AVG(${agents.tokensOut})`,
          totalTokensIn: sql<number>`COALESCE(SUM(${agents.tokensIn}), 0)`,
          totalTokensOut: sql<number>`COALESCE(SUM(${agents.tokensOut}), 0)`,
          avgSteps: sql<number>`AVG(${agents.stepsCompleted})`,
          avgDuration: sql<number>`AVG(EXTRACT(EPOCH FROM (${agents.terminatedAt} - ${agents.startedAt})))`,
        })
        .from(agents)
        .where(gte(agents.startedAt, since))
        .groupBy(agents.role);

      const byRole: Record<
        string,
        {
          totalInvocations: number;
          activeCount: number;
          errorCount: number;
          successRate: number;
          avgDurationSeconds: number;
          avgSteps: number;
          avgTokensIn: number;
          avgTokensOut: number;
          totalTokens: number;
        }
      > = {};

      for (const r of results) {
        const total = Number(r.total);
        const errored = Number(r.errored);
        byRole[r.role] = {
          totalInvocations: total,
          activeCount: Number(r.working),
          errorCount: errored,
          successRate: total > 0 ? (total - errored) / total : 0,
          avgDurationSeconds: Number(r.avgDuration ?? 0),
          avgSteps: Number(r.avgSteps ?? 0),
          avgTokensIn: Number(r.avgTokensIn ?? 0),
          avgTokensOut: Number(r.avgTokensOut ?? 0),
          totalTokens:
            Number(r.totalTokensIn ?? 0) + Number(r.totalTokensOut ?? 0),
        };
      }

      return { byRole };
    }),

  // ---------------------------------------------------------------------------
  // Session duration stats
  // ---------------------------------------------------------------------------
  sessionStats: protectedProcedure
    .input(
      z.object({
        days: z.number().min(1).max(365).default(30),
        projectId: z.string().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);

      const orgProjects = await ctx.db.query.projects.findMany({
        where: eq(projects.orgId, ctx.orgId),
        columns: { id: true },
      });
      const projectIds = orgProjects.map((p) => p.id);

      if (projectIds.length === 0) {
        return {
          totalSessions: 0,
          avgDurationSeconds: 0,
          medianDurationSeconds: 0,
          byStatus: {},
          byMode: {},
        };
      }

      const conditions = [gte(sessions.startedAt, since)];
      if (input.projectId) {
        conditions.push(eq(sessions.projectId, input.projectId));
      } else {
        conditions.push(inArray(sessions.projectId, projectIds));
      }

      const [overall] = await ctx.db
        .select({
          total: sql<number>`COUNT(*)`,
          avgDuration: sql<number>`AVG(EXTRACT(EPOCH FROM (${sessions.endedAt} - ${sessions.startedAt})))`,
          medianDuration: sql<number>`PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (${sessions.endedAt} - ${sessions.startedAt})))`,
        })
        .from(sessions)
        .where(and(...conditions));

      const byStatus = await ctx.db
        .select({
          status: sessions.status,
          count: sql<number>`COUNT(*)`,
        })
        .from(sessions)
        .where(and(...conditions))
        .groupBy(sessions.status);

      const byMode = await ctx.db
        .select({
          mode: sessions.mode,
          count: sql<number>`COUNT(*)`,
          avgDuration: sql<number>`AVG(EXTRACT(EPOCH FROM (${sessions.endedAt} - ${sessions.startedAt})))`,
        })
        .from(sessions)
        .where(and(...conditions))
        .groupBy(sessions.mode);

      const statusMap: Record<string, number> = {};
      for (const s of byStatus) {
        statusMap[s.status] = Number(s.count);
      }

      const modeMap: Record<string, { count: number; avgDuration: number }> =
        {};
      for (const m of byMode) {
        modeMap[m.mode] = {
          count: Number(m.count),
          avgDuration: Number(m.avgDuration ?? 0),
        };
      }

      return {
        totalSessions: Number(overall?.total ?? 0),
        avgDurationSeconds: Number(overall?.avgDuration ?? 0),
        medianDurationSeconds: Number(overall?.medianDuration ?? 0),
        byStatus: statusMap,
        byMode: modeMap,
      };
    }),

  // ---------------------------------------------------------------------------
  // Model usage (existing, kept for backward compat)
  // ---------------------------------------------------------------------------
  modelUsage: protectedProcedure
    .input(
      z.object({
        days: z.number().min(1).max(365).default(30),
      })
    )
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
        .where(
          and(eq(modelUsage.orgId, ctx.orgId), gte(modelUsage.createdAt, since))
        )
        .groupBy(modelUsage.model)
        .orderBy(
          desc(sql`SUM(${modelUsage.tokensIn} + ${modelUsage.tokensOut})`)
        );

      return {
        byModel: results.map((r) => ({
          model: r.model,
          requests: Number(r.requests),
          tokens: Number(r.tokens),
          cost: Number(r.cost),
        })),
      };
    }),

  // ---------------------------------------------------------------------------
  // Model usage from model_usage_logs (detailed, from model-router logging)
  // ---------------------------------------------------------------------------
  modelUsageBySlot: protectedProcedure
    .input(
      z.object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        groupBy: z.enum(["model", "provider", "slot", "day"]).default("model"),
      })
    )
    .query(async ({ ctx, input }) => {
      const since = input.startDate
        ? new Date(input.startDate)
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const until = input.endDate ? new Date(input.endDate) : new Date();

      const conditions = [
        eq(modelUsageLogs.orgId, ctx.orgId),
        gte(modelUsageLogs.createdAt, since),
        sql`${modelUsageLogs.createdAt} <= ${until}`,
      ];

      const groupByMap = {
        model: {
          groupCol: modelUsageLogs.modelKey,
          selectKey: { key: modelUsageLogs.modelKey },
        },
        provider: {
          groupCol: modelUsageLogs.provider,
          selectKey: { key: modelUsageLogs.provider },
        },
        slot: {
          groupCol: modelUsageLogs.slot,
          selectKey: { key: modelUsageLogs.slot },
        },
        day: {
          groupCol: sql`date_trunc('day', ${modelUsageLogs.createdAt})`,
          selectKey: {
            key: sql<string>`date_trunc('day', ${modelUsageLogs.createdAt})`,
          },
        },
      };

      const { groupCol, selectKey } = groupByMap[input.groupBy];

      const results = await ctx.db
        .select({
          ...selectKey,
          requests: sql<number>`COUNT(*)`,
          promptTokens: sql<number>`COALESCE(SUM(${modelUsageLogs.promptTokens}), 0)`,
          completionTokens: sql<number>`COALESCE(SUM(${modelUsageLogs.completionTokens}), 0)`,
          totalTokens: sql<number>`COALESCE(SUM(${modelUsageLogs.totalTokens}), 0)`,
          costUsd: sql<number>`COALESCE(SUM(${modelUsageLogs.costUsd}), 0)`,
        })
        .from(modelUsageLogs)
        .where(and(...conditions))
        .groupBy(groupCol)
        .orderBy(desc(sql`COALESCE(SUM(${modelUsageLogs.costUsd}), 0)`));

      return {
        groupBy: input.groupBy,
        data: results.map((r) => ({
          key: String(r.key),
          requests: Number(r.requests),
          promptTokens: Number(r.promptTokens),
          completionTokens: Number(r.completionTokens),
          totalTokens: Number(r.totalTokens),
          costUsd: Number(r.costUsd),
        })),
      };
    }),

  // ---------------------------------------------------------------------------
  // ROI estimation
  // ---------------------------------------------------------------------------
  roi: protectedProcedure.query(async ({ ctx }) => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [stats] = await ctx.db
      .select({
        tasksCompleted: sql<number>`COUNT(*) FILTER (WHERE ${tasks.status} = 'completed')`,
        totalCredits: sql<number>`COALESCE(SUM(${tasks.creditsConsumed}), 0)`,
        totalDuration: sql<number>`COALESCE(SUM(EXTRACT(EPOCH FROM (${tasks.completedAt} - ${tasks.startedAt}))), 0)`,
      })
      .from(tasks)
      .where(
        and(eq(tasks.orgId, ctx.orgId), gte(tasks.createdAt, thirtyDaysAgo))
      );

    // Estimate: each completed task saves ~30 min of developer time
    const hoursSaved = (Number(stats?.tasksCompleted ?? 0) * 30) / 60;
    const hourlyRate = 75; // $75/hr average developer rate
    const estimatedValue = hoursSaved * hourlyRate;
    const creditsCost = Number(stats?.totalCredits ?? 0);

    return {
      estimatedHoursSaved: Math.round(hoursSaved * 10) / 10,
      estimatedValueUsd: Math.round(estimatedValue),
      creditsCost,
      roiMultiplier:
        creditsCost > 0
          ? Math.round((estimatedValue / creditsCost) * 10) / 10
          : 0,
    };
  }),

  // ---------------------------------------------------------------------------
  // Team velocity (CT04) — powered by analytics engine
  // ---------------------------------------------------------------------------
  teamVelocity: protectedProcedure
    .input(
      z.object({
        days: z.number().min(1).max(365).default(90),
        period: z.enum(["day", "week", "month"]).default("week"),
      })
    )
    .query(async ({ input, ctx }) => {
      const { getTeamVelocity } = await import("../services/analytics-engine");
      return getTeamVelocity(ctx.db, ctx.orgId, input.period, input.days);
    }),

  // ---------------------------------------------------------------------------
  // Agent performance (CT04)
  // ---------------------------------------------------------------------------
  agentPerformanceDetailed: protectedProcedure
    .input(
      z
        .object({ days: z.number().min(1).max(365).default(30) })
        .default({ days: 30 })
    )
    .query(async ({ input, ctx }) => {
      const { getAgentPerformance } = await import(
        "../services/analytics-engine"
      );
      return getAgentPerformance(ctx.db, ctx.orgId, input.days);
    }),

  // ---------------------------------------------------------------------------
  // Cost breakdown (CT04) — by model, role, project
  // ---------------------------------------------------------------------------
  costBreakdownDetailed: protectedProcedure
    .input(
      z
        .object({ days: z.number().min(1).max(365).default(30) })
        .default({ days: 30 })
    )
    .query(async ({ input, ctx }) => {
      const { getCostBreakdown } = await import("../services/analytics-engine");
      return getCostBreakdown(ctx.db, ctx.orgId, input.days);
    }),

  // ---------------------------------------------------------------------------
  // Productivity gains (CT04) — estimated developer-hours saved
  // ---------------------------------------------------------------------------
  productivityGains: protectedProcedure
    .input(
      z
        .object({ days: z.number().min(1).max(365).default(30) })
        .default({ days: 30 })
    )
    .query(async ({ input, ctx }) => {
      const { getProductivityGains } = await import(
        "../services/analytics-engine"
      );
      return getProductivityGains(ctx.db, ctx.orgId, input.days);
    }),

  // ---------------------------------------------------------------------------
  // Trends (CT04) — time-series data for any metric
  // ---------------------------------------------------------------------------
  trends: protectedProcedure
    .input(
      z.object({
        days: z.number().min(1).max(365).default(30),
        metric: z.enum([
          "tasks_completed",
          "tasks_failed",
          "credits_consumed",
          "cost_usd",
          "sessions_created",
          "tokens_used",
        ]),
        period: z.enum(["day", "week", "month"]).default("day"),
      })
    )
    .query(async ({ input, ctx }) => {
      const { getTrends } = await import("../services/analytics-engine");
      return getTrends(
        ctx.db,
        ctx.orgId,
        input.metric,
        input.period,
        input.days
      );
    }),
});
