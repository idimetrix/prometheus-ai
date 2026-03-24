import { createLogger } from "@prometheus/logger";
import { createRedisConnection } from "@prometheus/queue";
import type IORedis from "ioredis";

interface ProviderLimits {
  maxRequests: number;
  maxTokens: number;
  windowMs: number;
}

interface RateLimitStatus {
  maxRequests: number;
  maxTokens: number;
  remaining: number;
  requests: number;
  resetMs: number;
  tokens: number;
}

const PROVIDER_LIMITS: Record<string, ProviderLimits> = {
  ollama: {
    maxRequests: Number.POSITIVE_INFINITY,
    maxTokens: Number.POSITIVE_INFINITY,
    windowMs: 60_000,
  },
  cerebras: { maxRequests: 30, maxTokens: 1_000_000, windowMs: 60_000 },
  groq: { maxRequests: 30, maxTokens: 131_072, windowMs: 60_000 },
  gemini: { maxRequests: 15, maxTokens: 4_000_000, windowMs: 60_000 },
  openrouter: { maxRequests: 20, maxTokens: 200_000, windowMs: 60_000 },
  mistral: {
    maxRequests: 2,
    maxTokens: Number.POSITIVE_INFINITY,
    windowMs: 60_000,
  },
  deepseek: {
    maxRequests: 60,
    maxTokens: Number.POSITIVE_INFINITY,
    windowMs: 60_000,
  },
  anthropic: { maxRequests: 50, maxTokens: 80_000, windowMs: 60_000 },
  openai: {
    maxRequests: 60,
    maxTokens: Number.POSITIVE_INFINITY,
    windowMs: 60_000,
  },
};

/**
 * Redis-backed sliding window rate limiter for LLM providers.
 *
 * Uses sorted sets with timestamp scores to maintain a sliding window of
 * recent requests per provider. Each request is recorded as a member with
 * a score equal to its timestamp in milliseconds. When checking limits,
 * expired entries outside the window are pruned automatically.
 */
export class RateLimitManager {
  private readonly logger = createLogger("model-router:rate-limiter");
  private readonly redis: IORedis;
  private readonly limits: Record<string, ProviderLimits>;

  constructor(redis?: IORedis) {
    this.redis = redis ?? createRedisConnection();
    this.limits = { ...PROVIDER_LIMITS };
  }

  /**
   * Check whether a request can be made to the given provider/model
   * without exceeding rate limits. Uses Redis sorted set with a
   * sliding window approach.
   */
  async canMakeRequest(provider: string, modelKey: string): Promise<boolean> {
    const limits = this.limits[provider];
    if (!limits) {
      return false;
    }

    // Ollama is local, unlimited
    if (limits.maxRequests === Number.POSITIVE_INFINITY) {
      return true;
    }

    const key = this.requestKey(provider);
    const now = Date.now();
    const windowStart = now - limits.windowMs;

    // Remove expired entries and count remaining in one pipeline
    const pipeline = this.redis.pipeline();
    pipeline.zremrangebyscore(key, 0, windowStart);
    pipeline.zcard(key);
    const results = await pipeline.exec();

    const count = (results?.[1]?.[1] as number) ?? 0;

    if (count >= limits.maxRequests) {
      this.logger.warn(
        { provider, modelKey, count, max: limits.maxRequests },
        "Rate limit reached"
      );
      return false;
    }

    // Also check token budget if finite
    if (limits.maxTokens !== Number.POSITIVE_INFINITY) {
      const tokenKey = this.tokenKey(provider);
      const tokenPipeline = this.redis.pipeline();
      tokenPipeline.zremrangebyscore(tokenKey, 0, windowStart);
      tokenPipeline.zrangebyscore(tokenKey, windowStart, "+inf");
      const tokenResults = await tokenPipeline.exec();

      const members = (tokenResults?.[1]?.[1] as string[]) ?? [];
      let totalTokens = 0;
      for (const member of members) {
        try {
          const parsed = JSON.parse(member);
          totalTokens += parsed.tokens ?? 0;
        } catch {
          // skip malformed entries
        }
      }

      if (totalTokens >= limits.maxTokens) {
        this.logger.warn(
          { provider, totalTokens, max: limits.maxTokens },
          "Token rate limit reached"
        );
        return false;
      }
    }

    return true;
  }

  /**
   * Record a request in the sliding window. Called after successfully
   * dispatching a request to a provider.
   */
  async recordRequest(
    provider: string,
    modelKey: string,
    tokens = 0
  ): Promise<void> {
    const limits = this.limits[provider];
    if (!limits || limits.maxRequests === Number.POSITIVE_INFINITY) {
      return;
    }

    const now = Date.now();
    const uniqueId = `${now}:${Math.random().toString(36).slice(2, 8)}`;

    // Record the request count
    const requestKey = this.requestKey(provider);
    const pipeline = this.redis.pipeline();
    pipeline.zadd(requestKey, now, uniqueId);
    pipeline.expire(requestKey, Math.ceil(limits.windowMs / 1000) + 5);

    // Record token usage if applicable
    if (tokens > 0 && limits.maxTokens !== Number.POSITIVE_INFINITY) {
      const tokenKey = this.tokenKey(provider);
      const tokenMember = JSON.stringify({
        id: uniqueId,
        tokens,
        model: modelKey,
      });
      pipeline.zadd(tokenKey, now, tokenMember);
      pipeline.expire(tokenKey, Math.ceil(limits.windowMs / 1000) + 5);
    }

    await pipeline.exec();

    this.logger.debug({ provider, modelKey, tokens }, "Request recorded");
  }

  /**
   * Record token usage after receiving a response. Updates the token
   * tracking for the provider's sliding window.
   */
  async recordTokenUsage(
    provider: string,
    modelKey: string,
    inputTokens: number,
    outputTokens: number
  ): Promise<void> {
    const totalTokens = inputTokens + outputTokens;
    if (totalTokens <= 0) {
      return;
    }

    const limits = this.limits[provider];
    if (!limits || limits.maxTokens === Number.POSITIVE_INFINITY) {
      return;
    }

    const now = Date.now();
    const tokenKey = this.tokenKey(provider);
    const uniqueId = `${now}:usage:${Math.random().toString(36).slice(2, 8)}`;
    const member = JSON.stringify({
      id: uniqueId,
      tokens: totalTokens,
      model: modelKey,
    });

    await this.redis.zadd(tokenKey, now, member);
  }

  /**
   * Get rate limit status for all configured providers.
   */
  async getStatus(): Promise<Record<string, RateLimitStatus>> {
    const status: Record<string, RateLimitStatus> = {};
    const now = Date.now();

    for (const [provider, limits] of Object.entries(this.limits)) {
      if (limits.maxRequests === Number.POSITIVE_INFINITY) {
        status[provider] = {
          requests: 0,
          maxRequests: -1,
          remaining: -1,
          resetMs: 0,
          tokens: 0,
          maxTokens: -1,
        };
        continue;
      }

      const windowStart = now - limits.windowMs;
      const key = this.requestKey(provider);

      const pipeline = this.redis.pipeline();
      pipeline.zremrangebyscore(key, 0, windowStart);
      pipeline.zcard(key);
      // Get the oldest entry to calculate reset time
      pipeline.zrange(key, 0, 0, "WITHSCORES");
      const results = await pipeline.exec();

      const count = (results?.[1]?.[1] as number) ?? 0;
      const oldestEntry = (results?.[2]?.[1] as string[]) ?? [];
      const oldestTimestamp =
        oldestEntry.length >= 2 ? Number(oldestEntry[1]) : now;
      const resetMs = Math.max(0, oldestTimestamp + limits.windowMs - now);

      // Get token usage
      let tokenCount = 0;
      if (limits.maxTokens !== Number.POSITIVE_INFINITY) {
        const tokenKey = this.tokenKey(provider);
        const tokenPipeline = this.redis.pipeline();
        tokenPipeline.zremrangebyscore(tokenKey, 0, windowStart);
        tokenPipeline.zrangebyscore(tokenKey, windowStart, "+inf");
        const tokenResults = await tokenPipeline.exec();
        const members = (tokenResults?.[1]?.[1] as string[]) ?? [];
        for (const member of members) {
          try {
            const parsed = JSON.parse(member);
            tokenCount += parsed.tokens ?? 0;
          } catch {
            // skip malformed entries
          }
        }
      }

      status[provider] = {
        requests: count,
        maxRequests: limits.maxRequests,
        remaining: Math.max(0, limits.maxRequests - count),
        resetMs,
        tokens: tokenCount,
        maxTokens:
          limits.maxTokens === Number.POSITIVE_INFINITY ? -1 : limits.maxTokens,
      };
    }

    return status;
  }

  /**
   * Wait until rate limit capacity is available for the given provider.
   * Returns the estimated wait time in ms, or 0 if capacity is available.
   */
  async waitForCapacity(
    provider: string,
    modelKey: string,
    timeoutMs = 30_000
  ): Promise<number> {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      if (await this.canMakeRequest(provider, modelKey)) {
        return Date.now() - start;
      }

      // Wait a fraction of the window before retrying
      const limits = this.limits[provider];
      const waitMs = Math.min(1000, (limits?.windowMs ?? 60_000) / 10);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    return -1; // Timed out
  }

  private requestKey(provider: string): string {
    return `ratelimit:requests:${provider}`;
  }

  private tokenKey(provider: string): string {
    return `ratelimit:tokens:${provider}`;
  }
}
