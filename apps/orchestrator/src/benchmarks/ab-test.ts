/**
 * Phase 16.2: A/B Testing for model/strategy comparison.
 * Routes N% of tasks to treatment group and measures statistical significance.
 */
import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:benchmarks:ab");

export interface ABTestConfig {
  controlGroup: string;
  id: string;
  name: string;
  trafficPercent: number;
  treatmentGroup: string;
}

export interface ABTestResult {
  controlMean: number;
  controlSamples: number;
  controlStdDev: number;
  pValue: number;
  significant: boolean;
  testId: string;
  treatmentMean: number;
  treatmentSamples: number;
  treatmentStdDev: number;
}

interface Sample {
  group: "control" | "treatment";
  score: number;
  timestamp: number;
}

export class ABTestManager {
  private readonly tests = new Map<string, ABTestConfig>();
  private readonly samples = new Map<string, Sample[]>();

  registerTest(config: ABTestConfig): void {
    this.tests.set(config.id, config);
    this.samples.set(config.id, []);
    logger.info(
      { testId: config.id, name: config.name, traffic: config.trafficPercent },
      "A/B test registered"
    );
  }

  /**
   * Route a task to control or treatment group.
   */
  assignGroup(testId: string): "control" | "treatment" | null {
    const config = this.tests.get(testId);
    if (!config) {
      return null;
    }

    const roll = Math.random() * 100;
    return roll < config.trafficPercent ? "treatment" : "control";
  }

  /**
   * Record a sample for a test.
   */
  recordSample(
    testId: string,
    group: "control" | "treatment",
    score: number
  ): void {
    const samples = this.samples.get(testId);
    if (!samples) {
      return;
    }

    samples.push({ group, score, timestamp: Date.now() });
  }

  /**
   * Analyze results using a two-sample t-test.
   */
  analyzeResults(testId: string): ABTestResult | null {
    const samples = this.samples.get(testId);
    if (!samples || samples.length < 10) {
      return null;
    }

    const control = samples
      .filter((s) => s.group === "control")
      .map((s) => s.score);
    const treatment = samples
      .filter((s) => s.group === "treatment")
      .map((s) => s.score);

    if (control.length < 5 || treatment.length < 5) {
      return null;
    }

    const controlMean = mean(control);
    const treatmentMean = mean(treatment);
    const controlStdDev = stdDev(control);
    const treatmentStdDev = stdDev(treatment);

    // Welch's t-test
    const tStat = welchTTest(
      controlMean,
      controlStdDev,
      control.length,
      treatmentMean,
      treatmentStdDev,
      treatment.length
    );

    // Approximate p-value (two-tailed)
    const df = welchDF(
      controlStdDev,
      control.length,
      treatmentStdDev,
      treatment.length
    );
    const pValue = approximatePValue(Math.abs(tStat), df);

    const result: ABTestResult = {
      testId,
      controlMean,
      controlStdDev,
      controlSamples: control.length,
      treatmentMean,
      treatmentStdDev,
      treatmentSamples: treatment.length,
      pValue,
      significant: pValue < 0.05,
    };

    logger.info(
      {
        testId,
        controlMean: controlMean.toFixed(3),
        treatmentMean: treatmentMean.toFixed(3),
        pValue: pValue.toFixed(4),
        significant: result.significant,
      },
      "A/B test analysis complete"
    );

    return result;
  }
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stdDev(values: number[]): number {
  const m = mean(values);
  const variance =
    values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function welchTTest(
  m1: number,
  s1: number,
  n1: number,
  m2: number,
  s2: number,
  n2: number
): number {
  const se = Math.sqrt(s1 ** 2 / n1 + s2 ** 2 / n2);
  return se > 0 ? (m1 - m2) / se : 0;
}

function welchDF(s1: number, n1: number, s2: number, n2: number): number {
  const v1 = s1 ** 2 / n1;
  const v2 = s2 ** 2 / n2;
  const num = (v1 + v2) ** 2;
  const den = v1 ** 2 / (n1 - 1) + v2 ** 2 / (n2 - 1);
  return den > 0 ? num / den : 1;
}

/**
 * Approximate p-value using the normal distribution for large df.
 */
function approximatePValue(tStat: number, _df: number): number {
  // Use standard normal approximation
  const x = tStat;
  const a1 = 0.254_829_592;
  const a2 = -0.284_496_736;
  const a3 = 1.421_413_741;
  const a4 = -1.453_152_027;
  const a5 = 1.061_405_429;
  const p = 0.327_591_1;
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x) / Math.SQRT2;
  const t = 1.0 / (1.0 + p * absX);
  const y =
    1.0 -
    ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
  const cdf = 0.5 * (1.0 + sign * y);
  return 2 * (1 - cdf); // Two-tailed
}
