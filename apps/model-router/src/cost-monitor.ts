import { createLogger } from "@prometheus/logger";

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

export class CostMonitor {
  private readonly records: CostRecord[] = [];
  private readonly budgets = new Map<string, number>();
  private readonly hourlyBaselines = new Map<string, HourlyBaseline>();

  /**
   * Record a cost event for an org/model combination.
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
   * Check the budget status for an organization.
   *
   * Returns whether the org is throttled (>80% daily budget) and
   * whether anomalous spending is detected (2x normal hourly rate).
   */
  checkBudget(orgId: string): BudgetStatus {
    const dailyBudgetUsd = this.budgets.get(orgId) ?? DEFAULT_DAILY_BUDGET_USD;
    const todayStart = this.getTodayStart();

    const todayRecords = this.records.filter(
      (r) => r.orgId === orgId && r.timestamp >= todayStart
    );

    const spentTodayUsd = todayRecords.reduce((sum, r) => sum + r.costUsd, 0);
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
