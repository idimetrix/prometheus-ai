import { createLogger } from "@prometheus/logger";

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
 * Uses an in-memory map. For distributed deployments, back with Redis locks.
 */
export class RequestCoalescer {
  private readonly pending = new Map<string, PendingRequest<unknown>>();
  private readonly ttlMs: number;

  /**
   * @param ttlMs - Maximum time a coalesced entry stays valid (default: 30s)
   */
  constructor(ttlMs = 30_000) {
    this.ttlMs = ttlMs;
  }

  /**
   * Execute a function with request coalescing.
   *
   * If another call with the same key is already in flight, this call
   * will wait for and share the result of the existing call.
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
      return result;
    } catch (error) {
      entry.reject(error);
      throw error;
    } finally {
      // Clean up after a short delay to handle late arrivals
      setTimeout(() => {
        const current = this.pending.get(key);
        if (current === (entry as PendingRequest<unknown>)) {
          this.pending.delete(key);
        }
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
