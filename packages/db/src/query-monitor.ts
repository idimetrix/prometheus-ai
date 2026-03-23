import { createLogger } from "@prometheus/logger";
import { Counter, Histogram } from "prom-client";

const logger = createLogger("query-monitor");

const FROM_TABLE_RE = /FROM\s+["']?(\w+)["']?/i;

// --- Prometheus Metrics ---

export const dbQueryDuration = new Histogram({
  name: "prometheus_db_query_duration_seconds",
  help: "Database query duration in seconds",
  labelNames: ["operation", "table"] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});

export const dbQueryTotal = new Counter({
  name: "prometheus_db_query_total",
  help: "Total database queries",
  labelNames: ["operation", "table", "status"] as const,
});

export const dbSlowQueryTotal = new Counter({
  name: "prometheus_db_slow_query_total",
  help: "Total slow database queries",
  labelNames: ["operation", "table"] as const,
});

// --- Constants ---

export const SLOW_QUERY_THRESHOLD_MS = 100;

// --- Interfaces ---

export interface SlowQueryInfo {
  durationMs: number;
  operation: string;
  query: string;
  table: string;
}

export interface QueryMonitorOptions {
  logAllQueries?: boolean;
  onSlowQuery?: (info: SlowQueryInfo) => void;
  slowQueryThresholdMs?: number;
}

// --- Core monitoring wrapper ---

export async function withQueryMonitoring<T>(
  operation: string,
  table: string,
  queryFn: () => Promise<T>,
  options?: QueryMonitorOptions
): Promise<T> {
  const threshold = options?.slowQueryThresholdMs ?? SLOW_QUERY_THRESHOLD_MS;
  const startTime = performance.now();

  try {
    const result = await queryFn();
    const durationMs = performance.now() - startTime;
    const durationSeconds = durationMs / 1000;

    dbQueryDuration.labels(operation, table).observe(durationSeconds);
    dbQueryTotal.labels(operation, table, "success").inc();

    if (options?.logAllQueries) {
      logger.debug({ operation, table, durationMs }, "Query executed");
    }

    if (durationMs > threshold) {
      dbSlowQueryTotal.labels(operation, table).inc();
      logger.warn(
        { operation, table, durationMs, threshold },
        "Slow query detected"
      );

      options?.onSlowQuery?.({
        durationMs,
        operation,
        table,
        query: `${operation} on ${table}`,
      });
    }

    return result;
  } catch (error) {
    const durationMs = performance.now() - startTime;
    const durationSeconds = durationMs / 1000;

    dbQueryDuration.labels(operation, table).observe(durationSeconds);
    dbQueryTotal.labels(operation, table, "error").inc();

    logger.error({ operation, table, durationMs }, "Query failed");

    throw error;
  }
}

// --- Convenience factory ---

export function createMonitoredQuery(options?: QueryMonitorOptions) {
  return {
    select<T>(table: string, fn: () => Promise<T>): Promise<T> {
      return withQueryMonitoring("select", table, fn, options);
    },
    insert<T>(table: string, fn: () => Promise<T>): Promise<T> {
      return withQueryMonitoring("insert", table, fn, options);
    },
    update<T>(table: string, fn: () => Promise<T>): Promise<T> {
      return withQueryMonitoring("update", table, fn, options);
    },
    delete<T>(table: string, fn: () => Promise<T>): Promise<T> {
      return withQueryMonitoring("delete", table, fn, options);
    },
  };
}

// --- QueryMonitor class ---

/** Recorded query entry for analysis */
interface RecordedQuery {
  durationMs: number;
  rowCount: number;
  sql: string;
  timestamp: Date;
}

/** Aggregated query statistics */
export interface QueryStats {
  avgDurationMs: number;
  maxDurationMs: number;
  p95DurationMs: number;
  totalQueries: number;
  totalRowsReturned: number;
}

/** Index recommendation */
export interface IndexRecommendation {
  columns: string[];
  estimatedImpact: "low" | "medium" | "high";
  reason: string;
  table: string;
}

/**
 * QueryMonitor records and analyzes query performance to identify
 * slow queries and suggest optimizations.
 */
export class QueryMonitor {
  private readonly queries: RecordedQuery[] = [];
  private readonly maxHistory: number;

  constructor(maxHistory = 10_000) {
    this.maxHistory = maxHistory;
  }

  /**
   * Record a query for analysis.
   */
  recordQuery(sql: string, duration: number, rowCount: number): void {
    this.queries.push({
      sql,
      durationMs: duration,
      rowCount,
      timestamp: new Date(),
    });

    if (this.queries.length > this.maxHistory) {
      this.queries.shift();
    }
  }

  /**
   * Get queries that exceeded a given duration threshold.
   */
  getSlowQueries(thresholdMs: number): RecordedQuery[] {
    return this.queries
      .filter((q) => q.durationMs > thresholdMs)
      .sort((a, b) => b.durationMs - a.durationMs);
  }

  /**
   * Suggest indexes based on recorded query patterns.
   */
  suggestIndexes(): IndexRecommendation[] {
    const recommendations: IndexRecommendation[] = [];
    const tableQueryCounts = new Map<string, number>();
    const tableSlowCounts = new Map<string, number>();

    for (const query of this.queries) {
      const fromMatch = query.sql.match(FROM_TABLE_RE);
      const table = fromMatch?.[1];
      if (!table) {
        continue;
      }

      tableQueryCounts.set(table, (tableQueryCounts.get(table) ?? 0) + 1);
      if (query.durationMs > SLOW_QUERY_THRESHOLD_MS) {
        tableSlowCounts.set(table, (tableSlowCounts.get(table) ?? 0) + 1);
      }
    }

    for (const [table, slowCount] of tableSlowCounts) {
      const totalCount = tableQueryCounts.get(table) ?? 0;
      if (totalCount < 5) {
        continue;
      }

      const slowRatio = slowCount / totalCount;
      if (slowRatio > 0.3) {
        const whereColumns = this.extractWhereColumns(table);
        if (whereColumns.length > 0) {
          recommendations.push({
            table,
            columns: whereColumns,
            reason: `${(slowRatio * 100).toFixed(0)}% of queries on "${table}" are slow (${slowCount}/${totalCount})`,
            estimatedImpact: slowRatio > 0.5 ? "high" : "medium",
          });
        }
      }
    }

    return recommendations;
  }

  /**
   * Get aggregated query statistics.
   */
  getQueryStats(): QueryStats {
    if (this.queries.length === 0) {
      return {
        totalQueries: 0,
        avgDurationMs: 0,
        maxDurationMs: 0,
        p95DurationMs: 0,
        totalRowsReturned: 0,
      };
    }

    const durations = this.queries.map((q) => q.durationMs);
    const sorted = [...durations].sort((a, b) => a - b);
    const sum = sorted.reduce((acc, v) => acc + v, 0);
    const totalRows = this.queries.reduce((acc, q) => acc + q.rowCount, 0);
    const p95Index = Math.ceil(sorted.length * 0.95) - 1;

    return {
      totalQueries: this.queries.length,
      avgDurationMs: Math.round(sum / this.queries.length),
      maxDurationMs: sorted.at(-1) ?? 0,
      p95DurationMs: sorted[Math.max(0, p95Index)] ?? 0,
      totalRowsReturned: totalRows,
    };
  }

  // ─── Private helpers ───────────────────────────────────────────────

  private extractWhereColumns(table: string): string[] {
    const columns = new Map<string, number>();

    for (const query of this.queries) {
      if (!query.sql.includes(table)) {
        continue;
      }

      const wherePattern = /WHERE\s+["']?(\w+)["']?\s*(?:=|IN|>|<|LIKE)/gi;
      let match: RegExpExecArray | null = null;

      for (;;) {
        match = wherePattern.exec(query.sql);
        if (!match) {
          break;
        }
        const col = match[1];
        if (col) {
          columns.set(col, (columns.get(col) ?? 0) + 1);
        }
      }
    }

    return Array.from(columns.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([col]) => col);
  }
}
