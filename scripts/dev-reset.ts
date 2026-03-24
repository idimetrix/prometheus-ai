/**
 * Dev reset script — drops all tables, pushes schema, and seeds data.
 *
 * Usage: tsx scripts/dev-reset.ts
 *
 * This gives you a clean database with sample data in one command.
 * Only works in development mode (NODE_ENV !== "production").
 */

import { execSync } from "node:child_process";

const ROOT = new URL("..", import.meta.url).pathname;

function run(cmd: string, label: string) {
  console.log(`\n  [${label}] ${cmd}\n`);
  try {
    execSync(cmd, { cwd: ROOT, stdio: "inherit" });
  } catch (err) {
    const code =
      err && typeof err === "object" && "status" in err
        ? (err as { status: number }).status
        : 1;
    console.error(`  [${label}] Failed with exit code ${code}`);
    process.exit(code);
  }
}

function main() {
  if (process.env.NODE_ENV === "production") {
    console.error("  dev-reset is not allowed in production!");
    process.exit(1);
  }

  console.log("\n  Prometheus Dev Reset\n");
  console.log("  This will DROP all tables and recreate with seed data.\n");

  run("pnpm db:push --force", "schema-push");
  run("pnpm db:seed", "seed");

  console.log("\n  Dev reset complete!\n");
  console.log("  You can now start services with: pnpm dev\n");
}

main();
