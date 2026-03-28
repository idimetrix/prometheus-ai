/**
 * GAP-096: Request Coalescing Engine
 *
 * Detects near-identical requests within a time window and returns
 * cached responses for duplicates. Tracks deduplication rate and savings.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("model-router:request-coalescer-engine");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CoalescedRequest {
  key: string;
  prompt: string;
  response: string | null;
  timestamp: number;
  waiters: number;
}

export interface CoalescerStats {
  deduplicatedRequests: number;
  deduplicationRate: number;
  estimatedCostSavedUsd: number;
  estimatedTokensSaved: number;
  totalRequests: number;
}

export interface CoalescerEngineConfig {
  /** Cost per token USD for savings estimation */
  costPerToken: number;
  /** Maximum pending requests to track (default: 500) */
  maxPending: number;
  /** Time window for deduplication in ms (default: 5s) */
  windowMs: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: CoalescerEngineConfig = {
  windowMs: 5000,
  maxPending: 500,
  costPerToken: 0.000_003,
};

// ─── Hashing ─────────────────────────────────────────────────────────────────

function normalizeAndHash(prompt: string): string {
  const normalized = prompt
    .replace(/\s+/g, " ")
    .replace(/[""]/g, '"')
    .replace(/['']/g, "'")
    .trim();

  let hash = 5381;
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) + hash + normalized.charCodeAt(i)) | 0;
  }
  return `rce_${(hash >>> 0).toString(36)}`;
}

// ─── Request Coalescer Engine ─────────────────────────────────────────────────

interface PendingEntry {
  key: string;
  prompt: string;
  resolvers: Array<{
    resolve: (value: string) => void;
    reject: (error: unknown) => void;
  }>;
  response: string | null;
  timestamp: number;
}

export class RequestCoalescerEngine {
  private readonly pending = new Map<string, PendingEntry>();
  private readonly config: CoalescerEngineConfig;
  private stats: CoalescerStats = {
    totalRequests: 0,
    deduplicatedRequests: 0,
    deduplicationRate: 0,
    estimatedTokensSaved: 0,
    estimatedCostSavedUsd: 0,
  };

  constructor(config?: Partial<CoalescerEngineConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Submit a request for coalescing. If a near-identical request is
   * already in flight, waits for that result instead of executing a new one.
   */
  async submit(
    prompt: string,
    execute: () => Promise<string>
  ): Promise<string> {
    this.stats.totalRequests++;
    const key = normalizeAndHash(prompt);
    const now = Date.now();

    // Check for existing in-flight request
    const existing = this.pending.get(key);
    if (existing && now - existing.timestamp < this.config.windowMs) {
      // Coalesce with existing request
      this.stats.deduplicatedRequests++;
      this.updateRate();

      const estimatedTokens = Math.ceil(prompt.length / 4);
      this.stats.estimatedTokensSaved += estimatedTokens;
      this.stats.estimatedCostSavedUsd +=
        estimatedTokens * this.config.costPerToken;

      logger.debug(
        { key, waiters: existing.resolvers.length + 1 },
        "Request coalesced with in-flight duplicate"
      );

      // If already resolved, return immediately
      if (existing.response !== null) {
        return existing.response;
      }

      // Wait for the in-flight request
      return new Promise<string>((resolve, reject) => {
        existing.resolvers.push({ resolve, reject });
      });
    }

    // New request - create pending entry
    const entry: PendingEntry = {
      key,
      prompt,
      timestamp: now,
      response: null,
      resolvers: [],
    };
    this.pending.set(key, entry);

    // Enforce max pending
    if (this.pending.size > this.config.maxPending) {
      this.evictOldest();
    }

    try {
      const response = await execute();
      entry.response = response;

      // Resolve all waiters
      for (const waiter of entry.resolvers) {
        waiter.resolve(response);
      }

      // Clean up after window
      setTimeout(() => {
        const current = this.pending.get(key);
        if (current === entry) {
          this.pending.delete(key);
        }
      }, this.config.windowMs);

      return response;
    } catch (error) {
      // Reject all waiters
      for (const waiter of entry.resolvers) {
        waiter.reject(error);
      }
      this.pending.delete(key);
      throw error;
    }
  }

  /**
   * Get coalescing statistics.
   */
  getStats(): CoalescerStats {
    return { ...this.stats };
  }

  /**
   * Reset statistics.
   */
  resetStats(): void {
    this.stats = {
      totalRequests: 0,
      deduplicatedRequests: 0,
      deduplicationRate: 0,
      estimatedTokensSaved: 0,
      estimatedCostSavedUsd: 0,
    };
  }

  /**
   * Get the number of currently pending requests.
   */
  get pendingCount(): number {
    return this.pending.size;
  }

  // ─── Private ────────────────────────────────────────────────────────────

  private updateRate(): void {
    this.stats.deduplicationRate =
      this.stats.totalRequests > 0
        ? this.stats.deduplicatedRequests / this.stats.totalRequests
        : 0;
  }

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Number.POSITIVE_INFINITY;

    for (const [key, entry] of this.pending) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.pending.delete(oldestKey);
    }
  }
}
