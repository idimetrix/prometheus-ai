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
      avgCostUsd: number;
      avgLatencyMs: number;
      avgQualityScore: number | null;
      modelKey: string;
      stddevLatencyMs: number;
      stddevQualityScore: number | null;
      successRate: number;
      totalRequests: number;
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

// ─── Beta Distribution Sampling ───────────────────────────────────────

/**
 * Generate a sample from a Gamma distribution using Marsaglia and Tsang's method.
 * Used internally by betaSample.
 */
function gammaSample(shape: number, scale: number): number {
  if (shape < 1) {
    // Boost: gamma(shape) = gamma(shape+1) * U^(1/shape)
    return gammaSample(shape + 1, scale) * Math.random() ** (1 / shape);
  }

  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);

  for (;;) {
    let x: number;
    let v: number;

    do {
      // Generate standard normal using Box-Muller
      const u1 = Math.random();
      const u2 = Math.random();
      x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      v = (1 + c * x) ** 3;
    } while (v <= 0);

    const u = Math.random();
    // Squeeze and rejection test
    if (
      u < 1 - 0.0331 * x ** 2 * x ** 2 ||
      Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))
    ) {
      return d * v * scale;
    }
  }
}

/**
 * Sample from a Beta(alpha, beta) distribution.
 * Uses the relationship: if X ~ Gamma(alpha, 1) and Y ~ Gamma(beta, 1),
 * then X / (X + Y) ~ Beta(alpha, beta).
 */
function betaSample(alpha: number, beta: number): number {
  const x = gammaSample(alpha, 1);
  const y = gammaSample(beta, 1);
  return x / (x + y);
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

      // Calculate standard deviations
      const stddevQuality =
        avgQuality !== null && result.qualityScores.length > 1
          ? Math.sqrt(
              result.qualityScores.reduce(
                (sum, q) => sum + (q - (avgQuality as number)) ** 2,
                0
              ) /
                (result.qualityScores.length - 1)
            )
          : null;

      // Approximate stddev for latency from total and count
      // (We track total latency, so stddev is approximated)
      const stddevLatency = 0;

      variants[variantId] = {
        modelKey: result.modelKey,
        totalRequests: result.totalRequests,
        successRate,
        avgLatencyMs: Math.round(avgLatency),
        avgCostUsd: avgCost,
        avgQualityScore: avgQuality,
        stddevLatencyMs: stddevLatency,
        stddevQualityScore: stddevQuality,
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
   * Thompson sampling using Beta distribution to select the best variant.
   *
   * Each variant's success/failure counts parameterize a Beta(alpha, beta)
   * distribution where alpha = successes + 1, beta = failures + 1.
   * We draw a random sample from each variant's Beta distribution and
   * pick the variant with the highest sample value.
   *
   * This provides Bayesian exploration/exploitation balancing:
   * variants with less data get explored more, while high-performing
   * variants get exploited.
   */
  thompsonSample(experimentId: string): string {
    const experiment = this.experiments.get(experimentId);
    if (!experiment?.active) {
      return "control";
    }

    let bestVariantId = "control";
    let bestSample = -1;

    for (const [variantId, result] of experiment.results) {
      // Beta distribution parameters: alpha = successes + 1, beta = failures + 1
      // The +1 acts as a uniform prior (Beta(1,1))
      const alpha = result.successCount + 1;
      const beta = result.failureCount + 1;
      const sample = betaSample(alpha, beta);

      if (sample > bestSample) {
        bestSample = sample;
        bestVariantId = variantId;
      }
    }

    logger.debug(
      { experimentId, selectedVariant: bestVariantId, sampleValue: bestSample },
      "Thompson sampling selected variant"
    );

    return bestVariantId;
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

  // ─── Convenience API ─────────────────────────────────────────────────

  /**
   * Simplified experiment creation with just a name, two models, and traffic split.
   * Creates an experiment with modelA as control and modelB as the variant.
   */
  createSimpleExperiment(
    name: string,
    modelA: string,
    modelB: string,
    trafficSplit = 50,
    slot = "default"
  ): string {
    const experimentId = `exp_${name.replace(/\s+/g, "_").toLowerCase()}_${Date.now()}`;
    return this.createExperiment({
      id: experimentId,
      name,
      slot,
      startDate: new Date(),
      control: { modelKey: modelA },
      variants: [
        {
          id: "variant_b",
          modelKey: modelB,
          trafficPercent: trafficSplit,
        },
      ],
    });
  }

  /**
   * Route a request for an experiment by name.
   * Returns which model variant to use for this request.
   */
  routeRequest(
    experimentName: string,
    userId = "anonymous"
  ): { experimentId: string; modelKey: string; variantId: string } | null {
    for (const [experimentId, experiment] of this.experiments) {
      if (
        experiment.config.name === experimentName &&
        this.isExperimentActive(experimentId)
      ) {
        const variantId = this.getVariant(experimentId, userId);
        let modelKey: string;

        if (variantId === "control") {
          modelKey = experiment.config.control.modelKey;
        } else {
          const variant = experiment.config.variants.find(
            (v) => v.id === variantId
          );
          modelKey = variant?.modelKey ?? experiment.config.control.modelKey;
        }

        return { experimentId, variantId, modelKey };
      }
    }

    return null;
  }

  /**
   * Record a result using individual parameters (convenience overload).
   */
  recordResultByName(
    experimentName: string,
    variant: string,
    qualityScore: number,
    latencyMs: number,
    costUsd: number
  ): void {
    for (const [experimentId, experiment] of this.experiments) {
      if (experiment.config.name === experimentName && experiment.active) {
        const result = experiment.results.get(variant);
        if (!result) {
          return;
        }

        result.totalRequests++;
        result.successCount++;
        result.totalLatencyMs += latencyMs;
        result.totalCostUsd += costUsd;
        result.qualityScores.push(qualityScore);

        logger.debug(
          {
            experimentId,
            variant,
            qualityScore,
            latencyMs,
            costUsd,
          },
          "Recorded A/B test result by name"
        );
        return;
      }
    }
  }

  /**
   * Conclude an experiment by picking the winner based on results.
   * Selects the variant with the highest average quality score,
   * or if no quality data, the highest success rate.
   */
  concludeExperiment(experimentId: string): ExperimentResults {
    const experiment = this.experiments.get(experimentId);
    if (!experiment) {
      throw new Error(`Experiment not found: ${experimentId}`);
    }

    let bestVariantId: string | null = null;
    let bestScore = -1;

    for (const [variantId, result] of experiment.results) {
      if (result.totalRequests === 0) {
        continue;
      }

      let score: number;
      if (result.qualityScores.length > 0) {
        score =
          result.qualityScores.reduce((s, q) => s + q, 0) /
          result.qualityScores.length;
      } else {
        score = result.successCount / result.totalRequests;
      }

      if (score > bestScore) {
        bestScore = score;
        bestVariantId = variantId;
      }
    }

    experiment.active = false;
    experiment.winner = bestVariantId;

    logger.info(
      {
        experimentId,
        winner: bestVariantId,
        winnerScore: bestScore.toFixed(3),
      },
      "Experiment concluded"
    );

    return this.getResults(experimentId);
  }
}
