/**
 * Production migration runner.
 * Usage: pnpm db:migrate (runs drizzle-kit migrate)
 *
 * For programmatic migration (e.g., in CI/CD or service startup):
 *   import { runMigrations } from "@prometheus/db/migrate";
 *   await runMigrations();
 *
 * Migration order:
 * 1. PostgreSQL extensions (pgvector, pg_trgm) — required before embedding tables
 * 2. Drizzle schema migrations (enums, tables, indexes in dependency order)
 * 3. Custom post-migration SQL (partitioning, materialized views, HNSW tuning)
 */

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/**
 * Ensure required PostgreSQL extensions are installed before schema migrations.
 * Must run before any tables that use vector columns or trigram indexes.
 */
async function ensureExtensions(client: postgres.Sql): Promise<void> {
  console.log("Ensuring required PostgreSQL extensions...");
  await client`CREATE EXTENSION IF NOT EXISTS vector`;
  await client`CREATE EXTENSION IF NOT EXISTS pg_trgm`;
  console.log("Extensions ready (vector, pg_trgm).");
}

export async function runMigrations(databaseUrl?: string) {
  const url = databaseUrl ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  console.log("Running database migrations...");

  // Use a separate connection for migrations (max 1 connection)
  const migrationClient = postgres(url, { max: 1 });
  const db = drizzle(migrationClient);

  try {
    // Step 1: Install extensions before any schema migration
    await ensureExtensions(migrationClient);

    // Step 2: Run Drizzle schema migrations (enums + tables in dependency order)
    await migrate(db, { migrationsFolder: "./drizzle" });
    console.log("Migrations completed successfully.");
  } catch (error) {
    console.error("Migration failed:", error);
    throw error;
  } finally {
    await migrationClient.end();
  }
}

// Run directly if called as script
if (
  process.argv[1]?.endsWith("migrate.ts") ||
  process.argv[1]?.endsWith("migrate.js")
) {
  runMigrations()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
