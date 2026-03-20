import { createLogger } from "@prometheus/logger";
import { createRedisConnection } from "@prometheus/queue";
import type IORedis from "ioredis";

const logger = createLogger("model-router:request-coalescer");

// ─── Types ────────────────────────────────────────────────────────────────────

interface PendingRequest<T> {
  createdAt: number;
  promise: Promise<T>;
  reject: (error: unknown) => void;
  resolve: (value: T) => void;
}

// ─── Request Coalescer ────────────────────────────────────────────────────────

/**
 * Deduplicates identical in-flight requests.
 *
 * When multiple callers request the same key simultaneously, only one
 * request executes and the result is shared with all waiters.
 *
 * Uses an in-memory map with optional Redis-backed distributed locking
 * for cross-replica deduplication.
 */
export class RequestCoalescer {
  private readonly pending = new Map<string, PendingRequest<unknown>>();
  private readonly ttlMs: number;
  private redis: IORedis | null = null;
  private readonly redisKeyPrefix = "req-coalesce:";
  private readonly instanceId =
    `inst_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  /**
   * @param ttlMs - Maximum time a coalesced entry stays valid (default: 30s)
   * @param enableDistributed - Enable Redis-backed distributed locking (default: false)
   */
  constructor(ttlMs = 30_000, enableDistributed = false) {
    this.ttlMs = ttlMs;

    if (enableDistributed) {
      try {
        this.redis = createRedisConnection();
        this.redis.on("error", (err) => {
          logger.warn(
            { err: String(err) },
            "Redis distributed lock connection error"
          );
          this.redis = null;
        });
      } catch {
        logger.debug("Redis not available for distributed request coalescing");
      }
    }
  }

  /**
   * Execute a function with request coalescing.
   *
   * If another call with the same key is already in flight (locally or
   * across replicas when distributed mode is enabled), this call will
   * wait for and share the result of the existing call.
   *
   * @param key - Deduplication key (e.g., hash of the request)
   * @param fn - The function to execute if no existing call is in flight
   */
  async coalesce<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.pending.get(key) as PendingRequest<T> | undefined;

    if (existing && Date.now() - existing.createdAt < this.ttlMs) {
      logger.debug({ key }, "Request coalesced with in-flight request");
      return existing.promise;
    }

    // Try to acquire distributed lock if Redis is available
    const lockAcquired = await this.tryAcquireDistributedLock(key);
    if (!lockAcquired) {
      // Another replica is handling this request; poll for the result
      logger.debug(
        { key },
        "Request coalesced with cross-replica in-flight request"
      );
      return this.waitForDistributedResult<T>(key);
    }

    let resolveFn: (value: T) => void;
    let rejectFn: (error: unknown) => void;

    const promise = new Promise<T>((resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;
    });

    const entry: PendingRequest<T> = {
      promise,
      // biome-ignore lint/style/noNonNullAssertion: assigned in Promise constructor
      resolve: resolveFn!,
      // biome-ignore lint/style/noNonNullAssertion: assigned in Promise constructor
      reject: rejectFn!,
      createdAt: Date.now(),
    };

    this.pending.set(key, entry as PendingRequest<unknown>);

    try {
      const result = await fn();
      entry.resolve(result);
      await this.setDistributedResult(key, result);
      return result;
    } catch (error) {
      entry.reject(error);
      await this.releaseDistributedLock(key);
      throw error;
    } finally {
      // Clean up after a short delay to handle late arrivals
      setTimeout(() => {
        const current = this.pending.get(key);
        if (current === (entry as PendingRequest<unknown>)) {
          this.pending.delete(key);
        }
        this.releaseDistributedLock(key).catch(() => {
          /* fire-and-forget */
        });
      }, 100);
    }
  }

  /**
   * Get the number of currently in-flight coalesced requests.
   */
  get pendingCount(): number {
    return this.pending.size;
  }

  /**
   * Clear all pending entries. Useful for shutdown.
   */
  clear(): void {
    this.pending.clear();
  }

  // ─── Distributed Lock Helpers ─────────────────────────────────────

  /**
   * Try to acquire a distributed lock via Redis SET NX.
   * Returns true if this instance acquired the lock, false otherwise.
   */
  private async tryAcquireDistributedLock(key: string): Promise<boolean> {
    if (!this.redis) {
      return true; // No Redis = always proceed locally
    }
    try {
      const lockKey = `${this.redisKeyPrefix}lock:${key}`;
      const ttlSeconds = Math.ceil(this.ttlMs / 1000);
      const result = await this.redis.set(
        lockKey,
        this.instanceId,
        "EX",
        ttlSeconds,
        "NX"
      );
      return result === "OK";
    } catch {
      return true; // Redis failure = fall back to local-only
    }
  }

  /**
   * Release the distributed lock if this instance owns it.
   */
  private async releaseDistributedLock(key: string): Promise<void> {
    if (!this.redis) {
      return;
    }
    try {
      const lockKey = `${this.redisKeyPrefix}lock:${key}`;
      const owner = await this.redis.get(lockKey);
      if (owner === this.instanceId) {
        await this.redis.del(lockKey);
      }
    } catch {
      // Ignore Redis errors during cleanup
    }
  }

  /**
   * Store the result of a coalesced request in Redis so other replicas
   * polling for the result can retrieve it.
   */
  private async setDistributedResult<T>(key: string, result: T): Promise<void> {
    if (!this.redis) {
      return;
    }
    try {
      const resultKey = `${this.redisKeyPrefix}result:${key}`;
      const ttlSeconds = Math.ceil(this.ttlMs / 1000);
      await this.redis.set(resultKey, JSON.stringify(result), "EX", ttlSeconds);
    } catch {
      // Ignore Redis write errors
    }
  }

  /**
   * Poll Redis for the result of a request being handled by another replica.
   * Falls back to executing the function locally if the result never appears.
   */
  private async waitForDistributedResult<T>(key: string): Promise<T> {
    if (!this.redis) {
      throw new Error("No Redis available for distributed result");
    }

    const resultKey = `${this.redisKeyPrefix}result:${key}`;
    const maxWaitMs = this.ttlMs;
    const pollIntervalMs = 50;
    const start = Date.now();

    while (Date.now() - start < maxWaitMs) {
      try {
        const data = await this.redis.get(resultKey);
        if (data) {
          return JSON.parse(data) as T;
        }
      } catch {
        break; // Redis failure, bail out
      }
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }

    throw new Error(
      `Distributed result for key "${key}" not available within timeout`
    );
  }
}

// ─── Embedding Coalescer ─────────────────────────────────────────────────────

interface EmbeddingRequest {
  input: string;
  reject: (error: unknown) => void;
  resolve: (value: number[]) => void;
}

/**
 * Accumulates individual embedding requests over a short time window and
 * batches them into a single API call, fanning out the results to individual
 * callers.
 *
 * This dramatically reduces API round-trips when many embedding requests
 * arrive in quick succession (e.g., during document ingestion).
 */
export class EmbeddingCoalescer {
  private batch: EmbeddingRequest[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly windowMs: number;
  private readonly maxBatchSize: number;
  private readonly executeBatch: (inputs: string[]) => Promise<number[][]>;

  /**
   * @param executeBatch - Function that sends a batch of texts to the embedding API
   *                       and returns an array of embedding vectors (one per input).
   * @param options.windowMs - Accumulation window in ms (default: 50)
   * @param options.maxBatchSize - Flush immediately when this many requests queued (default: 100)
   */
  constructor(
    executeBatch: (inputs: string[]) => Promise<number[][]>,
    options?: { windowMs?: number; maxBatchSize?: number }
  ) {
    this.executeBatch = executeBatch;
    this.windowMs = options?.windowMs ?? 50;
    this.maxBatchSize = options?.maxBatchSize ?? 100;
  }

  /**
   * Queue a single embedding request. Returns a promise that resolves
   * with the embedding vector once the batch is flushed.
   */
  embed(input: string): Promise<number[]> {
    let resolveFn: (value: number[]) => void;
    let rejectFn: (error: unknown) => void;

    const promise = new Promise<number[]>((resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;
    });

    this.batch.push({
      input,
      // biome-ignore lint/style/noNonNullAssertion: assigned in Promise constructor
      resolve: resolveFn!,
      // biome-ignore lint/style/noNonNullAssertion: assigned in Promise constructor
      reject: rejectFn!,
    });

    // Flush immediately when max batch size reached
    if (this.batch.length >= this.maxBatchSize) {
      this.flush();
    } else if (!this.flushTimer) {
      // Start the accumulation window timer
      this.flushTimer = setTimeout(() => {
        this.flush();
      }, this.windowMs);
    }

    return promise;
  }

  /**
   * Immediately flush all queued requests as a single batch.
   */
  flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    const currentBatch = this.batch;
    this.batch = [];

    if (currentBatch.length === 0) {
      return;
    }

    const inputs = currentBatch.map((req) => req.input);

    logger.debug(
      { batchSize: currentBatch.length },
      "Flushing embedding batch"
    );

    this.executeBatch(inputs)
      .then((results) => {
        for (let i = 0; i < currentBatch.length; i++) {
          const request = currentBatch[i] as EmbeddingRequest;
          const result = results[i];
          if (result) {
            request.resolve(result);
          } else {
            request.reject(new Error(`No embedding result for index ${i}`));
          }
        }
      })
      .catch((error: unknown) => {
        for (const request of currentBatch) {
          request.reject(error);
        }
      });
  }

  /**
   * Get the number of requests currently queued.
   */
  get pendingCount(): number {
    return this.batch.length;
  }

  /**
   * Dispose of the coalescer, rejecting any pending requests.
   */
  dispose(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    const remaining = this.batch;
    this.batch = [];

    for (const request of remaining) {
      request.reject(new Error("EmbeddingCoalescer disposed"));
    }
  }
}
