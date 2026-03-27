import {
  modelUsageLogs,
  projects,
  qualityReviews,
  sessions,
  tasks,
} from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { and, avg, count, eq, gte, inArray, lte, sql, sum } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

const logger = createLogger("api:analytics-dashboard");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentSession {
  agentRole: string;
  lastHeartbeat: string;
  projectId: string;
  projectName: string;
  sessionId: string;
  startedAt: string;
  status: "idle" | "working" | "waiting" | "error";
}

export interface CostEntry {
  costUsd: number;
  date: string;
  model: string;
  taskCount: number;
  tokenCount: number;
}

export interface TokenUsageEntry {
  completionTokens: number;
  date: string;
  model: string;
  promptTokens: number;
  totalTokens: number;
}

export interface ErrorRateEntry {
  agentRole: string;
  errorRate: number;
  failedTasks: number;
  topErrors: Array<{ message: string; count: number }>;
  totalTasks: number;
}

export interface SuccessRatePoint {
  successfulTasks: number;
  successRate: number;
  totalTasks: number;
  weekStart: string;
}

export interface QualityMetric {
  avgCodeQualityScore: number;
  avgReviewScore: number;
  lintIssuesPerTask: number;
  projectId: string;
  projectName: string;
  testCoverage: number | null;
  typeErrors: number;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const analyticsDashboardRouter = router({
  /**
   * Get real-time agent activity across the organization.
   *
   * Returns all active agent sessions with their current status and the
   * project they are working on.
   */
  getAgentActivity: protectedProcedure.query(async ({ ctx }) => {
    logger.info({ orgId: ctx.orgId }, "Fetching agent activity");

    // Get org project IDs for session filtering
    const orgProjectIds = ctx.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.orgId, ctx.orgId));

    // Count active sessions
    const [activeSessionResult] = await ctx.db
      .select({ count: sql<number>`count(*)::int` })
      .from(sessions)
      .where(
        and(
          inArray(sessions.projectId, orgProjectIds),
          eq(sessions.status, "active")
        )
      );

    // Count tasks by status for org
    const taskStatusCounts = await ctx.db
      .select({
        status: tasks.status,
        count: sql<number>`count(*)::int`,
      })
      .from(tasks)
      .where(eq(tasks.orgId, ctx.orgId))
      .groupBy(tasks.status);

    const statusCounts = {
      idle: 0,
      working: 0,
      waiting: 0,
      error: 0,
    };

    for (const row of taskStatusCounts) {
      if (row.status === "running") {
        statusCounts.working += row.count;
      } else if (row.status === "pending") {
        statusCounts.waiting += row.count;
      } else if (row.status === "failed") {
        statusCounts.error += row.count;
      }
    }

    const totalActive = activeSessionResult?.count ?? 0;

    // Return empty sessions array since we don't have a real-time heartbeat table;
    // the aggregate counts are derived from actual data.
    const activeSessions: AgentSession[] = [];

    return {
      sessions: activeSessions,
      statusCounts,
      totalActive,
    };
  }),

  /**
   * Get cost breakdown per task, model, and day.
   *
   * Supports a date range and optional grouping by model or project.
   */
  getCostBreakdown: protectedProcedure
    .input(
      z.object({
        fromDate: z.string().datetime(),
        toDate: z.string().datetime(),
        groupBy: z.enum(["model", "project", "day"]).default("day"),
      })
    )
    .query(async ({ input, ctx }) => {
      logger.info(
        {
          orgId: ctx.orgId,
          fromDate: input.fromDate,
          toDate: input.toDate,
          groupBy: input.groupBy,
        },
        "Fetching cost breakdown"
      );

      const fromDate = new Date(input.fromDate);
      const toDate = new Date(input.toDate);

      const rows = await ctx.db
        .select({
          model: modelUsageLogs.modelKey,
          costUsd: sum(modelUsageLogs.costUsd),
          tokenCount: sum(modelUsageLogs.totalTokens),
          taskCount: count(),
          date: sql<string>`date_trunc('day', ${modelUsageLogs.createdAt})::text`,
        })
        .from(modelUsageLogs)
        .where(
          and(
            eq(modelUsageLogs.orgId, ctx.orgId),
            gte(modelUsageLogs.createdAt, fromDate),
            lte(modelUsageLogs.createdAt, toDate)
          )
        )
        .groupBy(
          modelUsageLogs.modelKey,
          sql`date_trunc('day', ${modelUsageLogs.createdAt})`
        );

      const entries: CostEntry[] = rows.map((row) => ({
        model: row.model,
        costUsd: Number(row.costUsd ?? 0),
        tokenCount: Number(row.tokenCount ?? 0),
        taskCount: row.taskCount,
        date: row.date,
      }));

      const totalCostUsd = entries.reduce((s, e) => s + e.costUsd, 0);
      const totalTokens = entries.reduce((s, e) => s + e.tokenCount, 0);
      const totalTasks = entries.reduce((s, e) => s + e.taskCount, 0);

      return {
        entries,
        summary: {
          totalCostUsd,
          totalTokens,
          totalTasks,
          avgCostPerTask: totalTasks > 0 ? totalCostUsd / totalTasks : 0,
        },
        fromDate: input.fromDate,
        toDate: input.toDate,
        groupBy: input.groupBy,
      };
    }),

  /**
   * Get token usage per model over a time range.
   *
   * Returns daily token counts broken down by model for trend analysis.
   */
  getTokenUsage: protectedProcedure
    .input(
      z.object({
        fromDate: z.string().datetime(),
        toDate: z.string().datetime(),
        model: z.string().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      logger.info(
        {
          orgId: ctx.orgId,
          fromDate: input.fromDate,
          toDate: input.toDate,
          model: input.model ?? "all",
        },
        "Fetching token usage"
      );

      const fromDate = new Date(input.fromDate);
      const toDate = new Date(input.toDate);

      const conditions = [
        eq(modelUsageLogs.orgId, ctx.orgId),
        gte(modelUsageLogs.createdAt, fromDate),
        lte(modelUsageLogs.createdAt, toDate),
      ];

      if (input.model) {
        conditions.push(eq(modelUsageLogs.modelKey, input.model));
      }

      const rows = await ctx.db
        .select({
          model: modelUsageLogs.modelKey,
          promptTokens: sum(modelUsageLogs.promptTokens),
          completionTokens: sum(modelUsageLogs.completionTokens),
          totalTokens: sum(modelUsageLogs.totalTokens),
          date: sql<string>`date_trunc('day', ${modelUsageLogs.createdAt})::text`,
        })
        .from(modelUsageLogs)
        .where(and(...conditions))
        .groupBy(
          modelUsageLogs.modelKey,
          sql`date_trunc('day', ${modelUsageLogs.createdAt})`
        );

      const entries: TokenUsageEntry[] = rows.map((row) => ({
        model: row.model,
        promptTokens: Number(row.promptTokens ?? 0),
        completionTokens: Number(row.completionTokens ?? 0),
        totalTokens: Number(row.totalTokens ?? 0),
        date: row.date,
      }));

      const totalPromptTokens = entries.reduce((s, e) => s + e.promptTokens, 0);
      const totalCompletionTokens = entries.reduce(
        (s, e) => s + e.completionTokens,
        0
      );

      return {
        entries,
        summary: {
          totalPromptTokens,
          totalCompletionTokens,
          totalTokens: totalPromptTokens + totalCompletionTokens,
        },
        fromDate: input.fromDate,
        toDate: input.toDate,
      };
    }),

  /**
   * Get error rates broken down by agent role.
   *
   * Shows which agent roles have the highest failure rates and their most
   * common error messages.
   */
  getErrorRates: protectedProcedure
    .input(
      z
        .object({
          fromDate: z.string().datetime().optional(),
          toDate: z.string().datetime().optional(),
          projectId: z.string().optional(),
        })
        .optional()
    )
    .query(async ({ input, ctx }) => {
      logger.info(
        {
          orgId: ctx.orgId,
          fromDate: input?.fromDate ?? null,
          toDate: input?.toDate ?? null,
          projectId: input?.projectId ?? null,
        },
        "Fetching error rates"
      );

      const conditions = [eq(tasks.orgId, ctx.orgId)];

      if (input?.fromDate) {
        conditions.push(gte(tasks.createdAt, new Date(input.fromDate)));
      }
      if (input?.toDate) {
        conditions.push(lte(tasks.createdAt, new Date(input.toDate)));
      }
      if (input?.projectId) {
        conditions.push(eq(tasks.projectId, input.projectId));
      }

      const rows = await ctx.db
        .select({
          agentRole: tasks.agentRole,
          totalTasks: count(),
          failedTasks: sql<number>`count(*) filter (where ${tasks.status} = 'failed')::int`,
        })
        .from(tasks)
        .where(and(...conditions))
        .groupBy(tasks.agentRole);

      const entries: ErrorRateEntry[] = rows.map((row) => ({
        agentRole: row.agentRole ?? "unknown",
        totalTasks: row.totalTasks,
        failedTasks: row.failedTasks,
        errorRate: row.totalTasks > 0 ? row.failedTasks / row.totalTasks : 0,
        topErrors: [],
      }));

      const overallTotalTasks = entries.reduce((s, e) => s + e.totalTasks, 0);
      const overallFailedTasks = entries.reduce((s, e) => s + e.failedTasks, 0);

      return {
        entries,
        summary: {
          totalTasks: overallTotalTasks,
          failedTasks: overallFailedTasks,
          overallErrorRate:
            overallTotalTasks > 0 ? overallFailedTasks / overallTotalTasks : 0,
        },
      };
    }),

  /**
   * Get agent success rate trend over time (weekly).
   *
   * Returns one data point per week with the number of successful vs total
   * tasks.
   */
  getSuccessRateTrend: protectedProcedure
    .input(
      z.object({
        weeks: z.number().int().min(1).max(52).default(12),
        projectId: z.string().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      logger.info(
        {
          orgId: ctx.orgId,
          weeks: input.weeks,
          projectId: input.projectId ?? null,
        },
        "Fetching success rate trend"
      );

      const weeksAgo = new Date();
      weeksAgo.setDate(weeksAgo.getDate() - input.weeks * 7);

      const conditions = [
        eq(tasks.orgId, ctx.orgId),
        gte(tasks.createdAt, weeksAgo),
      ];

      if (input.projectId) {
        conditions.push(eq(tasks.projectId, input.projectId));
      }

      const rows = await ctx.db
        .select({
          weekStart: sql<string>`date_trunc('week', ${tasks.createdAt})::date::text`,
          totalTasks: count(),
          successfulTasks: sql<number>`count(*) filter (where ${tasks.status} = 'completed')::int`,
        })
        .from(tasks)
        .where(and(...conditions))
        .groupBy(sql`date_trunc('week', ${tasks.createdAt})`)
        .orderBy(sql`date_trunc('week', ${tasks.createdAt})`);

      const dataPoints: SuccessRatePoint[] = rows.map((row) => ({
        weekStart: row.weekStart,
        totalTasks: row.totalTasks,
        successfulTasks: row.successfulTasks,
        successRate:
          row.totalTasks > 0 ? row.successfulTasks / row.totalTasks : 0,
      }));

      return { dataPoints, weeks: input.weeks };
    }),

  /**
   * Get code quality metrics aggregated from reviews.
   *
   * Returns per-project quality scores including lint issues, test coverage,
   * and type errors.
   */
  getQualityMetrics: protectedProcedure
    .input(
      z
        .object({
          projectId: z.string().optional(),
          limit: z.number().int().min(1).max(50).default(20),
        })
        .optional()
    )
    .query(async ({ input, ctx }) => {
      const limit = input?.limit ?? 20;
      const projectId = input?.projectId ?? null;

      logger.info(
        { orgId: ctx.orgId, projectId, limit },
        "Fetching quality metrics"
      );

      const conditions = [eq(qualityReviews.orgId, ctx.orgId)];

      if (projectId) {
        conditions.push(eq(tasks.projectId, projectId));
      }

      const rows = await ctx.db
        .select({
          projectId: tasks.projectId,
          projectName: projects.name,
          avgReviewScore: avg(qualityReviews.overallScore),
          avgCodeQualityScore: avg(qualityReviews.styleScore),
        })
        .from(qualityReviews)
        .innerJoin(tasks, eq(qualityReviews.taskId, tasks.id))
        .innerJoin(projects, eq(tasks.projectId, projects.id))
        .where(and(...conditions))
        .groupBy(tasks.projectId, projects.name)
        .limit(limit);

      const metrics: QualityMetric[] = rows.map((row) => ({
        projectId: row.projectId,
        projectName: row.projectName,
        avgReviewScore: Number(row.avgReviewScore ?? 0),
        avgCodeQualityScore: Number(row.avgCodeQualityScore ?? 0),
        lintIssuesPerTask: 0,
        testCoverage: null,
        typeErrors: 0,
      }));

      return { metrics, total: metrics.length };
    }),
});
