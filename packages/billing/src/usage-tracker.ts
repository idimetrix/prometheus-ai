import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";

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
    // TODO: Insert into model_usage table
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
    // TODO: Query usage_rollups or model_usage table
    return {
      totalTokens: 0,
      totalCostUsd: 0,
      taskCount: 0,
      byModel: {},
    };
  }

  async calculateMargin(orgId: string, periodStart: Date, periodEnd: Date): Promise<{
    creditRevenue: number;
    actualCost: number;
    margin: number;
    marginPercent: number;
  }> {
    // TODO: Compare credit revenue vs actual LLM costs
    return { creditRevenue: 0, actualCost: 0, margin: 0, marginPercent: 0 };
  }
}
