/**
 * GAP-098: Model Quality Scorer
 *
 * Scores model outputs on correctness, style, and completeness.
 * Maintains per-model quality rankings by task type and feeds
 * scores into routing decisions.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("model-router:model-quality-scorer");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface QualityDimensions {
  completeness: number;
  correctness: number;
  style: number;
}

export interface ModelQualityEntry {
  compositeScore: number;
  dimensions: QualityDimensions;
  lastUpdated: number;
  modelKey: string;
  sampleCount: number;
  taskType: string;
}

export interface ModelRanking {
  compositeScore: number;
  dimensions: QualityDimensions;
  modelKey: string;
  sampleCount: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DIMENSION_WEIGHTS = {
  correctness: 0.5,
  style: 0.2,
  completeness: 0.3,
};

const CODE_BLOCK_RE = /```[\s\S]*?```/g;
const HEADING_RE = /^#{1,6}\s/m;
const LIST_RE = /^[-*]\s/m;
const ERROR_PATTERNS =
  /\b(error|undefined|null reference|syntax error|type error)\b/i;
const INCOMPLETE_PATTERNS = /\b(TODO|FIXME|not implemented|placeholder)\b/i;

// ─── Model Quality Scorer ─────────────────────────────────────────────────────

export class ModelQualityScorer {
  private readonly entries = new Map<string, ModelQualityEntry>();
  private readonly windowSize: number;

  constructor(windowSize = 100) {
    this.windowSize = windowSize;
  }

  /**
   * Score a model's output and record the quality dimensions.
   */
  scoreOutput(params: {
    modelKey: string;
    taskType: string;
    output: string;
    expectedPatterns?: string[];
    userFeedback?: number;
  }): QualityDimensions {
    const dimensions = this.evaluateOutput(
      params.output,
      params.expectedPatterns,
      params.userFeedback
    );

    this.recordScore(params.modelKey, params.taskType, dimensions);

    logger.debug(
      {
        modelKey: params.modelKey,
        taskType: params.taskType,
        correctness: dimensions.correctness.toFixed(3),
        style: dimensions.style.toFixed(3),
        completeness: dimensions.completeness.toFixed(3),
      },
      "Model output scored"
    );

    return dimensions;
  }

  /**
   * Get quality rankings for a specific task type.
   */
  getRankings(taskType: string): ModelRanking[] {
    const rankings: ModelRanking[] = [];

    for (const entry of this.entries.values()) {
      if (entry.taskType === taskType && entry.sampleCount >= 3) {
        rankings.push({
          modelKey: entry.modelKey,
          compositeScore: entry.compositeScore,
          dimensions: { ...entry.dimensions },
          sampleCount: entry.sampleCount,
        });
      }
    }

    return rankings.sort((a, b) => b.compositeScore - a.compositeScore);
  }

  /**
   * Get the best model for a task type.
   */
  getBestModel(taskType: string): string | undefined {
    const rankings = this.getRankings(taskType);
    return rankings[0]?.modelKey;
  }

  /**
   * Get quality score for a specific model and task type.
   */
  getScore(modelKey: string, taskType: string): ModelQualityEntry | undefined {
    return this.entries.get(`${modelKey}:${taskType}`);
  }

  /**
   * Get all entries for monitoring.
   */
  getAllEntries(): ModelQualityEntry[] {
    return [...this.entries.values()];
  }

  // ─── Private ────────────────────────────────────────────────────────────

  private evaluateOutput(
    output: string,
    expectedPatterns?: string[],
    userFeedback?: number
  ): QualityDimensions {
    // Correctness: Check for error patterns and expected content
    let correctness = 0.6; // Base score
    if (ERROR_PATTERNS.test(output)) {
      correctness -= 0.2;
    }
    if (expectedPatterns) {
      let matched = 0;
      for (const pattern of expectedPatterns) {
        if (output.includes(pattern)) {
          matched++;
        }
      }
      correctness += 0.3 * (matched / Math.max(1, expectedPatterns.length));
    }
    if (userFeedback !== undefined) {
      correctness = correctness * 0.5 + userFeedback * 0.5;
    }

    // Style: Check formatting, structure
    let style = 0.5;
    const codeBlocks = output.match(CODE_BLOCK_RE);
    if (codeBlocks && codeBlocks.length > 0) {
      style += 0.15;
    }
    if (HEADING_RE.test(output)) {
      style += 0.1;
    }
    if (LIST_RE.test(output)) {
      style += 0.1;
    }
    if (output.length > 100 && output.length < 10_000) {
      style += 0.1;
    }

    // Completeness: Check for incompleteness signals
    let completeness = 0.7;
    if (INCOMPLETE_PATTERNS.test(output)) {
      completeness -= 0.3;
    }
    if (output.length < 50) {
      completeness -= 0.2;
    }
    if (output.length > 200) {
      completeness += 0.1;
    }
    if (codeBlocks && codeBlocks.length >= 2) {
      completeness += 0.1;
    }

    return {
      correctness: Math.max(0, Math.min(1, correctness)),
      style: Math.max(0, Math.min(1, style)),
      completeness: Math.max(0, Math.min(1, completeness)),
    };
  }

  private recordScore(
    modelKey: string,
    taskType: string,
    dimensions: QualityDimensions
  ): void {
    const key = `${modelKey}:${taskType}`;
    const existing = this.entries.get(key);

    const composite =
      dimensions.correctness * DIMENSION_WEIGHTS.correctness +
      dimensions.style * DIMENSION_WEIGHTS.style +
      dimensions.completeness * DIMENSION_WEIGHTS.completeness;

    if (existing) {
      const alpha =
        2 / (Math.min(existing.sampleCount + 1, this.windowSize) + 1);
      existing.dimensions.correctness =
        alpha * dimensions.correctness +
        (1 - alpha) * existing.dimensions.correctness;
      existing.dimensions.style =
        alpha * dimensions.style + (1 - alpha) * existing.dimensions.style;
      existing.dimensions.completeness =
        alpha * dimensions.completeness +
        (1 - alpha) * existing.dimensions.completeness;
      existing.compositeScore =
        alpha * composite + (1 - alpha) * existing.compositeScore;
      existing.sampleCount++;
      existing.lastUpdated = Date.now();
    } else {
      this.entries.set(key, {
        modelKey,
        taskType,
        dimensions: { ...dimensions },
        compositeScore: composite,
        sampleCount: 1,
        lastUpdated: Date.now(),
      });
    }
  }
}
