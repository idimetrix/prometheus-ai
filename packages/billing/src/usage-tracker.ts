import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { db } from "@prometheus/db";
import { modelUsage, usageRollups, creditTransactions } from "@prometheus/db";
import { eq, and, gte, lte, sql, desc } from "drizzle-orm";

const logger = createLogger("billing:usage");

export interface UsageRecord {
  orgId: string;
  sessionId: string;
  taskId: string;
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

export class UsageTracker {
  async recordUsage(record: UsageRecord): Promise<void> {
    await db.insert(modelUsage).values({
      id: generateId("mu"),
      orgId: record.orgId,
      sessionId: record.sessionId,
      taskId: record.taskId,
      provider: record.provider,
      model: record.model,
      tokensIn: record.tokensIn,
      tokensOut: record.tokensOut,
      costUsd: record.costUsd,
    });

    logger.debug({
      orgId: record.orgId,
      model: record.model,
      tokens: record.tokensIn + record.tokensOut,
      cost: record.costUsd,
    }, "Usage recorded");
  }

  async getUsageSummary(orgId: string, periodStart: Date, periodEnd: Date): Promise<{
    totalTokens: number;
    totalCostUsd: number;
    taskCount: number;
    byModel: Record<string, { tokens: number; cost: number; count: number }>;
  }> {
    const [summary] = await db
      .select({
        totalTokensIn: sql<number>`COALESCE(SUM(${modelUsage.tokensIn}), 0)`,
        totalTokensOut: sql<number>`COALESCE(SUM(${modelUsage.tokensOut}), 0)`,
        totalCost: sql<number>`COALESCE(SUM(${modelUsage.costUsd}), 0)`,
        count: sql<number>`COUNT(DISTINCT ${modelUsage.taskId})`,
      })
      .from(modelUsage)
      .where(and(
        eq(modelUsage.orgId, orgId),
        gte(modelUsage.createdAt, periodStart),
        lte(modelUsage.createdAt, periodEnd),
      ));

    const byModelRows = await db
      .select({
        model: modelUsage.model,
        tokens: sql<number>`SUM(${modelUsage.tokensIn} + ${modelUsage.tokensOut})`,
        cost: sql<number>`SUM(${modelUsage.costUsd})`,
        count: sql<number>`COUNT(*)`,
      })
      .from(modelUsage)
      .where(and(
        eq(modelUsage.orgId, orgId),
        gte(modelUsage.createdAt, periodStart),
        lte(modelUsage.createdAt, periodEnd),
      ))
      .groupBy(modelUsage.model);

    const byModel: Record<string, { tokens: number; cost: number; count: number }> = {};
    for (const row of byModelRows) {
      byModel[row.model] = {
        tokens: Number(row.tokens),
        cost: Number(row.cost),
        count: Number(row.count),
      };
    }

    return {
      totalTokens: Number(summary?.totalTokensIn ?? 0) + Number(summary?.totalTokensOut ?? 0),
      totalCostUsd: Number(summary?.totalCost ?? 0),
      taskCount: Number(summary?.count ?? 0),
      byModel,
    };
  }

  async calculateMargin(orgId: string, periodStart: Date, periodEnd: Date): Promise<{
    creditRevenue: number;
    actualCost: number;
    margin: number;
    marginPercent: number;
  }> {
    const [creditData] = await db
      .select({
        consumed: sql<number>`COALESCE(SUM(ABS(${creditTransactions.amount})), 0)`,
      })
      .from(creditTransactions)
      .where(and(
        eq(creditTransactions.orgId, orgId),
        eq(creditTransactions.type, "consumption"),
        gte(creditTransactions.createdAt, periodStart),
        lte(creditTransactions.createdAt, periodEnd),
      ));

    const usage = await this.getUsageSummary(orgId, periodStart, periodEnd);

    // Each credit ≈ $0.10 in revenue
    const creditRevenue = Number(creditData?.consumed ?? 0) * 0.10;
    const actualCost = usage.totalCostUsd;
    const margin = creditRevenue - actualCost;

    return {
      creditRevenue: Math.round(creditRevenue * 100) / 100,
      actualCost: Math.round(actualCost * 100) / 100,
      margin: Math.round(margin * 100) / 100,
      marginPercent: creditRevenue > 0 ? Math.round((margin / creditRevenue) * 100) : 0,
    };
  }

  async createDailyRollup(orgId: string, date: Date): Promise<void> {
    const periodStart = new Date(date);
    periodStart.setHours(0, 0, 0, 0);
    const periodEnd = new Date(date);
    periodEnd.setHours(23, 59, 59, 999);

    const usage = await this.getUsageSummary(orgId, periodStart, periodEnd);

    await db.insert(usageRollups).values({
      id: generateId("ur"),
      orgId,
      periodStart,
      periodEnd,
      tasksCompleted: usage.taskCount,
      creditsUsed: 0,
      costUsd: usage.totalCostUsd,
    });

    logger.info({ orgId, date: date.toISOString() }, "Daily usage rollup created");
  }
}
