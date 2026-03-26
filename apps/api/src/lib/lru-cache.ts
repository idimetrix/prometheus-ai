import { createLogger } from "@prometheus/logger";

const logger = createLogger("api:lru-cache");

interface CacheEntry<T> {
  expiresAt: number;
  key: string;
  value: T;
}

/**
 * Simple LRU cache with TTL support for caching API responses.
 * Used by fast-path endpoints to avoid repeated model-router calls
 * for identical prompts.
 */
export class LRUCache<T> {
  private readonly maxSize: number;
  private readonly ttlMs: number;
  private readonly entries = new Map<string, CacheEntry<T>>();

  constructor(opts: { maxSize: number; ttlMs: number }) {
    this.maxSize = opts.maxSize;
    this.ttlMs = opts.ttlMs;
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }

    if (Date.now() > entry.expiresAt) {
      this.entries.delete(key);
      return undefined;
    }

    // Move to end (most recently used)
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T): void {
    // Delete first to reset position
    this.entries.delete(key);

    // Evict oldest entries if at capacity
    while (this.entries.size >= this.maxSize) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) {
        this.entries.delete(oldestKey);
      }
    }

    this.entries.set(key, {
      key,
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  /**
   * Remove expired entries. Call periodically to reclaim memory.
   */
  prune(): number {
    const now = Date.now();
    let pruned = 0;
    for (const [key, entry] of this.entries) {
      if (now > entry.expiresAt) {
        this.entries.delete(key);
        pruned++;
      }
    }
    if (pruned > 0) {
      logger.debug({ pruned, remaining: this.entries.size }, "Cache pruned");
    }
    return pruned;
  }
}

/**
 * Create a deterministic hash key from messages and model for cache lookup.
 * Uses a simple string-based hash since we only need uniqueness, not security.
 */
export function createCacheKey(
  messages: Array<{ role: string; content: string }>,
  model?: string
): string {
  const raw = JSON.stringify({ messages, model: model ?? "default" });
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    const char = raw.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash &= hash; // Convert to 32-bit integer
  }
  return `chat:${hash.toString(36)}`;
}
