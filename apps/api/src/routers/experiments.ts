import { strategyExperiments } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

const logger = createLogger("api:experiments");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface VariantResults {
  avgDurationMs: number;
  successes: number;
  successRate: number;
  trials: number;
}

function computeResults(
  resultsA: Record<string, unknown>,
  resultsB: Record<string, unknown>,
  strategyA: string,
  strategyB: string,
  targetTrials: number
) {
  const varA: VariantResults = {
    trials: (resultsA.trials as number) ?? 0,
    successes: (resultsA.successes as number) ?? 0,
    successRate: (resultsA.successRate as number) ?? 0,
    avgDurationMs: (resultsA.avgDurationMs as number) ?? 0,
  };

  const varB: VariantResults = {
    trials: (resultsB.trials as number) ?? 0,
    successes: (resultsB.successes as number) ?? 0,
    successRate: (resultsB.successRate as number) ?? 0,
    avgDurationMs: (resultsB.avgDurationMs as number) ?? 0,
  };

  const totalTrials = varA.trials + varB.trials;

  let winner: "A" | "B" | "inconclusive" = "inconclusive";

  if (totalTrials >= targetTrials) {
    if (varA.successRate > varB.successRate + 0.05) {
      winner = "A";
    } else if (varB.successRate > varA.successRate + 0.05) {
      winner = "B";
    }
  }

  return {
    variantA: {
      strategy: strategyA,
      trials: varA.trials,
      successes: varA.successes,
      successRate: varA.successRate,
      avgDurationMs: Math.round(varA.avgDurationMs),
    },
    variantB: {
      strategy: strategyB,
      trials: varB.trials,
      successes: varB.successes,
      successRate: varB.successRate,
      avgDurationMs: Math.round(varB.avgDurationMs),
    },
    totalTrials,
    targetTrials,
    winner,
    progress: Math.min(1, totalTrials / targetTrials),
  };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const experimentsRouter = router({
  /**
   * Create a new A/B experiment.
   *
   * Defines two strategies (A and B) and the target number of trials
   * needed to reach a conclusion.
   */
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1, "Experiment name is required").max(255),
        description: z.string().max(1000).optional(),
        strategyA: z.string().min(1, "Strategy A is required").max(500),
        strategyB: z.string().min(1, "Strategy B is required").max(500),
        targetTrials: z.number().int().min(10).max(10_000).default(100),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const id = generateId("exp");

      const initialResults = {
        trials: 0,
        successes: 0,
        successRate: 0,
        avgDurationMs: 0,
        targetTrials: input.targetTrials,
        description: input.description ?? null,
        createdBy: ctx.auth.userId,
      };

      await ctx.db.insert(strategyExperiments).values({
        id,
        orgId: ctx.orgId,
        experimentName: input.name,
        strategyA: input.strategyA,
        strategyB: input.strategyB,
        resultsA: initialResults,
        resultsB: initialResults,
        status: "running",
      });

      logger.info(
        {
          orgId: ctx.orgId,
          experimentId: id,
          name: input.name,
          targetTrials: input.targetTrials,
        },
        "Experiment created"
      );

      return {
        id,
        name: input.name,
        status: "running" as const,
        strategyA: input.strategyA,
        strategyB: input.strategyB,
        targetTrials: input.targetTrials,
        createdAt: new Date().toISOString(),
      };
    }),

  /**
   * List all experiments for the organization.
   */
  list: protectedProcedure
    .input(
      z
        .object({
          status: z.enum(["running", "completed", "cancelled"]).optional(),
          limit: z.number().int().min(1).max(100).default(25),
          offset: z.number().int().min(0).default(0),
        })
        .optional()
    )
    .query(async ({ input, ctx }) => {
      const limit = input?.limit ?? 25;
      const offset = input?.offset ?? 0;
      const statusFilter = input?.status ?? null;

      const conditions = [eq(strategyExperiments.orgId, ctx.orgId)];

      if (statusFilter) {
        conditions.push(eq(strategyExperiments.status, statusFilter));
      }

      const [rows, totalResult] = await Promise.all([
        ctx.db
          .select()
          .from(strategyExperiments)
          .where(and(...conditions))
          .orderBy(desc(strategyExperiments.createdAt))
          .limit(limit)
          .offset(offset),

        ctx.db
          .select({ count: sql<number>`count(*)::int` })
          .from(strategyExperiments)
          .where(and(...conditions)),
      ]);

      const total = totalResult[0]?.count ?? 0;

      logger.info(
        { orgId: ctx.orgId, total, statusFilter },
        "Listed experiments"
      );

      return {
        experiments: rows.map((exp) => {
          const rA = (exp.resultsA ?? {}) as Record<string, unknown>;
          const rB = (exp.resultsB ?? {}) as Record<string, unknown>;
          const trialsA = (rA.trials as number) ?? 0;
          const trialsB = (rB.trials as number) ?? 0;
          const currentTrials = trialsA + trialsB;
          const targetTrials = (rA.targetTrials as number) ?? 100;

          return {
            id: exp.id,
            name: exp.experimentName,
            description: (rA.description as string) ?? null,
            status: exp.status,
            strategyA: exp.strategyA,
            strategyB: exp.strategyB,
            targetTrials,
            currentTrials,
            progress: Math.min(1, currentTrials / targetTrials),
            createdBy: (rA.createdBy as string) ?? null,
            createdAt: exp.createdAt.toISOString(),
            completedAt: null,
          };
        }),
        total,
        limit,
        offset,
      };
    }),

  /**
   * Get detailed experiment information including trial results.
   */
  get: protectedProcedure
    .input(
      z.object({
        experimentId: z.string().min(1, "Experiment ID is required"),
      })
    )
    .query(async ({ input, ctx }) => {
      const [experiment] = await ctx.db
        .select()
        .from(strategyExperiments)
        .where(
          and(
            eq(strategyExperiments.id, input.experimentId),
            eq(strategyExperiments.orgId, ctx.orgId)
          )
        )
        .limit(1);

      if (!experiment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Experiment not found",
        });
      }

      const rA = (experiment.resultsA ?? {}) as Record<string, unknown>;
      const rB = (experiment.resultsB ?? {}) as Record<string, unknown>;
      const targetTrials = (rA.targetTrials as number) ?? 100;

      const results = computeResults(
        rA,
        rB,
        experiment.strategyA,
        experiment.strategyB,
        targetTrials
      );

      return {
        id: experiment.id,
        name: experiment.experimentName,
        description: (rA.description as string) ?? null,
        status: experiment.status,
        strategyA: experiment.strategyA,
        strategyB: experiment.strategyB,
        targetTrials,
        createdBy: (rA.createdBy as string) ?? null,
        createdAt: experiment.createdAt.toISOString(),
        updatedAt: experiment.updatedAt.toISOString(),
        completedAt: null,
        results,
      };
    }),

  /**
   * Record a single trial result for an experiment.
   *
   * The experiment must be in "running" status. When the target number of
   * trials is reached the experiment transitions to "completed" automatically.
   */
  recordTrial: protectedProcedure
    .input(
      z.object({
        experimentId: z.string().min(1, "Experiment ID is required"),
        variant: z.enum(["A", "B"]),
        success: z.boolean(),
        durationMs: z.number().int().min(0),
        metadata: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const [experiment] = await ctx.db
        .select()
        .from(strategyExperiments)
        .where(
          and(
            eq(strategyExperiments.id, input.experimentId),
            eq(strategyExperiments.orgId, ctx.orgId)
          )
        )
        .limit(1);

      if (!experiment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Experiment not found",
        });
      }

      if (experiment.status !== "running") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot record trials for an experiment in "${experiment.status}" status`,
        });
      }

      const trialId = generateId("trial");

      // Update the appropriate variant's results
      const isA = input.variant === "A";
      const currentResults = (
        isA ? experiment.resultsA : experiment.resultsB
      ) as Record<string, unknown>;

      const prevTrials = (currentResults.trials as number) ?? 0;
      const prevSuccesses = (currentResults.successes as number) ?? 0;
      const prevAvgDuration = (currentResults.avgDurationMs as number) ?? 0;

      const newTrials = prevTrials + 1;
      const newSuccesses = prevSuccesses + (input.success ? 1 : 0);
      const newAvgDuration =
        (prevAvgDuration * prevTrials + input.durationMs) / newTrials;

      const updatedResults = {
        ...currentResults,
        trials: newTrials,
        successes: newSuccesses,
        successRate: newTrials > 0 ? newSuccesses / newTrials : 0,
        avgDurationMs: Math.round(newAvgDuration),
      };

      // Check if target is reached
      const otherResults = (
        isA ? experiment.resultsB : experiment.resultsA
      ) as Record<string, unknown>;
      const otherTrials = (otherResults.trials as number) ?? 0;
      const totalTrials = newTrials + otherTrials;
      const targetTrials = (currentResults.targetTrials as number) ?? 100;
      const reachedTarget = totalTrials >= targetTrials;

      const updateData = isA
        ? { resultsA: updatedResults }
        : { resultsB: updatedResults };

      if (reachedTarget) {
        await ctx.db
          .update(strategyExperiments)
          .set({ ...updateData, status: "completed" as const })
          .where(eq(strategyExperiments.id, input.experimentId));

        logger.info(
          { orgId: ctx.orgId, experimentId: input.experimentId },
          "Experiment completed -- target trials reached"
        );
      } else {
        await ctx.db
          .update(strategyExperiments)
          .set(updateData)
          .where(eq(strategyExperiments.id, input.experimentId));
      }

      logger.info(
        {
          orgId: ctx.orgId,
          experimentId: input.experimentId,
          trialId,
          variant: input.variant,
          success: input.success,
          totalTrials,
        },
        "Trial recorded"
      );

      return {
        trialId,
        experimentStatus: reachedTarget ? "completed" : experiment.status,
        totalTrials,
        targetTrials,
      };
    }),

  /**
   * Pause a running experiment.
   *
   * No new trials can be recorded while paused.
   */
  pause: protectedProcedure
    .input(
      z.object({
        experimentId: z.string().min(1, "Experiment ID is required"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const [experiment] = await ctx.db
        .select()
        .from(strategyExperiments)
        .where(
          and(
            eq(strategyExperiments.id, input.experimentId),
            eq(strategyExperiments.orgId, ctx.orgId)
          )
        )
        .limit(1);

      if (!experiment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Experiment not found",
        });
      }

      if (experiment.status !== "running") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot pause an experiment in "${experiment.status}" status`,
        });
      }

      await ctx.db
        .update(strategyExperiments)
        .set({ status: "cancelled" as const })
        .where(eq(strategyExperiments.id, input.experimentId));

      logger.info(
        { orgId: ctx.orgId, experimentId: input.experimentId },
        "Experiment paused"
      );

      return { success: true, status: "paused" as const };
    }),

  /**
   * Resume a paused or draft experiment.
   *
   * Transitions the experiment to "running" so trials can be recorded.
   */
  resume: protectedProcedure
    .input(
      z.object({
        experimentId: z.string().min(1, "Experiment ID is required"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const [experiment] = await ctx.db
        .select()
        .from(strategyExperiments)
        .where(
          and(
            eq(strategyExperiments.id, input.experimentId),
            eq(strategyExperiments.orgId, ctx.orgId)
          )
        )
        .limit(1);

      if (!experiment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Experiment not found",
        });
      }

      if (
        experiment.status !== "cancelled" &&
        experiment.status !== "running"
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot resume an experiment in "${experiment.status}" status`,
        });
      }

      await ctx.db
        .update(strategyExperiments)
        .set({ status: "running" as const })
        .where(eq(strategyExperiments.id, input.experimentId));

      logger.info(
        { orgId: ctx.orgId, experimentId: input.experimentId },
        "Experiment resumed"
      );

      return { success: true, status: "running" as const };
    }),
});
