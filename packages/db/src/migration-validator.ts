import { createLogger } from "@prometheus/logger";

const logger = createLogger("db:migration-validator");

export interface MigrationValidationResult {
  errors: string[];
  isDestructive: boolean;
  valid: boolean;
  warnings: string[];
}

const DESTRUCTIVE_PATTERNS = [
  /\bDROP\s+TABLE\b/i,
  /\bDROP\s+COLUMN\b/i,
  /\bDROP\s+INDEX\b/i,
  /\bDROP\s+SCHEMA\b/i,
  /\bTRUNCATE\b/i,
  /\bALTER\s+TABLE\s+\w+\s+DROP\b/i,
  /\bALTER\s+TYPE\s+\w+\s+RENAME\b/i,
];

const DROP_PATTERN = /\bDROP\b/i;
const IF_EXISTS_PATTERN = /\bIF\s+EXISTS\b/i;
const CREATE_INDEX_PATTERN = /\bCREATE\s+INDEX\b/i;
const CONCURRENTLY_PATTERN = /\bCONCURRENTLY\b/i;
const UPDATE_SET_PATTERN = /\bUPDATE\s+\w+\s+SET\b/i;
const WHERE_PATTERN = /\bWHERE\b/i;

const RISKY_PATTERNS = [
  {
    pattern: /\bALTER\s+TABLE\s+\w+\s+ALTER\s+COLUMN\s+\w+\s+TYPE\b/i,
    message: "Column type change detected - may cause data loss",
  },
  {
    pattern: /\bNOT\s+NULL\b/i,
    message:
      "Adding NOT NULL constraint - ensure column has default or all rows have values",
  },
  {
    pattern: /\bRENAME\s+(TABLE|COLUMN)\b/i,
    message: "Rename operation - ensure application code is updated",
  },
  {
    pattern: /\bALTER\s+TABLE\s+\w+\s+ADD\s+CONSTRAINT\b/i,
    message: "Adding constraint - may fail if existing data violates it",
  },
];

/**
 * Validates migration SQL for backward compatibility and safety.
 */
export function validateMigration(sql: string): MigrationValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  let isDestructive = false;

  // Check for destructive operations
  for (const pattern of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(sql)) {
      isDestructive = true;
      errors.push(`Destructive operation detected: ${pattern.source}`);
    }
  }

  // Check for risky operations
  for (const { pattern, message } of RISKY_PATTERNS) {
    if (pattern.test(sql)) {
      warnings.push(message);
    }
  }

  // Check for missing IF EXISTS on drops
  if (DROP_PATTERN.test(sql) && !IF_EXISTS_PATTERN.test(sql)) {
    warnings.push(
      "DROP without IF EXISTS - migration may fail if object doesn't exist"
    );
  }

  // Check for missing CONCURRENTLY on index creation
  if (CREATE_INDEX_PATTERN.test(sql) && !CONCURRENTLY_PATTERN.test(sql)) {
    warnings.push(
      "CREATE INDEX without CONCURRENTLY - will lock table during creation"
    );
  }

  // Check for large data operations
  if (UPDATE_SET_PATTERN.test(sql) && !WHERE_PATTERN.test(sql)) {
    warnings.push("UPDATE without WHERE clause - will modify all rows");
  }

  const valid = errors.length === 0;

  if (!valid) {
    logger.warn(
      { errors, warnings, isDestructive },
      "Migration validation failed"
    );
  } else if (warnings.length > 0) {
    logger.info({ warnings }, "Migration validation passed with warnings");
  }

  return { valid, warnings, errors, isDestructive };
}

/**
 * Validate a set of migration files.
 */
export function validateMigrationFiles(
  files: Array<{ name: string; sql: string }>
): Map<string, MigrationValidationResult> {
  const results = new Map<string, MigrationValidationResult>();

  for (const file of files) {
    results.set(file.name, validateMigration(file.sql));
  }

  return results;
}
