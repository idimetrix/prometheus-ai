/**
 * GAP-043: Intelligent Cost Optimization Metrics
 *
 * Tracks cost savings from intelligent routing vs always-best-model,
 * records quality-cost tradeoff measurements per task type, and
 * generates cost optimization reports.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("model-router:cost-optimizer-metrics");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CostMetricEntry {
  actualCost: number;
  alwaysBestModelCost: number;
  model: string;
  qualityScore: number;
  taskId: string;
  taskType: string;
  timestamp: number;
}

export interface TaskTypeCostProfile {
  avgActualCost: number;
  avgBestModelCost: number;
  avgQuality: number;
  sampleCount: number;
  savingsRate: number;
  taskType: string;
}

export interface CostOptimizationReport {
  byTaskType: TaskTypeCostProfile[];
  period: { from: number; to: number };
  qualityCostCorrelation: number;
  totalActualCost: number;
  totalAlwaysBestCost: number;
  totalEntries: number;
  totalSavings: number;
  totalSavingsPercent: number;
}

// ---------------------------------------------------------------------------
// CostOptimizerMetrics
// ---------------------------------------------------------------------------

/** Estimated cost per 1K tokens for the best-quality model */
const BEST_MODEL_COST_PER_1K = 0.04;

export class CostOptimizerMetrics {
  private readonly entries: CostMetricEntry[] = [];

  /**
   * Record a cost metric for a completed request.
   */
  recordEntry(entry: CostMetricEntry): void {
    this.entries.push(entry);
    if (this.entries.length > 10_000) {
      this.entries.splice(0, this.entries.length - 10_000);
    }
    logger.debug(
      {
        taskId: entry.taskId,
        taskType: entry.taskType,
        model: entry.model,
        actual: entry.actualCost.toFixed(6),
        bestModel: entry.alwaysBestModelCost.toFixed(6),
        quality: entry.qualityScore.toFixed(3),
      },
      "Cost metric recorded"
    );
  }

  /**
   * Convenience method: record cost with auto-computed best-model cost.
   */
  recordCost(
    taskId: string,
    taskType: string,
    model: string,
    actualCost: number,
    qualityScore: number,
    estimatedTokens: number
  ): void {
    this.recordEntry({
      taskId,
      taskType,
      model,
      actualCost,
      alwaysBestModelCost: estimatedTokens * BEST_MODEL_COST_PER_1K * 0.001,
      qualityScore,
      timestamp: Date.now(),
    });
  }

  /**
   * Generate a cost optimization report.
   */
  generateReport(sinceMs?: number): CostOptimizationReport {
    const cutoff = sinceMs ?? Date.now() - 30 * 24 * 60 * 60 * 1000;
    const filtered = this.entries.filter((e) => e.timestamp >= cutoff);

    if (filtered.length === 0) {
      return {
        period: { from: cutoff, to: Date.now() },
        totalEntries: 0,
        totalActualCost: 0,
        totalAlwaysBestCost: 0,
        totalSavings: 0,
        totalSavingsPercent: 0,
        qualityCostCorrelation: 0,
        byTaskType: [],
      };
    }

    const totalActual = filtered.reduce((s, e) => s + e.actualCost, 0);
    const totalBest = filtered.reduce((s, e) => s + e.alwaysBestModelCost, 0);
    const totalSavings = totalBest - totalActual;
    const totalSavingsPercent =
      totalBest > 0 ? (totalSavings / totalBest) * 100 : 0;

    // Group by task type
    const byType = new Map<
      string,
      { actual: number; best: number; quality: number; count: number }
    >();
    for (const entry of filtered) {
      const existing = byType.get(entry.taskType) ?? {
        actual: 0,
        best: 0,
        quality: 0,
        count: 0,
      };
      existing.actual += entry.actualCost;
      existing.best += entry.alwaysBestModelCost;
      existing.quality += entry.qualityScore;
      existing.count++;
      byType.set(entry.taskType, existing);
    }

    const byTaskType: TaskTypeCostProfile[] = [];
    for (const [taskType, stats] of byType) {
      const savings = stats.best - stats.actual;
      byTaskType.push({
        taskType,
        avgActualCost: stats.actual / stats.count,
        avgBestModelCost: stats.best / stats.count,
        avgQuality: stats.quality / stats.count,
        savingsRate: stats.best > 0 ? savings / stats.best : 0,
        sampleCount: stats.count,
      });
    }

    // Simple quality-cost correlation (Pearson)
    const correlation = this.computeCorrelation(filtered);

    const report: CostOptimizationReport = {
      period: { from: cutoff, to: Date.now() },
      totalEntries: filtered.length,
      totalActualCost: totalActual,
      totalAlwaysBestCost: totalBest,
      totalSavings,
      totalSavingsPercent,
      qualityCostCorrelation: correlation,
      byTaskType,
    };

    logger.info(
      {
        entries: report.totalEntries,
        savings: totalSavings.toFixed(4),
        savingsPercent: totalSavingsPercent.toFixed(1),
      },
      "Cost optimization report generated"
    );

    return report;
  }

  /**
   * Get total number of recorded entries.
   */
  getEntryCount(): number {
    return this.entries.length;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private computeCorrelation(entries: CostMetricEntry[]): number {
    if (entries.length < 2) {
      return 0;
    }

    const costs = entries.map((e) => e.actualCost);
    const qualities = entries.map((e) => e.qualityScore);

    const meanCost = costs.reduce((a, b) => a + b, 0) / costs.length;
    const meanQuality = qualities.reduce((a, b) => a + b, 0) / qualities.length;

    let numerator = 0;
    let denomCost = 0;
    let denomQuality = 0;

    for (let i = 0; i < entries.length; i++) {
      const costDiff = (costs[i] ?? 0) - meanCost;
      const qualDiff = (qualities[i] ?? 0) - meanQuality;
      numerator += costDiff * qualDiff;
      denomCost += costDiff * costDiff;
      denomQuality += qualDiff * qualDiff;
    }

    const denom = Math.sqrt(denomCost * denomQuality);
    return denom > 0 ? numerator / denom : 0;
  }
}
