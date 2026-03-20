/**
 * A/B Testing Experiment Analyzer
 *
 * Provides statistical analysis for A/B test experiments including
 * t-test calculations, significance testing, and sample size estimation.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("model-router:experiment-analyzer");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExperimentData {
  experimentId: string;
  groupA: GroupData;
  groupB: GroupData;
}

export interface GroupData {
  label: string;
  values: number[];
}

export interface AnalysisResult {
  confidence: number;
  experimentId: string;
  groupAMean: number;
  groupBMean: number;
  pValue: number;
  significant: boolean;
  tStatistic: number;
  winner: string | null;
}

// ---------------------------------------------------------------------------
// ExperimentAnalyzer
// ---------------------------------------------------------------------------

export class ExperimentAnalyzer {
  private readonly significanceLevel: number;

  constructor(significanceLevel = 0.05) {
    this.significanceLevel = significanceLevel;
  }

  /**
   * Analyze an experiment for statistical significance.
   */
  analyze(experimentData: ExperimentData): AnalysisResult {
    const { groupA, groupB } = experimentData;

    if (groupA.values.length < 2 || groupB.values.length < 2) {
      return {
        experimentId: experimentData.experimentId,
        tStatistic: 0,
        pValue: 1,
        significant: false,
        confidence: 0,
        groupAMean: mean(groupA.values),
        groupBMean: mean(groupB.values),
        winner: null,
      };
    }

    const result = this.tTest(groupA, groupB);

    const analysisResult: AnalysisResult = {
      experimentId: experimentData.experimentId,
      tStatistic: result.tStatistic,
      pValue: result.pValue,
      significant: result.pValue < this.significanceLevel,
      confidence: 1 - result.pValue,
      groupAMean: mean(groupA.values),
      groupBMean: mean(groupB.values),
      winner: null,
    };

    if (analysisResult.significant) {
      analysisResult.winner =
        analysisResult.groupAMean > analysisResult.groupBMean
          ? groupA.label
          : groupB.label;
    }

    logger.info(
      {
        experimentId: experimentData.experimentId,
        tStatistic: result.tStatistic.toFixed(4),
        pValue: result.pValue.toFixed(6),
        significant: analysisResult.significant,
        winner: analysisResult.winner,
      },
      "Experiment analysis complete"
    );

    return analysisResult;
  }

  /**
   * Perform a two-sample t-test (Welch's t-test).
   */
  tTest(
    groupA: GroupData,
    groupB: GroupData
  ): { tStatistic: number; pValue: number } {
    const meanA = mean(groupA.values);
    const meanB = mean(groupB.values);
    const varA = variance(groupA.values);
    const varB = variance(groupB.values);
    const nA = groupA.values.length;
    const nB = groupB.values.length;

    // Welch's t-test
    const seA = varA / nA;
    const seB = varB / nB;
    const denominator = Math.sqrt(seA + seB);

    if (denominator === 0) {
      return { tStatistic: 0, pValue: 1 };
    }

    const tStatistic = (meanA - meanB) / denominator;

    // Welch-Satterthwaite degrees of freedom
    const numeratorDf = (seA + seB) ** 2;
    const denominatorDf =
      (seA > 0 ? seA ** 2 / (nA - 1) : 0) + (seB > 0 ? seB ** 2 / (nB - 1) : 0);

    const _df = denominatorDf > 0 ? numeratorDf / denominatorDf : 1;

    // Approximate p-value using normal approximation for large df
    const pValue = 2 * (1 - normalCDF(Math.abs(tStatistic)));

    return { tStatistic, pValue: Math.max(0, Math.min(1, pValue)) };
  }

  /**
   * Recommend a winner if the experiment is statistically significant.
   */
  getWinner(experiment: ExperimentData): {
    winner: string | null;
    confidence: number;
    recommendation: string;
  } {
    const result = this.analyze(experiment);

    if (!result.significant) {
      return {
        winner: null,
        confidence: result.confidence,
        recommendation: `No significant difference detected (p=${result.pValue.toFixed(4)}). Need more samples.`,
      };
    }

    return {
      winner: result.winner,
      confidence: result.confidence,
      recommendation: `${result.winner} is significantly better (p=${result.pValue.toFixed(4)}, confidence ${(result.confidence * 100).toFixed(1)}%).`,
    };
  }

  /**
   * Estimate the required sample size per group to detect a given effect size
   * with specified statistical power.
   */
  getRequiredSampleSize(effectSize: number, power = 0.8): number {
    if (effectSize <= 0) {
      return Number.POSITIVE_INFINITY;
    }

    // z-values for common power levels
    const zAlpha = 1.96; // for alpha = 0.05, two-tailed
    let zBeta = 0.842;
    if (power === 0.9) {
      zBeta = 1.282;
    }

    // Sample size formula: n = 2 * ((z_alpha + z_beta) / d)^2
    const n = Math.ceil(2 * ((zAlpha + zBeta) / effectSize) ** 2);

    return Math.max(2, n);
  }
}

// ---------------------------------------------------------------------------
// Statistical Helpers
// ---------------------------------------------------------------------------

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function variance(values: number[]): number {
  if (values.length < 2) {
    return 0;
  }
  const m = mean(values);
  const sumSquares = values.reduce((sum, v) => sum + (v - m) ** 2, 0);
  return sumSquares / (values.length - 1);
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
