/**
 * GAP-103: Cost Prediction ML Model
 *
 * Predicts task cost before execution using historical data.
 * Provides confidence intervals on predictions.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("model-router:cost-predictor");

export interface CostPrediction {
  basedOnSamples: number;
  breakdown: {
    promptTokens: number;
    completionTokens: number;
    estimatedLatencyMs: number;
  };
  confidence: number;
  confidenceHigh: number;
  confidenceLow: number;
  estimatedCostUsd: number;
}

interface HistoricalEntry {
  completionTokens: number;
  costUsd: number;
  latencyMs: number;
  model: string;
  promptTokens: number;
  taskType: string;
}

export class CostPredictor {
  private readonly history: HistoricalEntry[] = [];
  private readonly maxHistory: number;

  constructor(maxHistory = 10_000) {
    this.maxHistory = maxHistory;
  }

  recordOutcome(entry: HistoricalEntry): void {
    this.history.push(entry);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
  }

  predict(
    taskType: string,
    model: string,
    estimatedPromptTokens: number
  ): CostPrediction {
    const relevant = this.history.filter(
      (h) => h.taskType === taskType && h.model === model
    );

    if (relevant.length < 3) {
      // Not enough data - use token-based estimate
      const costPerToken = 0.000_003;
      const estimatedCompletion = estimatedPromptTokens * 1.5;
      const cost = (estimatedPromptTokens + estimatedCompletion) * costPerToken;

      return {
        estimatedCostUsd: cost,
        confidenceLow: cost * 0.5,
        confidenceHigh: cost * 3,
        confidence: 0.3,
        basedOnSamples: 0,
        breakdown: {
          promptTokens: estimatedPromptTokens,
          completionTokens: Math.round(estimatedCompletion),
          estimatedLatencyMs: 5000,
        },
      };
    }

    // Calculate statistics from historical data
    const costs = relevant.map((h) => h.costUsd);
    const completionTokens = relevant.map((h) => h.completionTokens);
    const latencies = relevant.map((h) => h.latencyMs);

    const avgCost = costs.reduce((a, b) => a + b, 0) / costs.length;
    const avgCompletion =
      completionTokens.reduce((a, b) => a + b, 0) / completionTokens.length;
    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;

    // Standard deviation for confidence interval
    const variance =
      costs.reduce((sum, c) => sum + (c - avgCost) ** 2, 0) / costs.length;
    const stdDev = Math.sqrt(variance);
    const confidence = Math.min(0.95, 0.5 + relevant.length * 0.02);

    // Scale by prompt token ratio
    const avgPromptTokens =
      relevant.reduce((s, h) => s + h.promptTokens, 0) / relevant.length;
    const scale =
      avgPromptTokens > 0 ? estimatedPromptTokens / avgPromptTokens : 1;

    const estimatedCost = avgCost * scale;

    logger.debug(
      {
        taskType,
        model,
        samples: relevant.length,
        estimatedCost: estimatedCost.toFixed(6),
        confidence: confidence.toFixed(2),
      },
      "Cost prediction generated"
    );

    return {
      estimatedCostUsd: estimatedCost,
      confidenceLow: Math.max(0, estimatedCost - 2 * stdDev * scale),
      confidenceHigh: estimatedCost + 2 * stdDev * scale,
      confidence,
      basedOnSamples: relevant.length,
      breakdown: {
        promptTokens: estimatedPromptTokens,
        completionTokens: Math.round(avgCompletion * scale),
        estimatedLatencyMs: Math.round(avgLatency * scale),
      },
    };
  }
}
