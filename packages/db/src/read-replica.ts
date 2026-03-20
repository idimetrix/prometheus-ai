import { createLogger } from "@prometheus/logger";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
// biome-ignore lint/performance/noNamespaceImport: Drizzle ORM requires namespace import for schema
import * as schema from "./schema";

const logger = createLogger("read-replica");

/**
 * Read-only database pool backed by DATABASE_READ_URL when available.
 *
 * In production, route read-heavy queries (dashboards, list views, analytics)
 * through the read replica to reduce load on the primary. When the env var
 * is not set the pool transparently falls back to the primary connection so
 * calling code does not need conditional logic.
 */

const readUrl = process.env.DATABASE_READ_URL;
const primaryUrl = process.env.DATABASE_URL;

const poolSize = Number(
  process.env.DB_READ_POOL_SIZE ?? process.env.DB_POOL_SIZE ?? "20"
);
const idleTimeout = Number(process.env.DB_IDLE_TIMEOUT ?? "20");
const connectTimeout = Number(process.env.DB_CONNECT_TIMEOUT ?? "10");

let readPool: ReturnType<typeof drizzle> | undefined;

/**
 * Returns a Drizzle ORM instance connected to the read replica.
 * Falls back to the primary database when DATABASE_READ_URL is not configured.
 *
 * The pool is created lazily on first call and reused for the lifetime of the process.
 */
export function getReadPool(): ReturnType<typeof drizzle> {
  if (readPool) {
    return readPool;
  }

  const connectionUrl = readUrl ?? primaryUrl;

  if (!connectionUrl) {
    throw new Error(
      "Neither DATABASE_READ_URL nor DATABASE_URL is configured. " +
        "At least one database connection string is required."
    );
  }

  if (readUrl) {
    logger.info("Initializing read replica pool from DATABASE_READ_URL");
  } else {
    logger.info(
      "DATABASE_READ_URL not set — read pool will use primary DATABASE_URL"
    );
  }

  const client = postgres(connectionUrl, {
    max: poolSize,
    idle_timeout: idleTimeout,
    connect_timeout: connectTimeout,
    prepare: true,
    onnotice: () => {
      /* suppress notice messages */
    },
  });

  readPool = drizzle(client, { schema });
  return readPool;
}

/**
 * Returns true when a dedicated read replica URL is configured,
 * indicating queries will be routed to a separate database instance.
 */
export function isReadReplicaAvailable(): boolean {
  return typeof readUrl === "string" && readUrl.length > 0;
}

// ─── Read/Write Auto-Router ───────────────────────────────────────────────────

/** Maximum acceptable replication lag in seconds before falling back to primary */
const MAX_LAG_SECONDS = 5;

let lastLagCheckMs = 0;
let currentLagSeconds = 0;
const LAG_CHECK_INTERVAL_MS = 10_000; // Check lag every 10s

/**
 * Returns the appropriate database connection for read operations.
 *
 * Auto-routes to the read replica when available and replication lag is
 * within acceptable bounds (< 5s). Falls back to primary when the replica
 * is lagging or unavailable.
 *
 * For write operations, always use `getWriteDb()`.
 */
export function getReadDb(): ReturnType<typeof drizzle> {
  if (!isReadReplicaAvailable()) {
    return getWriteDb();
  }

  // Check lag periodically
  const now = Date.now();
  if (now - lastLagCheckMs > LAG_CHECK_INTERVAL_MS) {
    lastLagCheckMs = now;
    checkReplicationLag().catch(() => {
      // Non-blocking lag check
    });
  }

  // Fall back to primary if lag exceeds threshold
  if (currentLagSeconds > MAX_LAG_SECONDS) {
    logger.warn(
      { lagSeconds: currentLagSeconds, threshold: MAX_LAG_SECONDS },
      "Read replica lag too high, routing to primary"
    );
    return getWriteDb();
  }

  return getReadPool();
}

/**
 * Returns the primary (write) database connection.
 *
 * Always use this for INSERT, UPDATE, DELETE operations.
 */
export function getWriteDb(): ReturnType<typeof drizzle> {
  // Import lazily to avoid circular dependency
  const { db } = require("./client") as { db: ReturnType<typeof drizzle> };
  return db;
}

/**
 * Get the current replication lag in seconds.
 */
export function getReplicationLag(): number {
  return currentLagSeconds;
}

/**
 * Check replication lag by querying the replica.
 * This is called periodically and non-blocking.
 */
async function checkReplicationLag(): Promise<void> {
  if (!isReadReplicaAvailable()) {
    currentLagSeconds = 0;
    return;
  }

  try {
    const pool = getReadPool();
    const result = await pool.execute(
      sql.raw(
        "SELECT CASE WHEN pg_last_wal_receive_lsn() = pg_last_wal_replay_lsn() THEN 0 ELSE EXTRACT(EPOCH FROM now() - pg_last_xact_replay_timestamp())::integer END AS lag_seconds"
      )
    );

    const lagRow = (result as unknown as Array<{ lag_seconds: number }>)[0];
    currentLagSeconds = lagRow?.lag_seconds ?? 0;

    if (currentLagSeconds > 0) {
      logger.debug(
        { lagSeconds: currentLagSeconds },
        "Read replica replication lag"
      );
    }
  } catch {
    // If we can't check lag, assume it's OK (fail open for reads)
    currentLagSeconds = 0;
  }
}

// ─── ReadReplicaRouter ────────────────────────────────────────────────────────

/** Replica health status */
export interface ReplicaStatus {
  available: boolean;
  lagSeconds: number;
  lastCheckedAt: Date;
}

/**
 * ReadReplicaRouter provides explicit read/write routing for database queries.
 *
 * Read queries are sent to the replica when available and healthy.
 * Write queries always go to the primary.
 * Automatic fallback to primary when the replica is down or lagging.
 */
export class ReadReplicaRouter {
  /**
   * Route a query to the appropriate connection based on query type.
   */
  routeQuery(queryType: "read" | "write"): ReturnType<typeof drizzle> {
    if (queryType === "write") {
      return getWriteDb();
    }

    return getReadDb();
  }

  /**
   * Get the health status of the read replica.
   */
  getReplicaStatus(): ReplicaStatus {
    return {
      available: isReadReplicaAvailable(),
      lagSeconds: getReplicationLag(),
      lastCheckedAt: new Date(lastLagCheckMs || Date.now()),
    };
  }

  /**
   * Force a replication lag check (non-blocking).
   */
  async refreshReplicaStatus(): Promise<ReplicaStatus> {
    await checkReplicationLag();
    return this.getReplicaStatus();
  }
}
