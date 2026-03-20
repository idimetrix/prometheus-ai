import {
  creditBalances,
  creditTransactions,
  db,
  modelUsage,
  modelUsageLogs,
  organizations,
  usageRollups,
} from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { and, eq, gte, lt, sql } from "drizzle-orm";

const logger = createLogger("queue-worker:usage-aggregation");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RollupGranularity = "hourly" | "daily" | "monthly";

export interface AggregatedUsage {
  apiCalls: number;
  costUsd: number;
  creditsUsed: number;
  orgId: string;
  periodEnd: Date;
  periodStart: Date;
  sandboxMinutes: number;
  storageBytes: number;
  tokensIn: number;
  tokensOut: number;
}

export interface MeteringReport {
  granularity: RollupGranularity;
  orgReports: AggregatedUsage[];
  reportedToStripe: number;
  totalOrgs: number;
}

// ---------------------------------------------------------------------------
// Period helpers
// ---------------------------------------------------------------------------

function getPeriodBounds(
  granularity: RollupGranularity,
  referenceDate?: Date
): { start: Date; end: Date } {
  const now = referenceDate ?? new Date();

  if (granularity === "hourly") {
    const start = new Date(now);
    start.setMinutes(0, 0, 0);
    start.setHours(start.getHours() - 1);
    const end = new Date(start);
    end.setHours(end.getHours() + 1);
    return { start, end };
  }

  if (granularity === "daily") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - 1);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end };
  }

  // monthly
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 1);
  return { start, end };
}

// ---------------------------------------------------------------------------
// Aggregation logic
// ---------------------------------------------------------------------------

async function aggregateOrgUsage(
  orgId: string,
  start: Date,
  end: Date
): Promise<AggregatedUsage> {
  // Aggregate from model_usage_logs table (primary source)
  const [modelAgg] = await db
    .select({
      tokensIn: sql<number>`COALESCE(SUM(${modelUsageLogs.promptTokens}), 0)`,
      tokensOut: sql<number>`COALESCE(SUM(${modelUsageLogs.completionTokens}), 0)`,
      costUsd: sql<number>`COALESCE(SUM(${modelUsageLogs.costUsd}), 0)`,
      apiCalls: sql<number>`COUNT(*)`,
    })
    .from(modelUsageLogs)
    .where(
      and(
        eq(modelUsageLogs.orgId, orgId),
        gte(modelUsageLogs.createdAt, start),
        lt(modelUsageLogs.createdAt, end)
      )
    );

  // Also aggregate from model_usage table (legacy/alternate source)
  const [legacyAgg] = await db
    .select({
      tokensIn: sql<number>`COALESCE(SUM(${modelUsage.tokensIn}), 0)`,
      tokensOut: sql<number>`COALESCE(SUM(${modelUsage.tokensOut}), 0)`,
      costUsd: sql<number>`COALESCE(SUM(${modelUsage.costUsd}), 0)`,
    })
    .from(modelUsage)
    .where(
      and(
        eq(modelUsage.orgId, orgId),
        gte(modelUsage.createdAt, start),
        lt(modelUsage.createdAt, end)
      )
    );

  // Aggregate credits consumed
  const [creditAgg] = await db
    .select({
      creditsUsed: sql<number>`COALESCE(SUM(ABS(${creditTransactions.amount})), 0)`,
    })
    .from(creditTransactions)
    .where(
      and(
        eq(creditTransactions.orgId, orgId),
        eq(creditTransactions.type, "consumption"),
        gte(creditTransactions.createdAt, start),
        lt(creditTransactions.createdAt, end)
      )
    );

  return {
    orgId,
    periodStart: start,
    periodEnd: end,
    tokensIn:
      Number(modelAgg?.tokensIn ?? 0) + Number(legacyAgg?.tokensIn ?? 0),
    tokensOut:
      Number(modelAgg?.tokensOut ?? 0) + Number(legacyAgg?.tokensOut ?? 0),
    costUsd: Number(modelAgg?.costUsd ?? 0) + Number(legacyAgg?.costUsd ?? 0),
    apiCalls: Number(modelAgg?.apiCalls ?? 0),
    creditsUsed: Number(creditAgg?.creditsUsed ?? 0),
    sandboxMinutes: 0, // Placeholder: sandbox time tracking not yet instrumented
    storageBytes: 0, // Placeholder: storage metering not yet instrumented
  };
}

// ---------------------------------------------------------------------------
// Stripe metered billing (stub)
// ---------------------------------------------------------------------------

/**
 * Report usage to Stripe for metered billing.
 * This is a stub that logs the usage report. In production, this would call
 * stripe.subscriptionItems.createUsageRecord().
 */
function reportUsageToStripe(_orgId: string, usage: AggregatedUsage): boolean {
  // TODO: Implement actual Stripe metered billing API call:
  // const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  // await stripe.subscriptionItems.createUsageRecord(subscriptionItemId, {
  //   quantity: usage.creditsUsed,
  //   timestamp: Math.floor(usage.periodEnd.getTime() / 1000),
  //   action: 'set',
  // });

  logger.info(
    {
      orgId: _orgId,
      creditsUsed: usage.creditsUsed,
      tokensIn: usage.tokensIn,
      tokensOut: usage.tokensOut,
      apiCalls: usage.apiCalls,
      costUsd: usage.costUsd,
      periodStart: usage.periodStart.toISOString(),
      periodEnd: usage.periodEnd.toISOString(),
    },
    "Usage reported to Stripe (stub)"
  );

  return true;
}

// ---------------------------------------------------------------------------
// Persist rollup
// ---------------------------------------------------------------------------

async function persistRollup(usage: AggregatedUsage): Promise<string> {
  // Check for existing rollup in this period
  const existing = await db
    .select()
    .from(usageRollups)
    .where(
      and(
        eq(usageRollups.orgId, usage.orgId),
        eq(usageRollups.periodStart, usage.periodStart)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    const existingRow = existing[0] as (typeof existing)[0];
    await db
      .update(usageRollups)
      .set({
        tasksCompleted: usage.apiCalls,
        creditsUsed: usage.creditsUsed,
        costUsd: usage.costUsd,
      })
      .where(eq(usageRollups.id, existingRow.id));
    return existingRow.id;
  }

  const rollupId = generateId("roll");
  await db.insert(usageRollups).values({
    id: rollupId,
    orgId: usage.orgId,
    periodStart: usage.periodStart,
    periodEnd: usage.periodEnd,
    tasksCompleted: usage.apiCalls,
    creditsUsed: usage.creditsUsed,
    costUsd: usage.costUsd,
  });

  return rollupId;
}

// ---------------------------------------------------------------------------
// Main entrypoints
// ---------------------------------------------------------------------------

/**
 * Run usage aggregation for all orgs at the specified granularity.
 * Called by a scheduled job (e.g., hourly cron via queue or Inngest).
 */
export async function runUsageAggregation(
  granularity: RollupGranularity,
  referenceDate?: Date
): Promise<MeteringReport> {
  const { start, end } = getPeriodBounds(granularity, referenceDate);

  logger.info(
    {
      granularity,
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
    },
    "Starting usage aggregation"
  );

  // Get all orgs with a credit balance (active orgs)
  const allBalances = await db.select().from(creditBalances);
  const orgIds = allBalances.map((b) => b.orgId);

  const orgReports: AggregatedUsage[] = [];
  let reportedToStripe = 0;

  for (const orgId of orgIds) {
    try {
      const usage = await aggregateOrgUsage(orgId, start, end);

      // Skip orgs with zero usage
      if (
        usage.tokensIn === 0 &&
        usage.tokensOut === 0 &&
        usage.creditsUsed === 0 &&
        usage.apiCalls === 0
      ) {
        continue;
      }

      // Persist the rollup
      await persistRollup(usage);

      // Report to Stripe for metered billing (daily/monthly only)
      if (granularity !== "hourly") {
        const org = await db.query.organizations.findFirst({
          where: eq(organizations.id, orgId),
          columns: { stripeCustomerId: true, planTier: true },
        });

        if (org?.stripeCustomerId) {
          const reported = reportUsageToStripe(orgId, usage);
          if (reported) {
            reportedToStripe++;
          }
        }
      }

      orgReports.push(usage);
    } catch (error) {
      logger.error(
        { orgId, error: String(error) },
        "Failed to aggregate usage for org"
      );
    }
  }

  logger.info(
    {
      granularity,
      totalOrgs: orgIds.length,
      orgsWithUsage: orgReports.length,
      reportedToStripe,
    },
    "Usage aggregation complete"
  );

  return {
    granularity,
    totalOrgs: orgIds.length,
    orgReports,
    reportedToStripe,
  };
}

/**
 * Run a single-org usage aggregation. Useful for on-demand reports.
 */
export function aggregateOrgUsageForPeriod(
  orgId: string,
  granularity: RollupGranularity,
  referenceDate?: Date
): Promise<AggregatedUsage> {
  const { start, end } = getPeriodBounds(granularity, referenceDate);
  return aggregateOrgUsage(orgId, start, end);
}
