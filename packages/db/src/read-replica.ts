import { createLogger } from "@prometheus/logger";
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
