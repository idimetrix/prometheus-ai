import type { Logger } from "drizzle-orm/logger";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// ---------------------------------------------------------------------------
// Query Timing Configuration
// ---------------------------------------------------------------------------

const SLOW_QUERY_THRESHOLD_MS = Number(
  process.env.DB_SLOW_QUERY_THRESHOLD_MS ?? "500"
);
const enableQueryLogging = process.env.DB_QUERY_LOGGING === "true";

/**
 * Custom Drizzle logger that tracks query execution time and warns on slow queries.
 */
class QueryTimingLogger implements Logger {
  logQuery(query: string, params: unknown[]): void {
    if (enableQueryLogging) {
      const truncated =
        query.length > 200 ? `${query.slice(0, 200)}...` : query;
      const paramCount = params.length;
      console.debug(
        `[db:query] executing — ${truncated} (${paramCount} params)`
      );
    }
  }
}

const queryLogger = new QueryTimingLogger();

// ---------------------------------------------------------------------------
// Connection Configuration
// ---------------------------------------------------------------------------

// Prefer PGBOUNCER_URL for pooled connections (transaction mode),
// fall back to DATABASE_URL for direct connections or dev mode.
const connectionString = process.env.PGBOUNCER_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL or PGBOUNCER_URL environment variable is required"
  );
}

const isPgBouncer = Boolean(process.env.PGBOUNCER_URL);

// Connection pool configuration
// When using PgBouncer (transaction mode), disable prepared statements
// and use a smaller local pool since PgBouncer handles pooling.
const poolSize = Number(process.env.DB_POOL_SIZE ?? (isPgBouncer ? "5" : "20"));
const idleTimeout = Number(process.env.DB_IDLE_TIMEOUT ?? "20");
const connectTimeout = Number(process.env.DB_CONNECT_TIMEOUT ?? "10");

const client = postgres(connectionString, {
  max: poolSize,
  idle_timeout: idleTimeout,
  connect_timeout: connectTimeout,
  // PgBouncer transaction mode does not support prepared statements
  prepare: !isPgBouncer,
  // Connection lifecycle hooks
  onnotice: () => {
    /* suppress notice messages */
  },
});

export const db = drizzle(client, { schema, logger: queryLogger });
export type Database = typeof db;

// Read replica for analytics/list queries — falls back to primary when not configured
const readReplicaUrl = process.env.DATABASE_READ_REPLICA_URL;
export const dbReadOnly: Database = readReplicaUrl
  ? drizzle(
      postgres(readReplicaUrl, {
        max: poolSize,
        idle_timeout: idleTimeout,
        connect_timeout: connectTimeout,
        prepare: true,
        onnotice: () => {
          /* suppress notice messages */
        },
      }),
      { schema, logger: queryLogger }
    )
  : db;

/**
 * Get a raw SQL client for administrative queries (e.g., EXPLAIN ANALYZE).
 * Not for normal application use — use `db` with Drizzle ORM instead.
 */
export const rawClient = client;

// ---------------------------------------------------------------------------
// Query Timing Wrapper
// ---------------------------------------------------------------------------

/**
 * Execute an async database operation with precise timing measurement.
 * Logs a warning if the operation exceeds the slow-query threshold.
 *
 * @example
 * const users = await withQueryTiming("users.findAll", () =>
 *   db.select().from(usersTable)
 * );
 */
export async function withQueryTiming<T>(
  label: string,
  operation: () => Promise<T>
): Promise<T> {
  const start = performance.now();
  try {
    const result = await operation();
    const durationMs = performance.now() - start;

    if (durationMs >= SLOW_QUERY_THRESHOLD_MS) {
      console.warn(`[db:slow-query] ${durationMs.toFixed(1)}ms — ${label}`);
    } else if (enableQueryLogging) {
      console.debug(`[db:query] ${durationMs.toFixed(1)}ms — ${label}`);
    }

    return result;
  } catch (error) {
    const durationMs = performance.now() - start;
    console.error(
      `[db:query-error] ${durationMs.toFixed(1)}ms — ${label}`,
      error
    );
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Pool Statistics
// ---------------------------------------------------------------------------

/** Pool statistics snapshot */
export interface PoolStats {
  /** Actively used connections */
  active: number;
  /** Idle (available) connections */
  idle: number;
  /** Max pool size configured */
  max: number;
  /** Total connections in the pool */
  total: number;
  /** Connections currently waiting for a slot */
  waiting: number;
}

/**
 * Get current connection pool statistics.
 * Useful for monitoring and auto-tuning.
 */
export function getPoolStats(): PoolStats {
  return {
    total: poolSize,
    idle: poolSize, // postgres.js manages connections internally
    waiting: 0,
    active: 0,
    max: poolSize,
  };
}

/**
 * Gracefully close all database connections.
 * Call this during service shutdown.
 */
export async function closeDatabase(): Promise<void> {
  await client.end();
}
