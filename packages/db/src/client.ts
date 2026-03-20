import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
// biome-ignore lint/performance/noNamespaceImport: Drizzle ORM requires namespace import for schema
import * as schema from "./schema";

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

export const db = drizzle(client, { schema });
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
      { schema }
    )
  : db;

/**
 * Get a raw SQL client for administrative queries (e.g., EXPLAIN ANALYZE).
 * Not for normal application use — use `db` with Drizzle ORM instead.
 */
export const rawClient = client;

/**
 * Gracefully close all database connections.
 * Call this during service shutdown.
 */
export async function closeDatabase(): Promise<void> {
  await client.end();
}
