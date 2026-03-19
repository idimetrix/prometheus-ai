#!/usr/bin/env tsx

/**
 * Scaffolds a new Drizzle ORM database table schema file.
 *
 * Usage: pnpm gen:table <table-name>
 * Example: pnpm gen:table notifications
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const name = process.argv[2];

if (!name) {
  console.error("Usage: pnpm gen:table <table-name>");
  console.error("Example: pnpm gen:table notifications");
  process.exit(1);
}

// Convert kebab-case to snake_case for SQL and camelCase for JS
const snakeName = name.replace(/-/g, "_");
const camelName = name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

const tablesDir = resolve(
  process.cwd(),
  "packages",
  "db",
  "src",
  "schema",
  "tables",
  name
);

if (!existsSync(tablesDir)) {
  mkdirSync(tablesDir, { recursive: true });
}

const schemaPath = resolve(tablesDir, `${name}.ts`);
const indexPath = resolve(tablesDir, "index.ts");

if (existsSync(schemaPath)) {
  console.error(`Table schema file already exists: ${schemaPath}`);
  process.exit(1);
}

const schemaContent = `import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { organizations } from "../organizations/organizations";

export const ${camelName} = pgTable(
  "${snakeName}",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("${snakeName}_org_id_idx").on(table.orgId),
  ]
);
`;

const indexContent = `export { ${camelName} } from "./${name}";
`;

writeFileSync(schemaPath, schemaContent);
writeFileSync(indexPath, indexContent);

console.log(`Created table schema: ${schemaPath}`);
console.log(`Created index file: ${indexPath}`);
console.log("");
console.log("Next steps:");
console.log("  1. Add columns and indexes to the schema");
console.log("  2. Export from packages/db/src/schema/tables/index.ts");
console.log("  3. Run `pnpm db:generate` to create a migration");
console.log("  4. Run `pnpm db:push` (dev) or `pnpm db:migrate` (prod)");
