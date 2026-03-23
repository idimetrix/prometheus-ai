import { modelUsageLogs, sessions } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { and, avg, count, desc, eq, gte, sum } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

const logger = createLogger("cost-prediction-router");

const WHITESPACE_RE = /\s+/;
const ESCAPE_BACKSLASH_RE = /\\/g;

const CODE_COMPLEXITY_PATTERNS = [
  /refactor/i,
  /rewrite/i,
  /migrate/i,
  /test coverage/i,
  /end-to-end/i,
  /e2e/i,
  /performance/i,
  /security/i,
  /database.*schema/i,
  /api.*endpoint/i,
];

const MULTI_FILE_RE = /multiple files|across.*project/i;
const BROAD_SCOPE_RE = /entire|whole|all|complete/i;

/* -------------------------------------------------------------------------- */
/*  Constants                                                                  */
/* -------------------------------------------------------------------------- */

/** Approximate cost per token by model tier (USD). */
const COST_PER_TOKEN: Record<string, number> = {
  premium: 0.000_03,
  standard: 0.000_01,
  budget: 0.000_003,
  background: 0.000_001,
};

/** Estimated tokens per word of task description. */
const _TOKENS_PER_WORD = 1.5;

/** Base sandbox cost per minute (USD). */
const SANDBOX_COST_PER_MINUTE = 0.002;

/** Average session duration in minutes by complexity. */
const SESSION_DURATION_MINUTES: Record<string, number> = {
  trivial: 1,
  simple: 3,
  moderate: 10,
  complex: 25,
  very_complex: 45,
};

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

type TaskComplexity =
  | "trivial"
  | "simple"
  | "moderate"
  | "complex"
  | "very_complex";

export interface CostEstimate {
  confidence: "low" | "medium" | "high";
  estimatedCredits: number;
  estimatedSandboxMinutes: number;
  estimatedTokens: number;
  estimatedTotalUsd: number;
  high: number;
  low: number;
  mid: number;
}

function analyzeComplexity(
  description: string,
  _context?: string
): {
  complexity: TaskComplexity;
  factors: string[];
  score: number;
} {
  const words = description.trim().split(WHITESPACE_RE).length;
  const factors: string[] = [];

  let score = 0;

  // Word count factor
  if (words > 200) {
    score += 3;
    factors.push("lengthy_description");
  } else if (words > 80) {
    score += 2;
    factors.push("moderate_description");
  } else {
    score += 1;
  }

  // Code reference indicators
  for (const pattern of CODE_COMPLEXITY_PATTERNS) {
    if (pattern.test(description)) {
      score += 1;
      factors.push(pattern.source.replace(ESCAPE_BACKSLASH_RE, ""));
    }
  }

  // Multi-file indicators
  if (MULTI_FILE_RE.test(description)) {
    score += 2;
    factors.push("multi_file_scope");
  }

  // Scope keywords
  if (BROAD_SCOPE_RE.test(description)) {
    score += 2;
    factors.push("broad_scope");
  }

  let complexity: TaskComplexity;
  if (score <= 1) {
    complexity = "trivial";
  } else if (score <= 3) {
    complexity = "simple";
  } else if (score <= 6) {
    complexity = "moderate";
  } else if (score <= 9) {
    complexity = "complex";
  } else {
    complexity = "very_complex";
  }

  return { complexity, score, factors };
}

function estimateCost(
  complexity: TaskComplexity,
  mode: string,
  _historicalAvgTokens?: number
): CostEstimate {
  let tier: string;
  if (mode === "flagship") {
    tier = "premium";
  } else if (mode === "fast") {
    tier = "budget";
  } else {
    tier = "standard";
  }
  const costPerToken: number = COST_PER_TOKEN[tier] ?? 0.000_01;

  const durationMinutes = SESSION_DURATION_MINUTES[complexity] ?? 10;

  // Token estimates based on complexity
  const baseTokens: Record<TaskComplexity, number> = {
    trivial: 2000,
    simple: 8000,
    moderate: 25_000,
    complex: 60_000,
    very_complex: 120_000,
  };

  const estimatedTokens = baseTokens[complexity];
  const tokenCost = estimatedTokens * costPerToken;
  const sandboxCost = durationMinutes * SANDBOX_COST_PER_MINUTE;
  const mid = tokenCost + sandboxCost;

  // Confidence intervals
  const low = mid * 0.6;
  const high = mid * 1.8;

  let confidence: CostEstimate["confidence"];
  if (complexity === "trivial" || complexity === "simple") {
    confidence = "high";
  } else if (complexity === "moderate") {
    confidence = "medium";
  } else {
    confidence = "low";
  }

  // Credits: 1 credit ≈ $0.01
  const estimatedCredits = Math.ceil(mid / 0.01);

  return {
    estimatedTokens,
    estimatedSandboxMinutes: durationMinutes,
    estimatedTotalUsd: mid,
    estimatedCredits,
    low,
    mid,
    high,
    confidence,
  };
}

/* -------------------------------------------------------------------------- */
/*  Router                                                                     */
/* -------------------------------------------------------------------------- */

export const costPredictionRouter = router({
  /**
   * Predict the cost of a task before running it.
   */
  predictTaskCost: protectedProcedure
    .input(
      z.object({
        taskDescription: z.string().min(1).max(10_000),
        projectContext: z.string().max(5000).optional(),
        mode: z
          .enum(["flagship", "standard", "fast", "background"])
          .default("standard"),
      })
    )
    .query(async ({ input, ctx }) => {
      const { complexity, score, factors } = analyzeComplexity(
        input.taskDescription,
        input.projectContext
      );

      // Look up historical averages for this org to refine estimates
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      let historicalAvgTokens: number | undefined;
      try {
        const [historicalRow] = await ctx.db
          .select({
            avgTokens: avg(modelUsageLogs.totalTokens).mapWith(Number),
          })
          .from(modelUsageLogs)
          .where(
            and(
              eq(modelUsageLogs.orgId, ctx.orgId),
              gte(modelUsageLogs.createdAt, thirtyDaysAgo)
            )
          );
        historicalAvgTokens = historicalRow?.avgTokens ?? undefined;
      } catch (err) {
        logger.warn({ err }, "Failed to fetch historical token averages");
      }

      const estimate = estimateCost(
        complexity,
        input.mode,
        historicalAvgTokens
      );

      return {
        complexity,
        complexityScore: score,
        factors,
        estimate,
        wordCount: input.taskDescription.trim().split(WHITESPACE_RE).length,
      };
    }),

  /**
   * Project weekly/monthly cost forecast based on usage patterns.
   */
  getProjectCostForecast: protectedProcedure
    .input(
      z.object({
        projectId: z.string().optional(),
      })
    )
    .query(async ({ input: _input, ctx }) => {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      // Get weekly usage
      const weeklyConditions = [
        eq(modelUsageLogs.orgId, ctx.orgId),
        gte(modelUsageLogs.createdAt, sevenDaysAgo),
      ];

      const monthlyConditions = [
        eq(modelUsageLogs.orgId, ctx.orgId),
        gte(modelUsageLogs.createdAt, thirtyDaysAgo),
      ];

      const [weeklyRow] = await ctx.db
        .select({
          totalCost: sum(modelUsageLogs.costUsd).mapWith(Number),
          totalTokens: sum(modelUsageLogs.totalTokens).mapWith(Number),
          requestCount: count(),
        })
        .from(modelUsageLogs)
        .where(and(...weeklyConditions));

      const [monthlyRow] = await ctx.db
        .select({
          totalCost: sum(modelUsageLogs.costUsd).mapWith(Number),
          totalTokens: sum(modelUsageLogs.totalTokens).mapWith(Number),
          requestCount: count(),
        })
        .from(modelUsageLogs)
        .where(and(...monthlyConditions));

      // Per-agent-type breakdown
      const agentBreakdown = await ctx.db
        .select({
          mode: sessions.mode,
          totalCost: sum(modelUsageLogs.costUsd).mapWith(Number),
          requestCount: count(),
        })
        .from(modelUsageLogs)
        .innerJoin(sessions, eq(modelUsageLogs.sessionId, sessions.id))
        .where(
          and(
            eq(modelUsageLogs.orgId, ctx.orgId),
            gte(modelUsageLogs.createdAt, thirtyDaysAgo)
          )
        )
        .groupBy(sessions.mode)
        .orderBy(desc(sum(modelUsageLogs.costUsd)));

      const weeklyCost = weeklyRow?.totalCost ?? 0;
      const monthlyCost = monthlyRow?.totalCost ?? 0;

      // Trend: compare first half of month to second half
      const dailyAvgFirstHalf =
        monthlyCost > 0 ? (monthlyCost - weeklyCost) / 23 : 0;
      const dailyAvgLastWeek = weeklyCost / 7;

      let trend: "increasing" | "decreasing" | "stable";
      if (dailyAvgFirstHalf === 0) {
        trend = "stable";
      } else {
        const ratio = dailyAvgLastWeek / dailyAvgFirstHalf;
        if (ratio > 1.2) {
          trend = "increasing";
        } else if (ratio < 0.8) {
          trend = "decreasing";
        } else {
          trend = "stable";
        }
      }

      // Projections
      const projectedWeekly = dailyAvgLastWeek * 7;
      const projectedMonthly = dailyAvgLastWeek * 30;

      return {
        actual: {
          last7Days: weeklyCost,
          last30Days: monthlyCost,
          weeklyRequests: weeklyRow?.requestCount ?? 0,
          monthlyRequests: monthlyRow?.requestCount ?? 0,
        },
        projected: {
          nextWeek: projectedWeekly,
          nextMonth: projectedMonthly,
        },
        trend,
        agentBreakdown: agentBreakdown.map((row) => ({
          mode: row.mode,
          totalCost: row.totalCost ?? 0,
          requestCount: row.requestCount,
        })),
      };
    }),
});
