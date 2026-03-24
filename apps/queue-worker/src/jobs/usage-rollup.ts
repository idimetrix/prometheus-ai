import {
  creditTransactions,
  db,
  modelUsage,
  usageRollups,
} from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import type { UsageRollupData } from "@prometheus/queue";
import { generateId } from "@prometheus/utils";
import { and, eq, gte, lte, sql } from "drizzle-orm";

const logger = createLogger("queue-worker:usage-rollup");

export async function processUsageRollup(
  data: UsageRollupData
): Promise<{ rollupId: string; metrics: UsageRollupData["metrics"] }> {
  const { orgId, periodStart, periodEnd, metrics: providedMetrics } = data;

  // Calculate period bounds if not provided (scheduled jobs pass empty strings)
  let effectiveStart: Date;
  let effectiveEnd: Date;
  if (periodStart && periodEnd) {
    effectiveStart = new Date(periodStart);
    effectiveEnd = new Date(periodEnd);
  } else {
    // Default to the previous hour
    effectiveEnd = new Date();
    effectiveEnd.setMinutes(0, 0, 0);
    effectiveStart = new Date(effectiveEnd);
    effectiveStart.setHours(effectiveStart.getHours() - 1);
  }

  logger.info(
    {
      orgId,
      periodStart: effectiveStart.toISOString(),
      periodEnd: effectiveEnd.toISOString(),
    },
    "Processing usage rollup"
  );

  // If metrics are pre-computed (from a scheduler), use them directly
  // Otherwise, aggregate from the database
  let finalMetrics = providedMetrics;

  if (
    !finalMetrics ||
    (finalMetrics.tasksCompleted === 0 &&
      finalMetrics.creditsUsed === 0 &&
      finalMetrics.tokensIn === 0)
  ) {
    // Aggregate from model_usage and credit_transactions tables
    const start = effectiveStart;
    const end = effectiveEnd;

    const [usageAgg, creditAgg] = await Promise.all([
      db
        .select({
          totalTokensIn: sql<number>`COALESCE(SUM(${modelUsage.tokensIn}), 0)`,
          totalTokensOut: sql<number>`COALESCE(SUM(${modelUsage.tokensOut}), 0)`,
          totalCostUsd: sql<number>`COALESCE(SUM(${modelUsage.costUsd}), 0)`,
          taskCount: sql<number>`COUNT(DISTINCT ${modelUsage.taskId})`,
        })
        .from(modelUsage)
        .where(
          and(
            eq(modelUsage.orgId, orgId),
            gte(modelUsage.createdAt, start),
            lte(modelUsage.createdAt, end)
          )
        ),
      db
        .select({
          totalCreditsUsed: sql<number>`COALESCE(SUM(ABS(${creditTransactions.amount})), 0)`,
        })
        .from(creditTransactions)
        .where(
          and(
            eq(creditTransactions.orgId, orgId),
            eq(creditTransactions.type, "consumption"),
            gte(creditTransactions.createdAt, start),
            lte(creditTransactions.createdAt, end)
          )
        ),
    ]);

    finalMetrics = {
      tasksCompleted: Number(usageAgg[0]?.taskCount ?? 0),
      creditsUsed: Number(creditAgg[0]?.totalCreditsUsed ?? 0),
      costUsd: Number(usageAgg[0]?.totalCostUsd ?? 0),
      tokensIn: Number(usageAgg[0]?.totalTokensIn ?? 0),
      tokensOut: Number(usageAgg[0]?.totalTokensOut ?? 0),
    };
  }

  // Upsert the rollup record
  const rollupId = generateId("roll");

  // Check for existing rollup in this period
  const existing = await db
    .select()
    .from(usageRollups)
    .where(
      and(
        eq(usageRollups.orgId, orgId),
        eq(usageRollups.periodStart, effectiveStart)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(usageRollups)
      .set({
        tasksCompleted: finalMetrics.tasksCompleted,
        creditsUsed: finalMetrics.creditsUsed,
        costUsd: finalMetrics.costUsd,
      })
      .where(eq(usageRollups.id, (existing[0] as (typeof existing)[0]).id));

    const rollupId = (existing[0] as (typeof existing)[0]).id;
    logger.info({ orgId, rollupId }, "Usage rollup updated");
    return { rollupId, metrics: finalMetrics };
  }

  await db.insert(usageRollups).values({
    id: rollupId,
    orgId,
    periodStart: effectiveStart,
    periodEnd: effectiveEnd,
    tasksCompleted: finalMetrics.tasksCompleted,
    creditsUsed: finalMetrics.creditsUsed,
    costUsd: finalMetrics.costUsd,
  });

  logger.info(
    { orgId, rollupId, metrics: finalMetrics },
    "Usage rollup created"
  );
  return { rollupId, metrics: finalMetrics };
}
