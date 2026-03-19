import { createLogger } from "@prometheus/logger";

const _logger = createLogger("model-router:scorer");

export interface ModelScore {
  avgLatencyMs: number;
  costPerRequest: number;
  failCount: number;
  lastUpdated: number;
  modelKey: string;
  qualityScore: number;
  slotName: string;
  successCount: number;
  totalRequests: number;
}

/**
 * ModelScorer tracks per-model, per-slot performance metrics using
 * a sliding window. After sufficient data, it provides quality-based
 * model rankings that the adaptive router uses.
 */
export class ModelScorer {
  private readonly scores = new Map<string, ModelScore>();
  private readonly windowSize: number;

  constructor(windowSize = 100) {
    this.windowSize = windowSize;
  }

  /**
   * Record a model request outcome.
   */
  recordOutcome(params: {
    modelKey: string;
    slotName: string;
    success: boolean;
    latencyMs: number;
    costUsd: number;
    qualitySignal?: number; // 0-1, from evaluator feedback
  }): void {
    const key = `${params.slotName}:${params.modelKey}`;
    const existing = this.scores.get(key) ?? {
      modelKey: params.modelKey,
      slotName: params.slotName,
      successCount: 0,
      failCount: 0,
      totalRequests: 0,
      qualityScore: 0.5,
      avgLatencyMs: 0,
      costPerRequest: 0,
      lastUpdated: Date.now(),
    };

    existing.totalRequests++;
    if (params.success) {
      existing.successCount++;
    } else {
      existing.failCount++;
    }

    // Exponential moving average for latency and cost
    const alpha = 2 / (Math.min(existing.totalRequests, this.windowSize) + 1);
    existing.avgLatencyMs =
      alpha * params.latencyMs + (1 - alpha) * existing.avgLatencyMs;
    existing.costPerRequest =
      alpha * params.costUsd + (1 - alpha) * existing.costPerRequest;

    // Quality score: blend of success rate and evaluator feedback
    if (params.qualitySignal === undefined) {
      const successRate =
        existing.successCount / Math.max(existing.totalRequests, 1);
      existing.qualityScore =
        alpha * successRate + (1 - alpha) * existing.qualityScore;
    } else {
      existing.qualityScore =
        alpha * params.qualitySignal + (1 - alpha) * existing.qualityScore;
    }

    existing.lastUpdated = Date.now();
    this.scores.set(key, existing);
  }

  /**
   * Get ranked models for a slot, ordered by composite score.
   * Returns empty array if insufficient data.
   */
  getRankedModels(
    slotName: string,
    costSensitivity = 0.3
  ): Array<{ modelKey: string; compositeScore: number }> {
    const slotScores: ModelScore[] = [];
    for (const [key, score] of this.scores) {
      if (key.startsWith(`${slotName}:`) && score.totalRequests >= 5) {
        slotScores.push(score);
      }
    }

    if (slotScores.length === 0) {
      return [];
    }

    // Normalize scores for ranking
    const maxLatency = Math.max(...slotScores.map((s) => s.avgLatencyMs), 1);
    const maxCost = Math.max(...slotScores.map((s) => s.costPerRequest), 0.001);

    const qualityWeight = 1 - costSensitivity;

    return slotScores
      .map((s) => {
        const qualityComponent = s.qualityScore * qualityWeight;
        const costComponent =
          (1 - s.costPerRequest / maxCost) * costSensitivity * 0.5;
        const latencyComponent =
          (1 - s.avgLatencyMs / maxLatency) * costSensitivity * 0.5;

        return {
          modelKey: s.modelKey,
          compositeScore: qualityComponent + costComponent + latencyComponent,
        };
      })
      .sort((a, b) => b.compositeScore - a.compositeScore);
  }

  /**
   * Check if a model's success rate has dropped below threshold.
   */
  isModelDegraded(
    slotName: string,
    modelKey: string,
    threshold = 0.7
  ): boolean {
    const key = `${slotName}:${modelKey}`;
    const score = this.scores.get(key);
    if (!score || score.totalRequests < 10) {
      return false;
    }
    return score.qualityScore < threshold;
  }

  /** Get stats for monitoring */
  getStats(): Map<string, ModelScore> {
    return new Map(this.scores);
  }
}
