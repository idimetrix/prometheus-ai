import { createLogger } from "@prometheus/logger";
import { createRedisConnection } from "@prometheus/queue";
import type IORedis from "ioredis";

const logger = createLogger("model-router:cost-monitor");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BudgetStatus {
  anomalyDetected: boolean;
  dailyBudgetUsd: number;
  orgId: string;
  remainingUsd: number;
  spentTodayUsd: number;
  throttled: boolean;
  usagePercent: number;
}

interface CostRecord {
  costUsd: number;
  model: string;
  orgId: string;
  timestamp: number;
}

interface HourlyBaseline {
  avgCostUsd: number;
  count: number;
}

// ─── Cost Monitor ─────────────────────────────────────────────────────────────

const DEFAULT_DAILY_BUDGET_USD = 50;
const THROTTLE_THRESHOLD = 0.8; // 80% of daily budget
const ANOMALY_MULTIPLIER = 2; // 2x hourly normal
const DAILY_KEY_TTL_SECONDS = 48 * 60 * 60; // 48h TTL for daily cost keys
const REDIS_KEY_PREFIX = "cost-monitor";

export class CostMonitor {
  private readonly records: CostRecord[] = [];
  private readonly budgets = new Map<string, number>();
  private readonly hourlyBaselines = new Map<string, HourlyBaseline>();
  private redis: IORedis | null = null;
  private redisAvailable = false;

  constructor() {
    this.initRedis();
  }

  /**
   * Initialize Redis connection for persistent cost tracking.
   * Falls back to in-memory when Redis is unavailable.
   */
  private initRedis(): void {
    try {
      this.redis = createRedisConnection();
      this.redis.on("error", (err) => {
        if (this.redisAvailable) {
          logger.warn(
            { err },
            "Redis connection lost, falling back to in-memory cost tracking"
          );
          this.redisAvailable = false;
        }
      });
      this.redis.on("connect", () => {
        this.redisAvailable = true;
        logger.info("Redis connected for cost monitoring persistence");
      });
    } catch {
      logger.warn(
        "Failed to connect to Redis, using in-memory cost tracking only"
      );
      this.redis = null;
      this.redisAvailable = false;
    }
  }

  /**
   * Get the Redis key for a daily cost bucket.
   */
  private dailyCostKey(orgId: string, date?: string): string {
    const day = date ?? new Date().toISOString().slice(0, 10);
    return `${REDIS_KEY_PREFIX}:daily:${orgId}:${day}`;
  }

  /**
   * Get the Redis key for a per-model daily cost bucket.
   */
  private modelCostKey(orgId: string, model: string, date?: string): string {
    const day = date ?? new Date().toISOString().slice(0, 10);
    return `${REDIS_KEY_PREFIX}:model:${orgId}:${model}:${day}`;
  }

  /**
   * Record a cost event for an org/model combination.
   * Persists to Redis with INCRBYFLOAT for atomic accumulation.
   */
  recordCost(orgId: string, model: string, costUsd: number): void {
    this.records.push({
      orgId,
      model,
      costUsd,
      timestamp: Date.now(),
    });

    // Update hourly baseline
    const baselineKey = `${orgId}:${this.getCurrentHour()}`;
    const baseline = this.hourlyBaselines.get(baselineKey) ?? {
      avgCostUsd: 0,
      count: 0,
    };
    baseline.count++;
    baseline.avgCostUsd =
      (baseline.avgCostUsd * (baseline.count - 1) + costUsd) / baseline.count;
    this.hourlyBaselines.set(baselineKey, baseline);

    // Persist to Redis atomically
    if (this.redis && this.redisAvailable) {
      const dailyKey = this.dailyCostKey(orgId);
      const modelKey = this.modelCostKey(orgId, model);

      this.redis
        .pipeline()
        .incrbyfloat(dailyKey, costUsd)
        .expire(dailyKey, DAILY_KEY_TTL_SECONDS)
        .incrbyfloat(modelKey, costUsd)
        .expire(modelKey, DAILY_KEY_TTL_SECONDS)
        .exec()
        .catch((err: unknown) => {
          logger.warn({ err, orgId, model }, "Failed to persist cost to Redis");
        });
    }

    // Prune old records (keep last 48 hours)
    const cutoff = Date.now() - 48 * 60 * 60 * 1000;
    while (
      this.records.length > 0 &&
      (this.records[0]?.timestamp ?? 0) < cutoff
    ) {
      this.records.shift();
    }
  }

  /**
   * Set the daily budget for an organization.
   */
  setBudget(orgId: string, dailyBudgetUsd: number): void {
    this.budgets.set(orgId, dailyBudgetUsd);
  }

  /**
   * Fetch today's total spend from Redis for an org.
   * Returns null if Redis is unavailable.
   */
  async getDailySpentFromRedis(orgId: string): Promise<number | null> {
    if (!(this.redis && this.redisAvailable)) {
      return null;
    }

    try {
      const dailyKey = this.dailyCostKey(orgId);
      const value = await this.redis.get(dailyKey);
      return value ? Number.parseFloat(value) : 0;
    } catch (err) {
      logger.warn({ err, orgId }, "Failed to read daily cost from Redis");
      return null;
    }
  }

  /**
   * Check the budget status for an organization.
   *
   * Returns whether the org is throttled (>80% daily budget) and
   * whether anomalous spending is detected (2x normal hourly rate).
   *
   * Tries Redis first for persistent totals, falls back to in-memory.
   */
  async checkBudget(orgId: string): Promise<BudgetStatus> {
    const dailyBudgetUsd = this.budgets.get(orgId) ?? DEFAULT_DAILY_BUDGET_USD;

    // Try Redis first for accurate persistent totals
    const redisSpent = await this.getDailySpentFromRedis(orgId);

    let spentTodayUsd: number;
    if (redisSpent === null) {
      // Fall back to in-memory records
      const todayStart = this.getTodayStart();
      const todayRecords = this.records.filter(
        (r) => r.orgId === orgId && r.timestamp >= todayStart
      );
      spentTodayUsd = todayRecords.reduce((sum, r) => sum + r.costUsd, 0);
    } else {
      spentTodayUsd = redisSpent;
    }

    const remainingUsd = Math.max(0, dailyBudgetUsd - spentTodayUsd);
    const usagePercent = (spentTodayUsd / dailyBudgetUsd) * 100;
    const throttled = usagePercent >= THROTTLE_THRESHOLD * 100;

    // Anomaly detection: compare current hour to previous hours
    const anomalyDetected = this.detectAnomaly(orgId);

    if (throttled) {
      logger.warn(
        {
          orgId,
          spentTodayUsd: spentTodayUsd.toFixed(4),
          dailyBudgetUsd,
          usagePercent: usagePercent.toFixed(1),
        },
        "Org approaching daily budget limit, throttling enabled"
      );
    }

    if (anomalyDetected) {
      logger.warn(
        { orgId, spentTodayUsd: spentTodayUsd.toFixed(4) },
        "Anomalous spending pattern detected"
      );
    }

    return {
      orgId,
      dailyBudgetUsd,
      spentTodayUsd,
      remainingUsd,
      usagePercent,
      throttled,
      anomalyDetected,
    };
  }

  /**
   * Get per-model cost breakdown for an org.
   * Uses in-memory records (Redis stores aggregated totals only).
   */
  getCostBreakdown(
    orgId: string,
    windowMs = 24 * 60 * 60 * 1000
  ): Map<string, number> {
    const cutoff = Date.now() - windowMs;
    const breakdown = new Map<string, number>();

    for (const record of this.records) {
      if (record.orgId === orgId && record.timestamp >= cutoff) {
        const current = breakdown.get(record.model) ?? 0;
        breakdown.set(record.model, current + record.costUsd);
      }
    }

    return breakdown;
  }

  /**
   * Check whether Redis persistence is currently active.
   */
  isRedisPersistent(): boolean {
    return this.redisAvailable;
  }

  private detectAnomaly(orgId: string): boolean {
    const currentHour = this.getCurrentHour();
    const currentKey = `${orgId}:${currentHour}`;
    const currentBaseline = this.hourlyBaselines.get(currentKey);

    if (!currentBaseline || currentBaseline.count < 5) {
      return false; // Not enough data
    }

    // Compare with previous hours
    const previousHours: number[] = [];
    for (let i = 1; i <= 6; i++) {
      const prevHour = currentHour - i;
      const prevKey = `${orgId}:${prevHour}`;
      const prev = this.hourlyBaselines.get(prevKey);
      if (prev) {
        previousHours.push(prev.avgCostUsd * prev.count);
      }
    }

    if (previousHours.length < 2) {
      return false; // Not enough history
    }

    const avgPrevHourly =
      previousHours.reduce((s, v) => s + v, 0) / previousHours.length;
    const currentHourly = currentBaseline.avgCostUsd * currentBaseline.count;

    return currentHourly > avgPrevHourly * ANOMALY_MULTIPLIER;
  }

  private getCurrentHour(): number {
    return Math.floor(Date.now() / (60 * 60 * 1000));
  }

  private getTodayStart(): number {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  }
}
