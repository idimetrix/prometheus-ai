/**
 * GAP-078: A/B Testing for Agent Strategies
 *
 * Define experiments with control vs variant strategies,
 * route tasks randomly, measure results, and declare winners
 * with statistical significance.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:ab-test-engine");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ABStrategy {
  config: Record<string, unknown>;
  description: string;
  name: string;
}

export interface ABExperiment {
  completedAt?: number;
  control: ABStrategy;
  createdAt: number;
  id: string;
  name: string;
  results: {
    control: {
      trials: number;
      successes: number;
      totalQuality: number;
      totalDurationMs: number;
    };
    variant: {
      trials: number;
      successes: number;
      totalQuality: number;
      totalDurationMs: number;
    };
  };
  status: "active" | "paused" | "completed";
  targetSampleSize: number;
  variant: ABStrategy;
}

export interface ABResult {
  controlSuccessRate: number;
  experiment: ABExperiment;
  isSignificant: boolean;
  pValue: number;
  variantSuccessRate: number;
  winner: "control" | "variant" | "inconclusive";
}

// ─── A/B Test Engine ─────────────────────────────────────────────────────────

export class ABTestEngine {
  private readonly experiments = new Map<string, ABExperiment>();

  /**
   * Create a new A/B experiment.
   */
  createExperiment(params: {
    name: string;
    control: ABStrategy;
    variant: ABStrategy;
    targetSampleSize?: number;
  }): ABExperiment {
    const id = `ab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const experiment: ABExperiment = {
      id,
      name: params.name,
      control: params.control,
      variant: params.variant,
      status: "active",
      targetSampleSize: params.targetSampleSize ?? 100,
      results: {
        control: {
          trials: 0,
          successes: 0,
          totalQuality: 0,
          totalDurationMs: 0,
        },
        variant: {
          trials: 0,
          successes: 0,
          totalQuality: 0,
          totalDurationMs: 0,
        },
      },
      createdAt: Date.now(),
    };

    this.experiments.set(id, experiment);
    logger.info(
      { experimentId: id, name: params.name },
      "A/B experiment created"
    );
    return experiment;
  }

  /**
   * Assign a task to a strategy (random assignment).
   */
  assignStrategy(experimentId: string): {
    group: "control" | "variant";
    strategy: ABStrategy;
  } | null {
    const exp = this.experiments.get(experimentId);
    if (!exp || exp.status !== "active") {
      return null;
    }

    const group = Math.random() < 0.5 ? "control" : "variant";
    return {
      group,
      strategy: group === "control" ? exp.control : exp.variant,
    };
  }

  /**
   * Record the result of a trial.
   */
  recordTrial(params: {
    experimentId: string;
    group: "control" | "variant";
    success: boolean;
    quality: number;
    durationMs: number;
  }): void {
    const exp = this.experiments.get(params.experimentId);
    if (!exp) {
      return;
    }

    const bucket = exp.results[params.group];
    bucket.trials++;
    if (params.success) {
      bucket.successes++;
    }
    bucket.totalQuality += params.quality;
    bucket.totalDurationMs += params.durationMs;

    // Check if experiment should complete
    const totalTrials = exp.results.control.trials + exp.results.variant.trials;
    if (totalTrials >= exp.targetSampleSize) {
      exp.status = "completed";
      exp.completedAt = Date.now();
      logger.info({ experimentId: exp.id }, "A/B experiment completed");
    }

    logger.debug(
      {
        experimentId: exp.id,
        group: params.group,
        success: params.success,
        totalTrials,
      },
      "A/B trial recorded"
    );
  }

  /**
   * Get experiment results with statistical significance.
   */
  getResults(experimentId: string): ABResult | null {
    const exp = this.experiments.get(experimentId);
    if (!exp) {
      return null;
    }

    const controlRate =
      exp.results.control.trials > 0
        ? exp.results.control.successes / exp.results.control.trials
        : 0;
    const variantRate =
      exp.results.variant.trials > 0
        ? exp.results.variant.successes / exp.results.variant.trials
        : 0;

    // Simple z-test for proportions
    const pValue = this.calculatePValue(
      exp.results.control.successes,
      exp.results.control.trials,
      exp.results.variant.successes,
      exp.results.variant.trials
    );

    const isSignificant = pValue < 0.05;
    let winner: ABResult["winner"] = "inconclusive";
    if (isSignificant) {
      winner = controlRate > variantRate ? "control" : "variant";
    }

    return {
      experiment: exp,
      winner,
      controlSuccessRate: controlRate,
      variantSuccessRate: variantRate,
      pValue,
      isSignificant,
    };
  }

  /**
   * List all experiments.
   */
  listExperiments(): ABExperiment[] {
    return [...this.experiments.values()].sort(
      (a, b) => b.createdAt - a.createdAt
    );
  }

  // ─── Private ────────────────────────────────────────────────────────────

  private calculatePValue(
    successA: number,
    totalA: number,
    successB: number,
    totalB: number
  ): number {
    if (totalA === 0 || totalB === 0) {
      return 1;
    }

    const pA = successA / totalA;
    const pB = successB / totalB;
    const pPool = (successA + successB) / (totalA + totalB);
    const se = Math.sqrt(pPool * (1 - pPool) * (1 / totalA + 1 / totalB));

    if (se === 0) {
      return 1;
    }

    const z = Math.abs(pA - pB) / se;
    // Approximate p-value using normal CDF
    const p = Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
    return Math.min(1, p * 2); // Two-tailed
  }
}
