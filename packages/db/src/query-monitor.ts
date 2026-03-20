import { createLogger } from "@prometheus/logger";
import { Counter, Histogram } from "prom-client";

const logger = createLogger("query-monitor");

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
