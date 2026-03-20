import { createLogger } from "@prometheus/logger";

const logger = createLogger("utils:rate-limiter");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RateLimitConfig {
  /** Default requests per window */
  defaultLimit: number;
  /** Internal service bypass token */
  internalBypassToken?: string;
  /** Per-tier limit overrides */
  tierLimits?: Record<string, number>;
  /** Window size in milliseconds (default: 60000) */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetMs: number;
}

export interface RateLimitHeaders {
  "X-RateLimit-Limit": string;
  "X-RateLimit-Remaining": string;
  "X-RateLimit-Reset": string;
}

interface SlidingWindowEntry {
  count: number;
  windowStart: number;
}

// ─── Sliding Window Rate Limiter ──────────────────────────────────────────────

const DEFAULT_CONFIG: RateLimitConfig = {
  windowMs: 60_000,
  defaultLimit: 100,
};

/**
 * In-memory sliding window rate limiter.
 *
 * Supports per-IP, per-user, per-org, and per-endpoint limits
 * with tier-based configuration. For distributed deployments,
 * use a Redis-backed implementation instead.
 */
export class SlidingWindowRateLimiter {
  private readonly config: RateLimitConfig;
  private readonly windows = new Map<string, SlidingWindowEntry>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: Partial<RateLimitConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    // Periodic cleanup of stale entries
    this.cleanupTimer = setInterval(
      () => this.cleanup(),
      this.config.windowMs * 2
    );
  }

  /**
   * Check if a request is allowed under the rate limit.
   *
   * @param key - Composite key (e.g., `ip:1.2.3.4`, `user:abc`, `org:xyz:endpoint:/api/tasks`)
   * @param limit - Override limit for this specific check
   */
  check(key: string, limit?: number): RateLimitResult {
    const effectiveLimit = limit ?? this.resolveLimit(key);
    const now = Date.now();

    const entry = this.windows.get(key);

    if (!entry || now - entry.windowStart >= this.config.windowMs) {
      // New window
      this.windows.set(key, { windowStart: now, count: 1 });
      return {
        allowed: true,
        limit: effectiveLimit,
        remaining: effectiveLimit - 1,
        resetMs: now + this.config.windowMs,
      };
    }

    entry.count++;
    const remaining = Math.max(0, effectiveLimit - entry.count);
    const resetMs = entry.windowStart + this.config.windowMs;
    const allowed = entry.count <= effectiveLimit;

    if (!allowed) {
      logger.debug(
        { key, count: entry.count, limit: effectiveLimit },
        "Rate limit exceeded"
      );
    }

    return { allowed, limit: effectiveLimit, remaining, resetMs };
  }

  /**
   * Check if a request carries an internal service bypass token.
   */
  isBypass(token: string | undefined): boolean {
    if (!(this.config.internalBypassToken && token)) {
      return false;
    }
    return token === this.config.internalBypassToken;
  }

  /**
   * Get rate limit headers for an HTTP response.
   */
  getHeaders(result: RateLimitResult): RateLimitHeaders {
    return {
      "X-RateLimit-Limit": String(result.limit),
      "X-RateLimit-Remaining": String(result.remaining),
      "X-RateLimit-Reset": String(Math.ceil(result.resetMs / 1000)),
    };
  }

  /**
   * Stop the cleanup timer. Call when shutting down.
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.windows.clear();
  }

  private resolveLimit(key: string): number {
    if (this.config.tierLimits) {
      // Extract tier from key pattern like "tier:pro:..."
      for (const [tier, limit] of Object.entries(this.config.tierLimits)) {
        if (key.includes(`tier:${tier}`)) {
          return limit;
        }
      }
    }
    return this.config.defaultLimit;
  }

  private cleanup(): void {
    const now = Date.now();
    const expiry = this.config.windowMs * 2;

    for (const [key, entry] of this.windows) {
      if (now - entry.windowStart > expiry) {
        this.windows.delete(key);
      }
    }
  }
}
