import { createLogger } from "@prometheus/logger";

const logger = createLogger("socket-server:rate-limiter");

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  maxRequests: 100,
  windowMs: 60_000,
};

const limits = new Map<string, RateLimitEntry>();

export function checkRateLimit(
  socketId: string,
  config: RateLimitConfig = DEFAULT_CONFIG
): { allowed: boolean; remaining: number; retryAfterMs: number } {
  const now = Date.now();
  const entry = limits.get(socketId);

  if (!entry || now - entry.windowStart > config.windowMs) {
    limits.set(socketId, { count: 1, windowStart: now });
    return {
      allowed: true,
      remaining: config.maxRequests - 1,
      retryAfterMs: 0,
    };
  }

  entry.count++;

  if (entry.count > config.maxRequests) {
    const retryAfterMs = config.windowMs - (now - entry.windowStart);
    logger.warn(
      { socketId, count: entry.count, max: config.maxRequests },
      "WebSocket rate limit exceeded"
    );
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.max(0, retryAfterMs),
    };
  }

  return {
    allowed: true,
    remaining: config.maxRequests - entry.count,
    retryAfterMs: 0,
  };
}

export function clearRateLimit(socketId: string): void {
  limits.delete(socketId);
}

// Periodic cleanup of expired entries
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of limits) {
    if (now - entry.windowStart > DEFAULT_CONFIG.windowMs * 2) {
      limits.delete(key);
    }
  }
}, 60_000);
