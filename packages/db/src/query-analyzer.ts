import { createLogger } from "@prometheus/logger";

const logger = createLogger("query-analyzer");

/**
 * Tracks SQL query count per request to detect N+1 query patterns.
 *
 * Wrap a request handler with `QueryAnalyzer.wrapRequest()` to automatically
 * log warnings when the query count exceeds the configured threshold.
 *
 * @example
 * ```ts
 * const result = await QueryAnalyzer.wrapRequest(requestId, async () => {
 *   // ... handler code that runs DB queries ...
 * });
 * ```
 */
export class QueryAnalyzer {
  private queryCount = 0;
  private readonly queries: string[] = [];
  private readonly threshold: number;
  private readonly requestId: string;

  private static readonly DEFAULT_THRESHOLD = 10;

  /** Per-request analyzers keyed by requestId for async-local lookup */
  private static activeAnalyzers = new Map<string, QueryAnalyzer>();

  constructor(requestId: string, threshold?: number) {
    this.requestId = requestId;
    this.threshold = threshold ?? QueryAnalyzer.DEFAULT_THRESHOLD;
  }

  /**
   * Record a SQL query execution. If the running count exceeds the threshold,
   * a warning is logged with the query text and current count.
   */
  recordQuery(sql: string): void {
    this.queryCount++;
    this.queries.push(sql);

    if (this.queryCount > this.threshold) {
      logger.warn(
        {
          requestId: this.requestId,
          queryCount: this.queryCount,
          threshold: this.threshold,
          latestQuery: sql.slice(0, 200),
          possibleNPlusOne: true,
        },
        `N+1 query detected: ${this.queryCount} queries in request ${this.requestId} (threshold: ${this.threshold})`
      );
    }
  }

  /** Returns the total number of queries recorded so far. */
  getQueryCount(): number {
    return this.queryCount;
  }

  /** Returns a copy of all recorded query strings. */
  getQueries(): string[] {
    return [...this.queries];
  }

  /** Reset the counter and recorded queries. */
  reset(): void {
    this.queryCount = 0;
    this.queries.length = 0;
  }

  /**
   * Look up the active analyzer for a request. Returns undefined if
   * no analyzer is registered for the given requestId.
   */
  static getAnalyzer(requestId: string): QueryAnalyzer | undefined {
    return QueryAnalyzer.activeAnalyzers.get(requestId);
  }

  /**
   * Wrap an async function with automatic query counting and N+1 detection.
   *
   * Creates a `QueryAnalyzer` for the duration of the function, registers it
   * as the active analyzer for the given `requestId`, and logs a summary on
   * completion.
   *
   * @param requestId  Unique identifier for the request / operation
   * @param fn         The async work to execute
   * @param threshold  Optional query-count threshold (default 10)
   * @returns The return value of `fn`
   */
  static async wrapRequest<T>(
    requestId: string,
    fn: () => Promise<T>,
    threshold?: number
  ): Promise<T> {
    const analyzer = new QueryAnalyzer(requestId, threshold);
    QueryAnalyzer.activeAnalyzers.set(requestId, analyzer);

    try {
      const result = await fn();

      const count = analyzer.getQueryCount();
      if (count > 0) {
        const level = count > analyzer.threshold ? "warn" : "debug";
        logger[level](
          {
            requestId,
            totalQueries: count,
            threshold: analyzer.threshold,
            exceededThreshold: count > analyzer.threshold,
          },
          `Request ${requestId} executed ${count} queries`
        );
      }

      return result;
    } finally {
      QueryAnalyzer.activeAnalyzers.delete(requestId);
    }
  }
}
