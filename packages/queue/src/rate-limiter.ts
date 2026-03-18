import type { PlanTier } from "@prometheus/types";
import type IORedis from "ioredis";
import { createRedisConnection } from "./connection";
import { getRateLimitForTier, type RateLimitConfig } from "./types";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetMs: number;
}

/**
 * Redis-based sliding-window rate limiter scoped per org.
 *
 * Uses a sorted set with timestamps as scores.
 * Each entry is a unique job submission; expired entries
 * are pruned on every check.
 */
export class OrgRateLimiter {
  private readonly redis: IORedis;
  private readonly keyPrefix: string;

  constructor(redis?: IORedis, keyPrefix = "ratelimit:org") {
    this.redis = redis ?? createRedisConnection();
    this.keyPrefix = keyPrefix;
  }

  /**
   * Check whether the org is allowed to enqueue a job and record it if so.
   */
  async checkAndRecord(
    orgId: string,
    tier: PlanTier,
    jobId?: string
  ): Promise<RateLimitResult> {
    const config = getRateLimitForTier(tier);
    return this.checkWithConfig(orgId, config, jobId);
  }

  /**
   * Check rate limit with an explicit config (useful for testing).
   */
  async checkWithConfig(
    orgId: string,
    config: RateLimitConfig,
    jobId?: string
  ): Promise<RateLimitResult> {
    const key = `${this.keyPrefix}:${orgId}`;
    const now = Date.now();
    const windowStart = now - config.windowMs;
    const member = jobId ?? `${now}:${Math.random().toString(36).slice(2, 10)}`;

    // Atomic pipeline: prune old entries, count current, conditionally add
    const pipeline = this.redis.pipeline();
    pipeline.zremrangebyscore(key, 0, windowStart);
    pipeline.zcard(key);
    const results = await pipeline.exec();

    const currentCount = (results?.[1]?.[1] as number) ?? 0;

    if (currentCount >= config.max) {
      // Find oldest entry to compute reset time
      const oldest = await this.redis.zrange(key, 0, 0, "WITHSCORES");
      const resetMs =
        oldest.length >= 2
          ? Math.max(0, config.windowMs - (now - Number(oldest[1])))
          : config.windowMs;

      return {
        allowed: false,
        remaining: 0,
        resetMs,
      };
    }

    // Record this job
    await this.redis.zadd(key, now, member);
    await this.redis.pexpire(key, config.windowMs);

    return {
      allowed: true,
      remaining: config.max - currentCount - 1,
      resetMs: config.windowMs,
    };
  }

  /**
   * Get current usage without recording.
   */
  async getCurrentUsage(
    orgId: string,
    tier: PlanTier
  ): Promise<{
    used: number;
    limit: number;
    remaining: number;
  }> {
    const config = getRateLimitForTier(tier);
    const key = `${this.keyPrefix}:${orgId}`;
    const now = Date.now();
    const windowStart = now - config.windowMs;

    await this.redis.zremrangebyscore(key, 0, windowStart);
    const used = await this.redis.zcard(key);

    return {
      used,
      limit: config.max,
      remaining: Math.max(0, config.max - used),
    };
  }

  /**
   * Reset rate limit for an org (admin use).
   */
  async reset(orgId: string): Promise<void> {
    const key = `${this.keyPrefix}:${orgId}`;
    await this.redis.del(key);
  }
}
