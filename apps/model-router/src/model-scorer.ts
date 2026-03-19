import { createLogger } from "@prometheus/logger";

const logger = createLogger("model-router:scorer");

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

/** Per-task-type quality tracking entry */
interface TaskTypeQuality {
  avgScore: number;
  lastUpdated: number;
  sampleCount: number;
}

/** Decay factor applied to stale quality data (per hour) */
const QUALITY_DECAY_RATE = 0.98;
const DECAY_INTERVAL_MS = 3_600_000; // 1 hour

/**
 * ModelScorer tracks per-model, per-slot performance metrics using
 * a sliding window. After sufficient data, it provides quality-based
 * model rankings that the adaptive router uses.
 *
 * Also tracks per-task-type quality signals with time-based decay
 * so that stale data gradually loses influence.
 */
export class ModelScorer {
  private readonly scores = new Map<string, ModelScore>();
  private readonly taskTypeQuality = new Map<string, TaskTypeQuality>();
  private readonly windowSize: number;

  constructor(windowSize = 100) {
    this.windowSize = windowSize;
  }

  /**
   * Record a model request outcome with actual latency and optional quality signal.
   */
  recordOutcome(params: {
    modelKey: string;
    slotName: string;
    success: boolean;
    latencyMs: number;
    costUsd: number;
    qualitySignal?: number;
    taskType?: string;
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

    const alpha = 2 / (Math.min(existing.totalRequests, this.windowSize) + 1);
    existing.avgLatencyMs =
      alpha * params.latencyMs + (1 - alpha) * existing.avgLatencyMs;
    existing.costPerRequest =
      alpha * params.costUsd + (1 - alpha) * existing.costPerRequest;

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

    // Track per-task-type quality with decay
    if (params.taskType && params.qualitySignal !== undefined) {
      this.recordTaskTypeQuality(
        params.taskType,
        params.modelKey,
        params.qualitySignal
      );
    }

    logger.debug(
      {
        modelKey: params.modelKey,
        slot: params.slotName,
        quality: existing.qualityScore.toFixed(3),
        latency: existing.avgLatencyMs.toFixed(0),
      },
      "Outcome recorded"
    );
  }

  /**
   * Track quality scores per task type with time-based decay.
   */
  private recordTaskTypeQuality(
    taskType: string,
    modelKey: string,
    qualitySignal: number
  ): void {
    const key = `${taskType}:${modelKey}`;
    const existing = this.taskTypeQuality.get(key);
    const now = Date.now();

    if (!existing) {
      this.taskTypeQuality.set(key, {
        avgScore: qualitySignal,
        sampleCount: 1,
        lastUpdated: now,
      });
      return;
    }

    // Apply time-based decay to existing score
    const hoursElapsed = (now - existing.lastUpdated) / DECAY_INTERVAL_MS;
    const decayFactor = QUALITY_DECAY_RATE ** hoursElapsed;
    const decayedScore = existing.avgScore * decayFactor;

    const newAlpha = 1 / (Math.min(existing.sampleCount + 1, 50) + 1);
    existing.avgScore =
      newAlpha * qualitySignal + (1 - newAlpha) * decayedScore;
    existing.sampleCount++;
    existing.lastUpdated = now;
  }

  /**
   * Get quality score for a specific task type + model combination.
   * Returns undefined if no data exists.
   */
  getTaskTypeQuality(taskType: string, modelKey: string): number | undefined {
    const key = `${taskType}:${modelKey}`;
    const entry = this.taskTypeQuality.get(key);
    if (!entry || entry.sampleCount < 3) {
      return undefined;
    }

    // Apply decay before returning
    const hoursElapsed = (Date.now() - entry.lastUpdated) / DECAY_INTERVAL_MS;
    return entry.avgScore * QUALITY_DECAY_RATE ** hoursElapsed;
  }

  /**
   * Get ranked models for a slot, ordered by composite score.
   * Optionally factor in task-type-specific quality data.
   */
  getRankedModels(
    slotName: string,
    costSensitivity = 0.3,
    taskType?: string
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

    const maxLatency = Math.max(...slotScores.map((s) => s.avgLatencyMs), 1);
    const maxCost = Math.max(...slotScores.map((s) => s.costPerRequest), 0.001);
    const qualityWeight = 1 - costSensitivity;

    return slotScores
      .map((s) => {
        let effectiveQuality = s.qualityScore;

        // Blend in task-type-specific quality if available
        if (taskType) {
          const taskQuality = this.getTaskTypeQuality(taskType, s.modelKey);
          if (taskQuality !== undefined) {
            effectiveQuality = effectiveQuality * 0.6 + taskQuality * 0.4;
          }
        }

        const qualityComponent = effectiveQuality * qualityWeight;
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

  /** Get task type quality stats for monitoring */
  getTaskTypeStats(): Map<string, TaskTypeQuality> {
    return new Map(this.taskTypeQuality);
  }
}
