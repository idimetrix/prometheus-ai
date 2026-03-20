import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createLogger } from "@prometheus/logger";

const logger = createLogger("db:check-migration-safety");

export interface MigrationViolation {
  description: string;
  file: string;
  line: number;
  pattern: string;
  severity: "error" | "warning";
}

export interface MigrationWarning {
  description: string;
  file: string;
}

export interface MigrationSafetyResult {
  safe: boolean;
  violations: MigrationViolation[];
  warnings: MigrationWarning[];
}

interface DestructivePattern {
  description: string;
  /** Optional additional check to refine the match */
  refine?: (line: string) => boolean;
  regex: RegExp;
  severity: "error" | "warning";
}

const WHERE_CLAUSE_PATTERN = /\bWHERE\b/i;
const DEFAULT_CLAUSE_PATTERN = /\bDEFAULT\b/i;

const DESTRUCTIVE_PATTERNS: DestructivePattern[] = [
  {
    regex: /\bDROP\s+TABLE\b/i,
    description: "DROP TABLE removes the table and all its data permanently",
    severity: "error",
  },
  {
    regex: /\bDROP\s+COLUMN\b/i,
    description: "DROP COLUMN removes the column and all its data permanently",
    severity: "error",
  },
  {
    regex: /\bDROP\s+INDEX\b/i,
    description: "DROP INDEX removes the index permanently",
    severity: "error",
  },
  {
    regex: /\bALTER\s+TABLE\s+\S+\s+RENAME\b/i,
    description: "RENAME may break existing queries and application references",
    severity: "warning",
  },
  {
    regex: /\bTRUNCATE\b/i,
    description: "TRUNCATE removes all rows from the table",
    severity: "error",
  },
  {
    regex: /\bDELETE\s+FROM\b/i,
    description: "DELETE FROM without WHERE clause removes all rows",
    severity: "error",
    refine: (line: string) => !WHERE_CLAUSE_PATTERN.test(line),
  },
  {
    regex: /\bALTER\s+TABLE\s+\S+\s+ALTER\s+COLUMN\s+\S+\s+TYPE\b/i,
    description:
      "Column type change may require an exclusive lock and block reads/writes",
    severity: "warning",
  },
  {
    regex: /\bDROP\s+NOT\s+NULL\b/i,
    description:
      "Dropping NOT NULL constraint may allow unexpected NULL values",
    severity: "warning",
  },
  {
    regex: /\bSET\s+NOT\s+NULL\b/i,
    description:
      "Adding NOT NULL without a default value fails if existing rows contain NULLs",
    severity: "error",
    refine: (line: string) => !DEFAULT_CLAUSE_PATTERN.test(line),
  },
];

/**
 * Scans migration SQL files for destructive or risky patterns.
 *
 * @param migrationsDir - Path to the directory containing `.sql` migration files.
 *   Defaults to `./drizzle`.
 */
export async function checkMigrationSafety(
  migrationsDir = "./drizzle"
): Promise<MigrationSafetyResult> {
  const violations: MigrationViolation[] = [];
  const warnings: MigrationWarning[] = [];

  let files: string[];
  try {
    const entries = await readdir(migrationsDir);
    files = entries.filter((f) => f.endsWith(".sql")).sort();
  } catch {
    logger.info(
      { migrationsDir },
      "Migrations directory not found — nothing to check"
    );
    return { safe: true, violations, warnings };
  }

  if (files.length === 0) {
    logger.info({ migrationsDir }, "No SQL migration files found");
    return { safe: true, violations, warnings };
  }

  for (const file of files) {
    const filePath = join(migrationsDir, file);
    const content = await readFile(filePath, "utf-8");
    const lines = content.split("\n");

    for (const [index, line] of lines.entries()) {
      const trimmed = line.trim();

      // Skip empty lines and SQL comments
      if (trimmed === "" || trimmed.startsWith("--")) {
        continue;
      }

      for (const pattern of DESTRUCTIVE_PATTERNS) {
        if (!pattern.regex.test(trimmed)) {
          continue;
        }

        // Apply optional refinement check
        if (pattern.refine && !pattern.refine(trimmed)) {
          continue;
        }

        const violation: MigrationViolation = {
          file,
          line: index + 1,
          pattern: pattern.regex.source,
          description: pattern.description,
          severity: pattern.severity,
        };

        violations.push(violation);

        if (pattern.severity === "warning") {
          warnings.push({ file, description: pattern.description });
        }
      }
    }
  }

  const hasErrors = violations.some((v) => v.severity === "error");

  return {
    safe: !hasErrors,
    violations,
    warnings,
  };
}

/**
 * Runs the migration safety check, logs results, and exits with code 1
 * if any error-severity violations are found.
 */
export async function runMigrationSafetyCheck(): Promise<void> {
  logger.info("Running migration safety check…");

  const result = await checkMigrationSafety();

  if (result.violations.length === 0) {
    logger.info("All migrations passed safety check — no violations found");
    return;
  }

  for (const violation of result.violations) {
    const logFn = violation.severity === "error" ? logger.error : logger.warn;
    logFn(
      {
        file: violation.file,
        line: violation.line,
        pattern: violation.pattern,
      },
      violation.description
    );
  }

  const errorCount = result.violations.filter(
    (v) => v.severity === "error"
  ).length;
  const warningCount = result.warnings.length;

  logger.info(
    { errorCount, warningCount, safe: result.safe },
    "Migration safety check complete"
  );

  if (!result.safe) {
    logger.error(`Found ${errorCount} error-level violation(s) — aborting`);
    process.exit(1);
  }
}

// Allow running as a standalone script
const isMainModule =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].includes("check-migration-safety") ||
    process.argv[1].endsWith("check-migration-safety.ts"));

if (isMainModule) {
  runMigrationSafetyCheck().catch((error: unknown) => {
    logger.error({ error }, "Migration safety check failed unexpectedly");
    process.exit(1);
  });
}
