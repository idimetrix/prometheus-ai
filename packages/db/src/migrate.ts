/**
 * Production migration runner.
 * Usage: pnpm db:migrate (runs drizzle-kit migrate)
 *
 * For programmatic migration (e.g., in CI/CD or service startup):
 *   import { runMigrations } from "@prometheus/db/migrate";
 *   await runMigrations();
 */

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

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
