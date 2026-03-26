/**
 * Ensures required PostgreSQL extensions are installed.
 * Must run before drizzle-kit push/migrate so that vector columns
 * and trigram indexes can be created.
 *
 * Usage: tsx src/ensure-extensions.ts
 */

import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

const client = postgres(url, { max: 1 });

async function main(): Promise<void> {
  console.log("Ensuring PostgreSQL extensions...");
  await client`CREATE EXTENSION IF NOT EXISTS vector`;
  await client`CREATE EXTENSION IF NOT EXISTS pg_trgm`;
  console.log("Extensions ready: vector, pg_trgm");
  await client.end();
}

main().catch(async (err: unknown) => {
  console.error("Failed to create extensions:", err);
  await client.end();
  process.exit(1);
});
