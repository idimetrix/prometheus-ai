import { createLogger } from "@prometheus/logger";

const logger = createLogger("model-router:ab-testing");

// ─── Types ────────────────────────────────────────────────────────────

export interface ExperimentConfig {
  control: { modelKey: string };
  endDate?: Date;
  id: string;
  name: string;
  /** Which routing slot to experiment on */
  slot: string;
  startDate: Date;
  variants: Array<{
    id: string;
    modelKey: string;
    trafficPercent: number;
  }>;
}

export interface ExperimentMetrics {
  costUsd: number;
  latencyMs: number;
  qualityScore?: number;
  success: boolean;
}

interface VariantResult {
  failureCount: number;
  modelKey: string;
  qualityScores: number[];
  successCount: number;
  totalCostUsd: number;
  totalLatencyMs: number;
  totalRequests: number;
  variantId: string;
}

export interface ExperimentResults {
  experimentId: string;
  experimentName: string;
  isActive: boolean;
  /** Statistical significance (p-value approximation via chi-squared test) */
  significancePValue: number | null;
  variants: Record<
    string,
    {
      modelKey: string;
      totalRequests: number;
      successRate: number;
      avgLatencyMs: number;
      avgCostUsd: number;
      avgQualityScore: number | null;
    }
  >;
  winner: string | null;
}

interface StoredExperiment {
  active: boolean;
  config: ExperimentConfig;
  results: Map<string, VariantResult>;
  winner: string | null;
}

// ─── FNV-1a Hashing ──────────────────────────────────────────────────

const FNV_OFFSET_BASIS = 2_166_136_261;
const FNV_PRIME = 16_777_619;

/**
 * FNV-1a hash for deterministic, consistent user-to-variant assignment.
 * Returns a number in [0, 1).
 */
function fnv1aHash(input: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < input.length; i++) {
    // biome-ignore lint/suspicious/noBitwiseOperators: FNV-1a hash requires bitwise ops
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  // biome-ignore lint/suspicious/noBitwiseOperators: FNV-1a hash requires bitwise ops
  return ((hash >>> 0) % 10_000) / 10_000;
}

// ─── Chi-Squared Approximation ───────────────────────────────────────

/**
 * Approximate chi-squared test for independence between variant and success.
 * Returns a p-value approximation. Lower values indicate higher significance.
 */
function chiSquaredSignificance(variants: VariantResult[]): number | null {
  const validVariants = variants.filter((v) => v.totalRequests > 0);
  if (validVariants.length < 2) {
    return null;
  }

  const totalRequests = validVariants.reduce(
    (sum, v) => sum + v.totalRequests,
    0
  );
  const totalSuccesses = validVariants.reduce(
    (sum, v) => sum + v.successCount,
    0
  );
  const totalFailures = totalRequests - totalSuccesses;

  if (totalSuccesses === 0 || totalFailures === 0) {
    return 1.0; // No variance
  }

  let chiSquared = 0;
  for (const variant of validVariants) {
    const expectedSuccess =
      (variant.totalRequests * totalSuccesses) / totalRequests;
    const expectedFailure =
      (variant.totalRequests * totalFailures) / totalRequests;

    if (expectedSuccess > 0) {
      chiSquared +=
        (variant.successCount - expectedSuccess) ** 2 / expectedSuccess;
    }
    if (expectedFailure > 0) {
      chiSquared +=
        (variant.failureCount - expectedFailure) ** 2 / expectedFailure;
    }
  }

  // Degrees of freedom = (rows - 1) * (cols - 1) = (variants - 1) * 1
  const df = validVariants.length - 1;

  // Approximate p-value using Wilson-Hilferty transformation
  const z =
    ((chiSquared / df) ** (1 / 3) - (1 - 2 / (9 * df))) /
    Math.sqrt(2 / (9 * df));

  // Standard normal CDF approximation
  const pValue = 1 - normalCDF(z);
  return Math.max(0, Math.min(1, pValue));
}

/** Approximate standard normal CDF using Abramowitz & Stegun formula */
function normalCDF(x: number): number {
  if (x < -8) {
    return 0;
  }
  if (x > 8) {
    return 1;
  }

  const a1 = 0.254_829_592;
  const a2 = -0.284_496_736;
  const a3 = 1.421_413_741;
  const a4 = -1.453_152_027;
  const a5 = 1.061_405_429;
  const p = 0.327_591_1;

  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const t = 1.0 / (1.0 + p * absX);
  const y =
    1.0 -
    ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) *
      t *
      Math.exp((-absX * absX) / 2);

  return 0.5 * (1.0 + sign * y);
}

// ─── ABTestManager ───────────────────────────────────────────────────

/**
 * Manages A/B testing experiments for the model router.
 * Supports deterministic variant assignment via FNV-1a hashing
 * and statistical significance testing via chi-squared approximation.
 */
export class ABTestManager {
  private readonly experiments: Map<string, StoredExperiment> = new Map();

  /**
   * Create a new A/B test experiment.
   * @returns The experiment ID.
   */
  createExperiment(config: ExperimentConfig): string {
    // Validate traffic split
    const totalTraffic = config.variants.reduce(
      (sum, v) => sum + v.trafficPercent,
      0
    );
    if (totalTraffic > 100) {
      throw new Error(
        `Total traffic percent for variants exceeds 100%: ${totalTraffic}%`
      );
    }

    const variantResults = new Map<string, VariantResult>();

    // Initialize control variant
    variantResults.set("control", {
      variantId: "control",
      modelKey: config.control.modelKey,
      totalRequests: 0,
      successCount: 0,
      failureCount: 0,
      totalLatencyMs: 0,
      totalCostUsd: 0,
      qualityScores: [],
    });

    // Initialize treatment variants
    for (const variant of config.variants) {
      variantResults.set(variant.id, {
        variantId: variant.id,
        modelKey: variant.modelKey,
        totalRequests: 0,
        successCount: 0,
        failureCount: 0,
        totalLatencyMs: 0,
        totalCostUsd: 0,
        qualityScores: [],
      });
    }

    this.experiments.set(config.id, {
      config,
      active: true,
      winner: null,
      results: variantResults,
    });

    logger.info(
      {
        experimentId: config.id,
        name: config.name,
        slot: config.slot,
        variantCount: config.variants.length,
      },
      "A/B test experiment created"
    );

    return config.id;
  }

  /**
   * Get the variant assignment for a given user.
   * Uses FNV-1a hashing on `experimentId:userId` for deterministic,
   * consistent assignment.
   */
  getVariant(experimentId: string, userId: string): string {
    const experiment = this.experiments.get(experimentId);
    if (!experiment?.active) {
      return "control";
    }

    const hashInput = `${experimentId}:${userId}`;
    const hashValue = fnv1aHash(hashInput);
    const bucket = hashValue * 100; // 0-100

    // Walk through variant traffic allocations
    let threshold = 0;
    for (const variant of experiment.config.variants) {
      threshold += variant.trafficPercent;
      if (bucket < threshold) {
        return variant.id;
      }
    }

    // Remaining traffic goes to control
    return "control";
  }

  /**
   * Record the result of a request for a specific experiment and user.
   */
  recordResult(
    experimentId: string,
    userId: string,
    metrics: ExperimentMetrics
  ): void {
    const experiment = this.experiments.get(experimentId);
    if (!experiment?.active) {
      return;
    }

    const variantId = this.getVariant(experimentId, userId);
    const result = experiment.results.get(variantId);
    if (!result) {
      return;
    }

    result.totalRequests++;
    if (metrics.success) {
      result.successCount++;
    } else {
      result.failureCount++;
    }
    result.totalLatencyMs += metrics.latencyMs;
    result.totalCostUsd += metrics.costUsd;

    if (metrics.qualityScore !== undefined) {
      result.qualityScores.push(metrics.qualityScore);
    }

    logger.debug(
      {
        experimentId,
        variantId,
        success: metrics.success,
        latencyMs: metrics.latencyMs,
      },
      "Recorded A/B test result"
    );
  }

  /**
   * Get aggregated results for an experiment, including statistical
   * significance via chi-squared test approximation.
   */
  getResults(experimentId: string): ExperimentResults {
    const experiment = this.experiments.get(experimentId);
    if (!experiment) {
      throw new Error(`Experiment not found: ${experimentId}`);
    }

    const variants: ExperimentResults["variants"] = {};
    const allResults: VariantResult[] = [];

    for (const [variantId, result] of experiment.results) {
      allResults.push(result);

      const avgLatency =
        result.totalRequests > 0
          ? result.totalLatencyMs / result.totalRequests
          : 0;
      const avgCost =
        result.totalRequests > 0
          ? result.totalCostUsd / result.totalRequests
          : 0;
      const avgQuality =
        result.qualityScores.length > 0
          ? result.qualityScores.reduce((s, q) => s + q, 0) /
            result.qualityScores.length
          : null;
      const successRate =
        result.totalRequests > 0
          ? result.successCount / result.totalRequests
          : 0;

      variants[variantId] = {
        modelKey: result.modelKey,
        totalRequests: result.totalRequests,
        successRate,
        avgLatencyMs: Math.round(avgLatency),
        avgCostUsd: avgCost,
        avgQualityScore: avgQuality,
      };
    }

    const significancePValue = chiSquaredSignificance(allResults);

    return {
      experimentId,
      experimentName: experiment.config.name,
      isActive: experiment.active,
      variants,
      significancePValue,
      winner: experiment.winner,
    };
  }

  /**
   * Check if an experiment is currently active.
   */
  isExperimentActive(experimentId: string): boolean {
    const experiment = this.experiments.get(experimentId);
    if (!experiment) {
      return false;
    }

    if (!experiment.active) {
      return false;
    }

    const now = new Date();
    if (experiment.config.endDate && now > experiment.config.endDate) {
      experiment.active = false;
      return false;
    }

    return now >= experiment.config.startDate;
  }

  /**
   * End an experiment, optionally declaring a winner.
   */
  endExperiment(experimentId: string, winner?: string): void {
    const experiment = this.experiments.get(experimentId);
    if (!experiment) {
      throw new Error(`Experiment not found: ${experimentId}`);
    }

    experiment.active = false;
    experiment.winner = winner ?? null;

    logger.info(
      { experimentId, winner: winner ?? "none" },
      "A/B test experiment ended"
    );
  }

  /**
   * Check for an active experiment on the given slot and return the
   * experiment's model for the user. Returns null if no active experiment
   * applies to this slot.
   *
   * This method is called by the router before standard slot chain routing.
   */
  getExperimentModel(slot: string, userId?: string): string | null {
    if (!userId) {
      return null;
    }

    for (const [experimentId, experiment] of this.experiments) {
      if (
        experiment.config.slot === slot &&
        this.isExperimentActive(experimentId)
      ) {
        const variantId = this.getVariant(experimentId, userId);

        if (variantId === "control") {
          return experiment.config.control.modelKey;
        }

        const variant = experiment.config.variants.find(
          (v) => v.id === variantId
        );
        if (variant) {
          logger.debug(
            {
              experimentId,
              variantId,
              modelKey: variant.modelKey,
              slot,
              userId,
            },
            "A/B test routing override"
          );
          return variant.modelKey;
        }
      }
    }

    return null;
  }

  /**
   * List all experiments, optionally filtered by active status.
   */
  listExperiments(
    activeOnly = false
  ): Array<{ id: string; name: string; slot: string; active: boolean }> {
    const results: Array<{
      id: string;
      name: string;
      slot: string;
      active: boolean;
    }> = [];

    for (const [id, experiment] of this.experiments) {
      const isActive = this.isExperimentActive(id);
      if (activeOnly && !isActive) {
        continue;
      }
      results.push({
        id,
        name: experiment.config.name,
        slot: experiment.config.slot,
        active: isActive,
      });
    }

    return results;
  }
}
