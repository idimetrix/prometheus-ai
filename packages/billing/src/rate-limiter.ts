import { createLogger } from "@prometheus/logger";
import { createRedisConnection } from "@prometheus/queue";
import type IORedis from "ioredis";

const logger = createLogger("billing:rate-limiter");

interface TierLimits {
  maxTasksPerDay: number;
  maxConcurrentAgents: number;
}

const TIER_LIMITS: Record<string, TierLimits> = {
  hobby: { maxTasksPerDay: 5, maxConcurrentAgents: 1 },
  starter: { maxTasksPerDay: 50, maxConcurrentAgents: 2 },
  pro: { maxTasksPerDay: 200, maxConcurrentAgents: 5 },
  team: { maxTasksPerDay: 500, maxConcurrentAgents: 10 },
  studio: { maxTasksPerDay: 2000, maxConcurrentAgents: 25 },
  enterprise: { maxTasksPerDay: Infinity, maxConcurrentAgents: Infinity },
};

export class RateLimiter {
  private redis: IORedis;

  constructor(redis?: IORedis) {
    this.redis = redis ?? createRedisConnection();
  }

  async checkRateLimit(orgId: string, planTier: string): Promise<{
    allowed: boolean;
    remaining: number;
    resetAt: Date;
  }> {
    const limits = TIER_LIMITS[planTier] ?? TIER_LIMITS.hobby;

    if (limits.maxTasksPerDay === Infinity) {
      return { allowed: true, remaining: Infinity, resetAt: new Date() };
    }

    const key = `rate:daily:${orgId}`;
    const count = await this.redis.get(key);
    const current = count ? parseInt(count, 10) : 0;

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

  async checkConcurrency(orgId: string, planTier: string, currentActive: number): Promise<boolean> {
    const limits = TIER_LIMITS[planTier] ?? TIER_LIMITS.hobby;
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

  async getEstimatedWait(orgId: string, planTier: string): Promise<number> {
    const priority = this.getPriorityForTier(planTier);
    // Rough estimate: higher priority = lower wait
    return Math.max(0, (priority - 1) * 15);
  }
}
