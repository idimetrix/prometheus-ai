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
