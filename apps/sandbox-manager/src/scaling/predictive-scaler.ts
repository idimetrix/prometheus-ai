/**
 * Predictive Scaler.
 *
 * Tracks hourly usage patterns by day-of-week and uses simple linear
 * regression to predict future sandbox demand. Provides scaling
 * recommendations for warm pool sizing.
 */
import { createLogger } from "@prometheus/logger";

const logger = createLogger("sandbox-manager:predictive-scaler");

/** A single usage data point */
interface UsageDataPoint {
  activeSandboxes: number;
  timestamp: Date;
}

/** Hourly usage bucket (0-23 for each day-of-week 0-6) */
interface HourlyBucket {
  peakSandboxes: number;
  sampleCount: number;
  totalSandboxes: number;
}

/** Scaling recommendation output */
export interface ScalingRecommendation {
  basedOnSamples: number;
  confidence: number;
  predictedPeakHour: number;
  targetTotal: number;
  targetWarm: number;
}

const DAYS_IN_WEEK = 7;
const HOURS_IN_DAY = 24;
const TOTAL_BUCKETS = DAYS_IN_WEEK * HOURS_IN_DAY;

/** Minimum samples per bucket before we trust the prediction */
const MIN_SAMPLES_FOR_PREDICTION = 3;

/** Warm pool buffer multiplier above predicted average */
const WARM_BUFFER_MULTIPLIER = 1.3;

/** Total capacity buffer multiplier above predicted peak */
const TOTAL_BUFFER_MULTIPLIER = 1.5;

export class PredictiveScaler {
  private readonly buckets: HourlyBucket[];
  private readonly recentDataPoints: UsageDataPoint[] = [];
  private static readonly MAX_RECENT_POINTS = 10_000;

  constructor() {
    this.buckets = Array.from({ length: TOTAL_BUCKETS }, () => ({
      totalSandboxes: 0,
      sampleCount: 0,
      peakSandboxes: 0,
    }));
  }

  /**
   * Record a usage data point. The timestamp determines which
   * day-of-week + hour bucket it falls into.
   */
  recordUsage(timestamp: Date, activeSandboxes: number): void {
    const bucketIndex = this.getBucketIndex(timestamp);
    const bucket = this.buckets[bucketIndex];
    if (!bucket) {
      return;
    }

    bucket.sampleCount++;
    bucket.totalSandboxes += activeSandboxes;
    bucket.peakSandboxes = Math.max(bucket.peakSandboxes, activeSandboxes);

    // Track recent points for regression
    this.recentDataPoints.push({ timestamp, activeSandboxes });
    if (this.recentDataPoints.length > PredictiveScaler.MAX_RECENT_POINTS) {
      this.recentDataPoints.shift();
    }
  }

  /**
   * Predict sandbox demand for a given number of hours ahead.
   * Uses the historical average for the target day-of-week + hour bucket.
   */
  predictDemand(hoursAhead: number): number {
    const targetDate = new Date(Date.now() + hoursAhead * 3_600_000);
    const bucketIndex = this.getBucketIndex(targetDate);
    const bucket = this.buckets[bucketIndex];

    if (!bucket || bucket.sampleCount < MIN_SAMPLES_FOR_PREDICTION) {
      // Not enough data, use linear regression on recent points
      return this.linearRegressionPredict(hoursAhead);
    }

    const avgDemand = bucket.totalSandboxes / bucket.sampleCount;

    // Blend historical average with linear regression for better accuracy
    const regressionPrediction = this.linearRegressionPredict(hoursAhead);
    const blendWeight = Math.min(bucket.sampleCount / 20, 0.8);

    return Math.round(
      avgDemand * blendWeight + regressionPrediction * (1 - blendWeight)
    );
  }

  /**
   * Get a scaling recommendation based on historical patterns.
   * Returns target warm pool size and total capacity.
   */
  getScalingRecommendation(): ScalingRecommendation {
    const now = new Date();
    let totalSamples = 0;
    let maxAvg = 0;
    let maxPeak = 0;
    let peakHour = 0;

    // Look at the next 24 hours of predictions
    for (let hour = 0; hour < HOURS_IN_DAY; hour++) {
      const futureDate = new Date(now.getTime() + hour * 3_600_000);
      const bucketIndex = this.getBucketIndex(futureDate);
      const bucket = this.buckets[bucketIndex];
      if (!bucket || bucket.sampleCount === 0) {
        continue;
      }

      totalSamples += bucket.sampleCount;
      const avg = bucket.totalSandboxes / bucket.sampleCount;
      if (avg > maxAvg) {
        maxAvg = avg;
        peakHour = hour;
      }
      maxPeak = Math.max(maxPeak, bucket.peakSandboxes);
    }

    const confidence = Math.min(
      totalSamples / (HOURS_IN_DAY * MIN_SAMPLES_FOR_PREDICTION),
      1
    );

    const targetWarm = Math.max(1, Math.ceil(maxAvg * WARM_BUFFER_MULTIPLIER));
    const targetTotal = Math.max(
      targetWarm + 2,
      Math.ceil(maxPeak * TOTAL_BUFFER_MULTIPLIER)
    );

    logger.debug(
      { targetWarm, targetTotal, confidence, peakHour, totalSamples },
      "Scaling recommendation generated"
    );

    return {
      targetWarm,
      targetTotal,
      confidence,
      basedOnSamples: totalSamples,
      predictedPeakHour: peakHour,
    };
  }

  /**
   * Get the average usage for a specific day-of-week and hour.
   */
  getAverageForHour(dayOfWeek: number, hour: number): number {
    const bucketIndex = dayOfWeek * HOURS_IN_DAY + hour;
    const bucket = this.buckets[bucketIndex];
    if (!bucket || bucket.sampleCount === 0) {
      return 0;
    }
    return bucket.totalSandboxes / bucket.sampleCount;
  }

  // ─── Private helpers ───────────────────────────────────────────────

  private getBucketIndex(date: Date): number {
    const day = date.getDay(); // 0 = Sunday
    const hour = date.getHours(); // 0-23
    return day * HOURS_IN_DAY + hour;
  }

  /**
   * Simple linear regression on recent data points to predict demand.
   * x = time offset in hours, y = active sandboxes.
   */
  private linearRegressionPredict(hoursAhead: number): number {
    if (this.recentDataPoints.length < 2) {
      return 1; // minimum baseline
    }

    const n = this.recentDataPoints.length;
    const baseTime = this.recentDataPoints[0]?.timestamp.getTime() ?? 0;

    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumX2 = 0;

    for (const point of this.recentDataPoints) {
      const x = (point.timestamp.getTime() - baseTime) / 3_600_000; // hours
      const y = point.activeSandboxes;
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumX2 += x * x;
    }

    const denominator = n * sumX2 - sumX * sumX;
    if (Math.abs(denominator) < 0.0001) {
      // No variance in x, return average
      return Math.max(1, Math.round(sumY / n));
    }

    const slope = (n * sumXY - sumX * sumY) / denominator;
    const intercept = (sumY - slope * sumX) / n;

    const lastPoint = this.recentDataPoints[n - 1];
    const lastX = lastPoint
      ? (lastPoint.timestamp.getTime() - baseTime) / 3_600_000
      : 0;
    const prediction = intercept + slope * (lastX + hoursAhead);

    return Math.max(1, Math.round(prediction));
  }
}
