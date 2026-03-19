import { createLogger } from "@prometheus/logger";
import { sql } from "drizzle-orm";
import type { Database } from "./client";

const logger = createLogger("db:migration-safety");

// ─── Types ────────────────────────────────────────────────────────────────────

interface MigrationValidationResult {
  errors: string[];
  valid: boolean;
  warnings: string[];
}

interface MigrationLockResult {
  acquired: boolean;
  acquiredAt?: Date;
  holder?: string;
  lockId: string;
}

// ─── Dangerous Operation Patterns ─────────────────────────────────────────────

const DANGEROUS_PATTERNS = [
  {
    pattern: /DROP\s+COLUMN/i,
    severity: "error" as const,
    message:
      "DROP COLUMN detected. This causes data loss. Use a feature flag to stop reading the column first, then drop in a later migration.",
  },
  {
    pattern: /DROP\s+TABLE/i,
    severity: "error" as const,
    message:
      "DROP TABLE detected. This causes data loss. Rename the table first (e.g., _deprecated_), then drop in a later migration after verification.",
  },
  {
    pattern: /TRUNCATE/i,
    severity: "error" as const,
    message:
      "TRUNCATE detected. This deletes all rows. Use DELETE with a WHERE clause if partial deletion is needed.",
  },
  {
    pattern: /ALTER\s+COLUMN.*TYPE/i,
    severity: "warning" as const,
    message:
      "Column type change detected. This may require a full table rewrite and can cause downtime on large tables. Consider adding a new column and migrating data.",
  },
  {
    pattern: /ALTER\s+COLUMN.*SET\s+NOT\s+NULL/i,
    severity: "warning" as const,
    message:
      "Setting NOT NULL on existing column. Ensure all existing rows have values first, or provide a DEFAULT.",
  },
  {
    pattern: /CREATE\s+INDEX(?!\s+CONCURRENTLY)/i,
    severity: "warning" as const,
    message:
      "Non-concurrent index creation detected. Use CREATE INDEX CONCURRENTLY to avoid locking the table during index build.",
  },
  {
    pattern: /ALTER\s+TABLE.*RENAME/i,
    severity: "warning" as const,
    message:
      "Table or column rename detected. Ensure application code is updated to use the new name before running this migration.",
  },
  {
    pattern: /DELETE\s+FROM\s+\w+\s*;?\s*$/im,
    severity: "warning" as const,
    message:
      "Unconditional DELETE detected (no WHERE clause). This will delete all rows in the table.",
  },
];

// ─── Migration Lock ───────────────────────────────────────────────────────────

const _LOCK_TABLE = "migration_lock";
const LOCK_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Acquire an advisory lock to prevent concurrent migrations.
 * Uses a dedicated lock table with a timeout to auto-release stale locks.
 */
export async function acquireMigrationLock(
  db: Database,
  holder: string
): Promise<MigrationLockResult> {
  const lockId = `migration-${Date.now()}`;

  try {
    // Ensure lock table exists
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS migration_lock (
        id TEXT PRIMARY KEY DEFAULT 'global',
        holder TEXT NOT NULL,
        lock_id TEXT NOT NULL,
        acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL
      )
    `);

    // Clean up expired locks
    await db.execute(sql`
      DELETE FROM migration_lock
      WHERE expires_at < NOW()
    `);

    // Try to acquire lock
    const expiresAt = new Date(Date.now() + LOCK_TIMEOUT_MS);
    const result = await db.execute(sql`
      INSERT INTO migration_lock (id, holder, lock_id, acquired_at, expires_at)
      VALUES ('global', ${holder}, ${lockId}, NOW(), ${expiresAt.toISOString()}::timestamptz)
      ON CONFLICT (id) DO NOTHING
      RETURNING *
    `);

    if (result.length > 0) {
      logger.info({ lockId, holder }, "Migration lock acquired");
      return { acquired: true, lockId, holder, acquiredAt: new Date() };
    }

    // Lock is held by someone else
    const existing = await db.execute(sql`
      SELECT holder, lock_id, acquired_at, expires_at
      FROM migration_lock
      WHERE id = 'global'
    `);

    const currentHolder = existing[0] as
      | { holder: string; lock_id: string; acquired_at: Date }
      | undefined;

    logger.warn(
      {
        holder,
        currentHolder: currentHolder?.holder,
        currentLockId: currentHolder?.lock_id,
      },
      "Migration lock already held"
    );

    return {
      acquired: false,
      lockId,
      holder: currentHolder?.holder,
      acquiredAt: currentHolder?.acquired_at,
    };
  } catch (err) {
    logger.error({ err, holder }, "Failed to acquire migration lock");
    return { acquired: false, lockId };
  }
}

/**
 * Release the migration lock.
 */
export async function releaseMigrationLock(
  db: Database,
  lockId: string
): Promise<boolean> {
  try {
    const result = await db.execute(sql`
      DELETE FROM migration_lock
      WHERE lock_id = ${lockId}
    `);
    const released = result.count > 0;
    if (released) {
      logger.info({ lockId }, "Migration lock released");
    }
    return released;
  } catch (err) {
    logger.error({ err, lockId }, "Failed to release migration lock");
    return false;
  }
}

// ─── SQL Validation ───────────────────────────────────────────────────────────

/**
 * Validate migration SQL for dangerous operations.
 * Returns errors for operations that cause data loss,
 * and warnings for operations that may cause issues.
 */
export function validateMigrationSQL(
  migrationSQL: string
): MigrationValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const { pattern, severity, message } of DANGEROUS_PATTERNS) {
    if (pattern.test(migrationSQL)) {
      if (severity === "error") {
        errors.push(message);
      } else {
        warnings.push(message);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ─── Backward Compatibility Check ─────────────────────────────────────────────

/**
 * Verify that a migration is backward-compatible with the current schema.
 *
 * Rules:
 * - No dropping columns that existing code might reference
 * - No renaming tables without a compatibility view
 * - No removing NOT NULL without a default
 * - No changing column types without a migration path
 */
export async function checkBackwardCompatibility(
  db: Database,
  migrationSQL: string
): Promise<MigrationValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Extract DROP COLUMN operations
  const dropColumnPattern =
    /ALTER\s+TABLE\s+(?:"?(\w+)"?)\s+DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?(?:"?(\w+)"?)/gi;
  let dropColMatch: RegExpExecArray | null = null;

  while (true) {
    dropColMatch = dropColumnPattern.exec(migrationSQL);
    if (!dropColMatch) {
      break;
    }
    const tableName = dropColMatch[1];
    const columnName = dropColMatch[2];
    if (tableName && columnName) {
      // Check if the column exists in the current schema
      try {
        const result = await db.execute(sql`
          SELECT COUNT(*) as row_count
          FROM information_schema.columns
          WHERE table_name = ${tableName}
            AND column_name = ${columnName}
            AND table_schema = 'public'
        `);
        const row = result[0] as { row_count: number } | undefined;
        if (row && Number(row.row_count) > 0) {
          errors.push(
            `Cannot drop column "${columnName}" from table "${tableName}" — ` +
              "it exists in the current schema. Add a feature flag to stop reading this column first, " +
              "then drop it in a future migration."
          );
        }
      } catch {
        warnings.push(
          `Could not verify column "${columnName}" in table "${tableName}" — proceed with caution.`
        );
      }
    }
  }

  // Check for DROP TABLE operations
  const dropTablePattern = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:"?(\w+)"?)/gi;
  let dropTableMatch: RegExpExecArray | null = null;

  while (true) {
    dropTableMatch = dropTablePattern.exec(migrationSQL);
    if (!dropTableMatch) {
      break;
    }
    const tableName = dropTableMatch[1];
    if (tableName) {
      try {
        const result = await db.execute(sql`
          SELECT EXISTS(
            SELECT 1 FROM information_schema.tables
            WHERE table_name = ${tableName}
            AND table_schema = 'public'
          ) as table_exists
        `);
        const row = result[0] as { table_exists: boolean } | undefined;
        if (row?.table_exists) {
          errors.push(
            `Cannot drop table "${tableName}" — it exists in the current schema. ` +
              `Rename it to "_deprecated_${tableName}" first, verify no code references it, then drop.`
          );
        }
      } catch {
        warnings.push(
          `Could not verify table "${tableName}" existence — proceed with caution.`
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ─── Pre-Deployment Dry Run ───────────────────────────────────────────────────

/**
 * Run a full pre-deployment validation on a migration:
 *   1. SQL pattern analysis (static checks)
 *   2. Backward compatibility (schema introspection)
 *   3. Dry-run in a transaction that gets rolled back
 *
 * Returns a combined validation result.
 */
export async function dryRunMigration(
  db: Database,
  migrationSQL: string,
  migrationName: string
): Promise<MigrationValidationResult & { dryRunSuccess: boolean }> {
  logger.info({ migrationName }, "Starting migration dry run");

  // Step 1: Static SQL validation
  const sqlValidation = validateMigrationSQL(migrationSQL);

  // Step 2: Backward compatibility check
  const compatCheck = await checkBackwardCompatibility(db, migrationSQL);

  // Merge results
  const errors = [...sqlValidation.errors, ...compatCheck.errors];
  const warnings = [...sqlValidation.warnings, ...compatCheck.warnings];

  // Step 3: Dry-run in a transaction (rolled back)
  let dryRunSuccess = false;

  if (errors.length === 0) {
    try {
      await db.execute(sql`BEGIN`);
      await db.execute(sql.raw(migrationSQL));
      await db.execute(sql`ROLLBACK`);
      dryRunSuccess = true;
      logger.info({ migrationName }, "Migration dry run succeeded");
    } catch (err) {
      try {
        await db.execute(sql`ROLLBACK`);
      } catch {
        // Ignore rollback error
      }
      const errorMessage = err instanceof Error ? err.message : String(err);
      errors.push(`Dry run failed: ${errorMessage}`);
      logger.error({ migrationName, err }, "Migration dry run failed");
    }
  } else {
    logger.warn(
      { migrationName, errorCount: errors.length },
      "Skipping dry run due to validation errors"
    );
  }

  const result = {
    valid: errors.length === 0 && dryRunSuccess,
    errors,
    warnings,
    dryRunSuccess,
  };

  logger.info(
    {
      migrationName,
      valid: result.valid,
      errorCount: errors.length,
      warningCount: warnings.length,
      dryRunSuccess,
    },
    "Migration validation complete"
  );

  return result;
}

// ─── Safe Migration Runner ────────────────────────────────────────────────────

/**
 * Run a migration with full safety checks:
 *   1. Acquire lock (prevent concurrent migrations)
 *   2. Validate the migration SQL
 *   3. Dry run in a rolled-back transaction
 *   4. Apply the actual migration
 *   5. Release lock
 */
export async function runSafeMigration(
  db: Database,
  migrationSQL: string,
  migrationName: string,
  holder: string
): Promise<{
  success: boolean;
  validation: MigrationValidationResult;
  lockAcquired: boolean;
}> {
  // Step 1: Acquire lock
  const lock = await acquireMigrationLock(db, holder);
  if (!lock.acquired) {
    return {
      success: false,
      validation: {
        valid: false,
        errors: [
          `Migration lock held by "${lock.holder}" since ${lock.acquiredAt?.toISOString()}. ` +
            "Wait for it to complete or manually release the lock.",
        ],
        warnings: [],
      },
      lockAcquired: false,
    };
  }

  try {
    // Step 2 & 3: Validate and dry run
    const validation = await dryRunMigration(db, migrationSQL, migrationName);

    if (!validation.valid) {
      return {
        success: false,
        validation,
        lockAcquired: true,
      };
    }

    // Step 4: Apply the actual migration
    try {
      await db.execute(sql.raw(migrationSQL));
      logger.info({ migrationName }, "Migration applied successfully");
      return {
        success: true,
        validation,
        lockAcquired: true,
      };
    } catch (err) {
      logger.error({ migrationName, err }, "Migration application failed");
      return {
        success: false,
        validation: {
          valid: false,
          errors: [
            ...validation.errors,
            `Migration failed: ${err instanceof Error ? err.message : String(err)}`,
          ],
          warnings: validation.warnings,
        },
        lockAcquired: true,
      };
    }
  } finally {
    // Step 5: Release lock
    await releaseMigrationLock(db, lock.lockId);
  }
}
