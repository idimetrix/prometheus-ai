/**
 * Analytics Engine (CT04) — Team Velocity Analytics with real data.
 *
 * Provides functions for computing team velocity, agent performance,
 * cost breakdowns, productivity gains, and time-series trends from
 * the database using Drizzle ORM aggregations.
 */

import {
  agents,
  creditTransactions,
  modelUsage,
  modelUsageLogs,
  projects,
  sessions,
  tasks,
} from "@prometheus/db";
import { and, desc, eq, gte, lte, type SQL, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Period = "day" | "week" | "month";

export interface DateRange {
  since: Date;
  until: Date;
}

export interface VelocityDataPoint {
  avgDurationSeconds: number;
  cancelled: number;
  completed: number;
  credits: number;
  date: string;
  failed: number;
  total: number;
}

export interface AgentPerformanceEntry {
  avgDurationSeconds: number;
  avgSteps: number;
  creditsPerTask: number;
  errorCount: number;
  role: string;
  successRate: number;
  totalInvocations: number;
  totalTokens: number;
}

export interface CostBreakdownEntry {
  cost: number;
  costPercent: number;
  key: string;
  requests: number;
  tokens: number;
}

export interface ProductivityGains {
  costPerHourSaved: number;
  estimatedValueUsd: number;
  hoursSaved: number;
  roiMultiplier: number;
  tasksCompleted: number;
  totalCostUsd: number;
}

export interface TrendDataPoint {
  date: string;
  value: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveDateRange(days: number): DateRange {
  const until = new Date();
  const since = new Date(until.getTime() - days * 24 * 60 * 60 * 1000);
  return { since, until };
}

// biome-ignore lint/suspicious/noExplicitAny: Drizzle db type is complex
type DB = PostgresJsDatabase<any>;

/** Maps a period + column to the appropriate date_trunc SQL expression. */
const TRUNC_MAP: Record<Period, (col: SQL) => SQL> = {
  day: (col) => sql`date_trunc('day', ${col})`,
  week: (col) => sql`date_trunc('week', ${col})`,
  month: (col) => sql`date_trunc('month', ${col})`,
};

function dateTruncFor(period: Period, column: SQL): SQL {
  return TRUNC_MAP[period](column);
}

function costPercent(cost: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  return Math.round((cost / total) * 1000) / 10;
}

function mapTrendRows(
  rows: Array<{ date: unknown; value: unknown }>
): TrendDataPoint[] {
  return rows.map((r) => ({
    date: String(r.date),
    value: Number(r.value),
  }));
}

// ---------------------------------------------------------------------------
// getTeamVelocity
// ---------------------------------------------------------------------------

export async function getTeamVelocity(
  db: DB,
  orgId: string,
  period: Period = "week",
  days = 90
): Promise<{
  avgPerPeriod: number;
  dataPoints: VelocityDataPoint[];
  totalCompleted: number;
  trend: "up" | "down" | "stable";
}> {
  const { since } = resolveDateRange(days);
  const dateTrunc = dateTruncFor(period, sql`${tasks.completedAt}`);

  const results = await db
    .select({
      date: dateTrunc.as("date"),
      completed: sql<number>`COUNT(*) FILTER (WHERE ${tasks.status} = 'completed')`,
      failed: sql<number>`COUNT(*) FILTER (WHERE ${tasks.status} = 'failed')`,
      cancelled: sql<number>`COUNT(*) FILTER (WHERE ${tasks.status} = 'cancelled')`,
      total: sql<number>`COUNT(*)`,
      credits: sql<number>`COALESCE(SUM(${tasks.creditsConsumed}), 0)`,
      avgDuration: sql<number>`AVG(EXTRACT(EPOCH FROM (${tasks.completedAt} - ${tasks.startedAt})))`,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.orgId, orgId),
        gte(tasks.createdAt, since),
        sql`${tasks.completedAt} IS NOT NULL`
      )
    )
    .groupBy(sql`date`)
    .orderBy(sql`date`);

  const dataPoints: VelocityDataPoint[] = results.map((r) => ({
    date: String(r.date),
    completed: Number(r.completed),
    failed: Number(r.failed),
    cancelled: Number(r.cancelled),
    total: Number(r.total),
    credits: Number(r.credits),
    avgDurationSeconds: Math.round(Number(r.avgDuration ?? 0)),
  }));

  // Trend calculation
  let trend: "up" | "down" | "stable" = "stable";
  if (dataPoints.length >= 2) {
    const current = dataPoints.at(-1);
    const previous = dataPoints.at(-2);
    if (current && previous) {
      if (current.completed > previous.completed * 1.1) {
        trend = "up";
      } else if (current.completed < previous.completed * 0.9) {
        trend = "down";
      }
    }
  }

  const totalCompleted = dataPoints.reduce((s, d) => s + d.completed, 0);
  const avgPerPeriod =
    dataPoints.length > 0 ? Math.round(totalCompleted / dataPoints.length) : 0;

  return { dataPoints, totalCompleted, avgPerPeriod, trend };
}

// ---------------------------------------------------------------------------
// getAgentPerformance
// ---------------------------------------------------------------------------

export async function getAgentPerformance(
  db: DB,
  orgId: string,
  days = 30
): Promise<{ byRole: AgentPerformanceEntry[] }> {
  const { since } = resolveDateRange(days);

  // Join agents -> sessions -> projects to filter by orgId
  const results = await db
    .select({
      role: agents.role,
      total: sql<number>`COUNT(*)`,
      errorCount: sql<number>`COUNT(*) FILTER (WHERE ${agents.status} = 'error')`,
      avgSteps: sql<number>`AVG(${agents.stepsCompleted})`,
      avgDuration: sql<number>`AVG(EXTRACT(EPOCH FROM (${agents.terminatedAt} - ${agents.startedAt})))`,
      totalTokensIn: sql<number>`COALESCE(SUM(${agents.tokensIn}), 0)`,
      totalTokensOut: sql<number>`COALESCE(SUM(${agents.tokensOut}), 0)`,
    })
    .from(agents)
    .innerJoin(sessions, eq(agents.sessionId, sessions.id))
    .innerJoin(projects, eq(sessions.projectId, projects.id))
    .where(and(eq(projects.orgId, orgId), gte(agents.startedAt, since)))
    .groupBy(agents.role)
    .orderBy(desc(sql`COUNT(*)`));

  // Get per-role credit consumption from tasks
  const creditsByRole = await db
    .select({
      agentRole: tasks.agentRole,
      totalCredits: sql<number>`COALESCE(SUM(${tasks.creditsConsumed}), 0)`,
      taskCount: sql<number>`COUNT(*)`,
    })
    .from(tasks)
    .where(and(eq(tasks.orgId, orgId), gte(tasks.createdAt, since)))
    .groupBy(tasks.agentRole);

  const creditsMap = new Map<
    string,
    { totalCredits: number; taskCount: number }
  >();
  for (const c of creditsByRole) {
    if (c.agentRole) {
      creditsMap.set(c.agentRole, {
        totalCredits: Number(c.totalCredits),
        taskCount: Number(c.taskCount),
      });
    }
  }

  const byRole: AgentPerformanceEntry[] = results.map((r) => {
    const total = Number(r.total);
    const errored = Number(r.errorCount);
    const credits = creditsMap.get(r.role);
    const creditsPerTask =
      credits && credits.taskCount > 0
        ? Math.round((credits.totalCredits / credits.taskCount) * 100) / 100
        : 0;

    return {
      role: r.role,
      totalInvocations: total,
      errorCount: errored,
      successRate:
        total > 0 ? Math.round(((total - errored) / total) * 1000) / 10 : 0,
      avgDurationSeconds: Math.round(Number(r.avgDuration ?? 0)),
      avgSteps: Math.round(Number(r.avgSteps ?? 0) * 10) / 10,
      totalTokens: Number(r.totalTokensIn) + Number(r.totalTokensOut),
      creditsPerTask,
    };
  });

  return { byRole };
}

// ---------------------------------------------------------------------------
// getCostBreakdown
// ---------------------------------------------------------------------------

export async function getCostBreakdown(
  db: DB,
  orgId: string,
  days = 30
): Promise<{
  byModel: CostBreakdownEntry[];
  byProject: CostBreakdownEntry[];
  byRole: CostBreakdownEntry[];
  totalCostUsd: number;
}> {
  const { since } = resolveDateRange(days);

  // Cost by model
  const byModelRows = await db
    .select({
      key: modelUsage.model,
      requests: sql<number>`COUNT(*)`,
      tokens: sql<number>`COALESCE(SUM(${modelUsage.tokensIn} + ${modelUsage.tokensOut}), 0)`,
      cost: sql<number>`COALESCE(SUM(${modelUsage.costUsd}), 0)`,
    })
    .from(modelUsage)
    .where(and(eq(modelUsage.orgId, orgId), gte(modelUsage.createdAt, since)))
    .groupBy(modelUsage.model)
    .orderBy(desc(sql`SUM(${modelUsage.costUsd})`));

  const totalCost = byModelRows.reduce((s, r) => s + Number(r.cost), 0);

  const byModel: CostBreakdownEntry[] = byModelRows.map((r) => ({
    key: r.key,
    requests: Number(r.requests),
    tokens: Number(r.tokens),
    cost: Math.round(Number(r.cost) * 10_000) / 10_000,
    costPercent: costPercent(Number(r.cost), totalCost),
  }));

  // Cost by agent role (from tasks + model_usage join)
  const byRoleRows = await db
    .select({
      key: tasks.agentRole,
      requests: sql<number>`COUNT(DISTINCT ${modelUsage.id})`,
      tokens: sql<number>`COALESCE(SUM(${modelUsage.tokensIn} + ${modelUsage.tokensOut}), 0)`,
      cost: sql<number>`COALESCE(SUM(${modelUsage.costUsd}), 0)`,
    })
    .from(tasks)
    .innerJoin(modelUsage, eq(tasks.id, modelUsage.taskId))
    .where(and(eq(tasks.orgId, orgId), gte(tasks.createdAt, since)))
    .groupBy(tasks.agentRole)
    .orderBy(desc(sql`SUM(${modelUsage.costUsd})`));

  const byRole: CostBreakdownEntry[] = byRoleRows.map((r) => ({
    key: r.key ?? "unknown",
    requests: Number(r.requests),
    tokens: Number(r.tokens),
    cost: Math.round(Number(r.cost) * 10_000) / 10_000,
    costPercent: costPercent(Number(r.cost), totalCost),
  }));

  // Cost by project
  const byProjectRows = await db
    .select({
      key: projects.id,
      requests: sql<number>`COUNT(*)`,
      tokens: sql<number>`COALESCE(SUM(${modelUsage.tokensIn} + ${modelUsage.tokensOut}), 0)`,
      cost: sql<number>`COALESCE(SUM(${modelUsage.costUsd}), 0)`,
    })
    .from(modelUsage)
    .innerJoin(tasks, eq(modelUsage.taskId, tasks.id))
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .where(and(eq(projects.orgId, orgId), gte(modelUsage.createdAt, since)))
    .groupBy(projects.id)
    .orderBy(desc(sql`SUM(${modelUsage.costUsd})`))
    .limit(20);

  const byProject: CostBreakdownEntry[] = byProjectRows.map((r) => ({
    key: r.key,
    requests: Number(r.requests),
    tokens: Number(r.tokens),
    cost: Math.round(Number(r.cost) * 10_000) / 10_000,
    costPercent: costPercent(Number(r.cost), totalCost),
  }));

  return {
    totalCostUsd: Math.round(totalCost * 100) / 100,
    byModel,
    byRole,
    byProject,
  };
}

// ---------------------------------------------------------------------------
// getProductivityGains
// ---------------------------------------------------------------------------

export async function getProductivityGains(
  db: DB,
  orgId: string,
  days = 30
): Promise<ProductivityGains> {
  const { since } = resolveDateRange(days);

  const [taskStats] = await db
    .select({
      tasksCompleted: sql<number>`COUNT(*) FILTER (WHERE ${tasks.status} = 'completed')`,
      totalDurationSec: sql<number>`COALESCE(SUM(EXTRACT(EPOCH FROM (${tasks.completedAt} - ${tasks.startedAt}))), 0)`,
    })
    .from(tasks)
    .where(and(eq(tasks.orgId, orgId), gte(tasks.createdAt, since)));

  const [costData] = await db
    .select({
      totalCostUsd: sql<number>`COALESCE(SUM(${modelUsage.costUsd}), 0)`,
    })
    .from(modelUsage)
    .where(and(eq(modelUsage.orgId, orgId), gte(modelUsage.createdAt, since)));

  const tasksCompleted = Number(taskStats?.tasksCompleted ?? 0);
  const totalCostUsd = Number(costData?.totalCostUsd ?? 0);

  // Estimate: each completed task saves ~30 min of developer time on average
  const minutesSavedPerTask = 30;
  const hourlyRate = 75; // average developer hourly rate
  const hoursSaved = (tasksCompleted * minutesSavedPerTask) / 60;
  const estimatedValueUsd = hoursSaved * hourlyRate;
  const costPerHourSaved = hoursSaved > 0 ? totalCostUsd / hoursSaved : 0;

  return {
    tasksCompleted,
    hoursSaved: Math.round(hoursSaved * 10) / 10,
    estimatedValueUsd: Math.round(estimatedValueUsd),
    totalCostUsd: Math.round(totalCostUsd * 100) / 100,
    roiMultiplier:
      totalCostUsd > 0
        ? Math.round((estimatedValueUsd / totalCostUsd) * 10) / 10
        : 0,
    costPerHourSaved: Math.round(costPerHourSaved * 100) / 100,
  };
}

// ---------------------------------------------------------------------------
// getTrends — per-metric helpers
// ---------------------------------------------------------------------------

export type TrendMetric =
  | "tasks_completed"
  | "tasks_failed"
  | "credits_consumed"
  | "cost_usd"
  | "sessions_created"
  | "tokens_used";

async function getTaskTrend(
  db: DB,
  orgId: string,
  statusFilter: string,
  period: Period,
  since: Date,
  until: Date
): Promise<TrendDataPoint[]> {
  const dateTrunc = dateTruncFor(period, sql`${tasks.completedAt}`);

  const results = await db
    .select({
      date: dateTrunc.as("date"),
      value: sql<number>`COUNT(*) FILTER (WHERE ${tasks.status} = ${statusFilter})`,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.orgId, orgId),
        gte(tasks.createdAt, since),
        lte(tasks.createdAt, until)
      )
    )
    .groupBy(sql`date`)
    .orderBy(sql`date`);

  return mapTrendRows(results);
}

async function getCreditsTrend(
  db: DB,
  orgId: string,
  period: Period,
  since: Date,
  until: Date
): Promise<TrendDataPoint[]> {
  const dateTrunc = dateTruncFor(period, sql`${creditTransactions.createdAt}`);

  const results = await db
    .select({
      date: dateTrunc.as("date"),
      value: sql<number>`COALESCE(SUM(ABS(${creditTransactions.amount})) FILTER (WHERE ${creditTransactions.type} = 'consumption'), 0)`,
    })
    .from(creditTransactions)
    .where(
      and(
        eq(creditTransactions.orgId, orgId),
        gte(creditTransactions.createdAt, since),
        lte(creditTransactions.createdAt, until)
      )
    )
    .groupBy(sql`date`)
    .orderBy(sql`date`);

  return mapTrendRows(results);
}

async function getCostTrend(
  db: DB,
  orgId: string,
  period: Period,
  since: Date,
  until: Date
): Promise<TrendDataPoint[]> {
  const dateTrunc = dateTruncFor(period, sql`${modelUsage.createdAt}`);

  const results = await db
    .select({
      date: dateTrunc.as("date"),
      value: sql<number>`COALESCE(SUM(${modelUsage.costUsd}), 0)`,
    })
    .from(modelUsage)
    .where(
      and(
        eq(modelUsage.orgId, orgId),
        gte(modelUsage.createdAt, since),
        lte(modelUsage.createdAt, until)
      )
    )
    .groupBy(sql`date`)
    .orderBy(sql`date`);

  return mapTrendRows(results);
}

async function getSessionsTrend(
  db: DB,
  orgId: string,
  period: Period,
  since: Date,
  until: Date
): Promise<TrendDataPoint[]> {
  const dateTrunc = dateTruncFor(period, sql`${sessions.startedAt}`);

  // Use a subquery to filter sessions by org projects
  const results = await db
    .select({
      date: dateTrunc.as("date"),
      value: sql<number>`COUNT(*)`,
    })
    .from(sessions)
    .innerJoin(projects, eq(sessions.projectId, projects.id))
    .where(
      and(
        eq(projects.orgId, orgId),
        gte(sessions.startedAt, since),
        lte(sessions.startedAt, until)
      )
    )
    .groupBy(sql`date`)
    .orderBy(sql`date`);

  return mapTrendRows(results);
}

async function getTokensTrend(
  db: DB,
  orgId: string,
  period: Period,
  since: Date,
  until: Date
): Promise<TrendDataPoint[]> {
  const dateTrunc = dateTruncFor(period, sql`${modelUsageLogs.createdAt}`);

  const results = await db
    .select({
      date: dateTrunc.as("date"),
      value: sql<number>`COALESCE(SUM(${modelUsageLogs.totalTokens}), 0)`,
    })
    .from(modelUsageLogs)
    .where(
      and(
        eq(modelUsageLogs.orgId, orgId),
        gte(modelUsageLogs.createdAt, since),
        lte(modelUsageLogs.createdAt, until)
      )
    )
    .groupBy(sql`date`)
    .orderBy(sql`date`);

  return mapTrendRows(results);
}

// ---------------------------------------------------------------------------
// getTrends — public entry point
// ---------------------------------------------------------------------------

export async function getTrends(
  db: DB,
  orgId: string,
  metric: TrendMetric,
  period: Period = "day",
  days = 30
): Promise<{ dataPoints: TrendDataPoint[] }> {
  const { since, until } = resolveDateRange(days);

  let dataPoints: TrendDataPoint[];

  switch (metric) {
    case "tasks_completed":
      dataPoints = await getTaskTrend(
        db,
        orgId,
        "completed",
        period,
        since,
        until
      );
      break;
    case "tasks_failed":
      dataPoints = await getTaskTrend(
        db,
        orgId,
        "failed",
        period,
        since,
        until
      );
      break;
    case "credits_consumed":
      dataPoints = await getCreditsTrend(db, orgId, period, since, until);
      break;
    case "cost_usd":
      dataPoints = await getCostTrend(db, orgId, period, since, until);
      break;
    case "sessions_created":
      dataPoints = await getSessionsTrend(db, orgId, period, since, until);
      break;
    case "tokens_used":
      dataPoints = await getTokensTrend(db, orgId, period, since, until);
      break;
    default:
      dataPoints = [];
  }

  return { dataPoints };
}
