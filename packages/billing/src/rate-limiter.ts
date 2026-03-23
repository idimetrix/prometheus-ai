import { createLogger } from "@prometheus/logger";
import { createRedisConnection } from "@prometheus/queue";

type IORedis = ReturnType<typeof createRedisConnection>;

const logger = createLogger("billing:rate-limiter");

interface TierLimits {
  maxConcurrentAgents: number;
  maxTasksPerDay: number;
}

const TIER_LIMITS: Record<string, TierLimits> = {
  hobby: { maxTasksPerDay: 5, maxConcurrentAgents: 1 },
  starter: { maxTasksPerDay: 50, maxConcurrentAgents: 2 },
  pro: { maxTasksPerDay: 200, maxConcurrentAgents: 5 },
  team: { maxTasksPerDay: 500, maxConcurrentAgents: 10 },
  studio: { maxTasksPerDay: 2000, maxConcurrentAgents: 25 },
  enterprise: {
    maxTasksPerDay: Number.POSITIVE_INFINITY,
    maxConcurrentAgents: Number.POSITIVE_INFINITY,
  },
};

// ─── Cost Cap Thresholds ───────────────────────────────────────────────────

/** Percentage of budget at which an alert notification is published */
const COST_CAP_ALERT_THRESHOLD = 0.8;

/** Percentage of budget at which new tasks are rejected (hard stop) */
const COST_CAP_HARD_LIMIT = 1.0;

export interface CostCapResult {
  /** Whether the 80% alert threshold has been crossed */
  alertTriggered: boolean;
  /** Whether the org is allowed to start new tasks */
  allowed: boolean;
  /** Current spend in dollars (or credit units) */
  currentSpend: number;
  /** Budget limit in dollars (or credit units) */
  limit: number;
  /** Percentage of budget used (0-1+) */
  usageRatio: number;
}

export class RateLimiter {
  private readonly redis: IORedis;

  constructor(redis?: IORedis) {
    this.redis = redis ?? createRedisConnection();
  }

  async checkRateLimit(
    orgId: string,
    planTier: string
  ): Promise<{
    allowed: boolean;
    remaining: number;
    resetAt: Date;
  }> {
    const limits: TierLimits = TIER_LIMITS[planTier] ?? {
      maxTasksPerDay: 5,
      maxConcurrentAgents: 1,
    };

    if (limits.maxTasksPerDay === Number.POSITIVE_INFINITY) {
      return {
        allowed: true,
        remaining: Number.POSITIVE_INFINITY,
        resetAt: new Date(),
      };
    }

    const key = `rate:daily:${orgId}`;
    const count = await this.redis.get(key);
    const current = count ? Number.parseInt(count, 10) : 0;

    // Calculate reset time (midnight UTC)
    const now = new Date();
    const resetAt = new Date(now);
    resetAt.setUTCHours(24, 0, 0, 0);

    if (current >= limits.maxTasksPerDay) {
      return {
        allowed: false,
        remaining: 0,
        resetAt,
      };
    }

    return {
      allowed: true,
      remaining: limits.maxTasksPerDay - current,
      resetAt,
    };
  }

  async recordUsage(orgId: string): Promise<void> {
    const key = `rate:daily:${orgId}`;
    const pipe = this.redis.pipeline();
    pipe.incr(key);
    // Expire at midnight UTC
    const now = new Date();
    const midnight = new Date(now);
    midnight.setUTCHours(24, 0, 0, 0);
    const ttl = Math.ceil((midnight.getTime() - now.getTime()) / 1000);
    pipe.expire(key, ttl);
    await pipe.exec();
  }

  checkConcurrency(
    _orgId: string,
    planTier: string,
    currentActive: number
  ): boolean {
    const limits: TierLimits = TIER_LIMITS[planTier] ?? {
      maxTasksPerDay: 5,
      maxConcurrentAgents: 1,
    };
    return currentActive < limits.maxConcurrentAgents;
  }

  getPriorityForTier(planTier: string): number {
    const priorities: Record<string, number> = {
      enterprise: 1,
      studio: 2,
      team: 3,
      pro: 5,
      starter: 8,
      hobby: 10,
    };
    return priorities[planTier] ?? 10;
  }

  getEstimatedWait(_orgId: string, planTier: string): number {
    const priority = this.getPriorityForTier(planTier);
    // Rough estimate: higher priority = lower wait
    return Math.max(0, (priority - 1) * 15);
  }

  // ─── Cost Cap ──────────────────────────────────────────────────────────────

  /**
   * Check whether an organization has exceeded its cost cap (budget limit).
   *
   * - At 80% usage an alert event key is set in Redis so downstream consumers
   *   (notification service, webhooks) can fire a warning to the org admins.
   * - At 100% usage new tasks are rejected (hard stop).
   *
   * @param orgId - Organization identifier
   * @param currentSpend - Current billing-period spend (dollars or credit units)
   * @param limit - Budget cap for the billing period
   */
  async checkCostCap(
    orgId: string,
    currentSpend: number,
    limit: number
  ): Promise<CostCapResult> {
    // If no limit is set (unlimited), always allow
    if (limit <= 0 || !Number.isFinite(limit)) {
      return {
        allowed: true,
        currentSpend,
        limit,
        usageRatio: 0,
        alertTriggered: false,
      };
    }

    const usageRatio = currentSpend / limit;
    let alertTriggered = false;

    // Check if we should publish the 80% alert
    if (
      usageRatio >= COST_CAP_ALERT_THRESHOLD &&
      usageRatio < COST_CAP_HARD_LIMIT
    ) {
      alertTriggered = await this.publishCostCapAlert(
        orgId,
        currentSpend,
        limit,
        usageRatio
      );
    }

    // Hard stop at 100%
    if (usageRatio >= COST_CAP_HARD_LIMIT) {
      logger.warn(
        { orgId, currentSpend, limit, usageRatio },
        "Cost cap exceeded — rejecting new tasks"
      );
      // Also trigger alert if not already sent
      alertTriggered = await this.publishCostCapAlert(
        orgId,
        currentSpend,
        limit,
        usageRatio
      );

      return {
        allowed: false,
        currentSpend,
        limit,
        usageRatio,
        alertTriggered,
      };
    }

    return {
      allowed: true,
      currentSpend,
      limit,
      usageRatio,
      alertTriggered,
    };
  }

  /**
   * Publish a cost cap alert notification event via Redis.
   * Uses a dedup key so the alert is only published once per billing period.
   *
   * @returns true if the alert was newly published, false if already sent
   */
  private async publishCostCapAlert(
    orgId: string,
    currentSpend: number,
    limit: number,
    usageRatio: number
  ): Promise<boolean> {
    // Dedup key — one alert per org per day
    const dedupKey = `cost-cap:alert:${orgId}:${new Date().toISOString().slice(0, 10)}`;

    try {
      // SET NX — only set if not already present
      const wasSet = await this.redis.set(dedupKey, "1", "EX", 86_400, "NX");

      if (wasSet) {
        // Publish notification event for downstream consumers
        const event = JSON.stringify({
          type: "cost_cap_alert",
          orgId,
          currentSpend,
          limit,
          usagePercent: Math.round(usageRatio * 100),
          timestamp: new Date().toISOString(),
        });
        await this.redis.publish("notifications:cost-cap", event);

        logger.info(
          { orgId, usagePercent: Math.round(usageRatio * 100) },
          "Cost cap alert published"
        );
        return true;
      }

      return false;
    } catch (err) {
      logger.warn(
        { orgId, error: (err as Error).message },
        "Failed to publish cost cap alert"
      );
      return false;
    }
  }
}
