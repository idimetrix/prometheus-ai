import { createLogger } from "@prometheus/logger";

const logger = createLogger("db:partitioning");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PartitionInfo {
  fromDate: string;
  partitionName: string;
  sql: string;
  table: string;
  toDate: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Tables that benefit from monthly partitioning due to high write volume
 * and time-based query patterns.
 */
const PARTITIONED_TABLES = [
  "session_events",
  "model_usage",
  "credit_transactions",
] as const;

export type PartitionedTable = (typeof PARTITIONED_TABLES)[number];

// ─── Partition SQL Generation ─────────────────────────────────────────────────

/**
 * Generate SQL to create a partition for a specific month.
 *
 * @param table - Base table name
 * @param year - Year (e.g., 2026)
 * @param month - Month (1-12)
 * @returns SQL string for CREATE TABLE ... PARTITION OF
 */
export function createPartition(
  table: PartitionedTable,
  year: number,
  month: number
): string {
  const paddedMonth = String(month).padStart(2, "0");
  const partitionName = `${table}_y${year}m${paddedMonth}`;

  // Calculate date range
  const fromDate = `${year}-${paddedMonth}-01`;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const nextPaddedMonth = String(nextMonth).padStart(2, "0");
  const toDate = `${nextYear}-${nextPaddedMonth}-01`;

  const sql = [
    `CREATE TABLE IF NOT EXISTS ${partitionName}`,
    `  PARTITION OF ${table}`,
    `  FOR VALUES FROM ('${fromDate}') TO ('${toDate}');`,
  ].join("\n");

  logger.debug(
    { table, partitionName, fromDate, toDate },
    "Generated partition SQL"
  );

  return sql;
}

/**
 * Generate SQL to convert a regular table to a partitioned table.
 * This is a one-time migration operation.
 *
 * @param table - Table name
 * @param partitionColumn - Column to partition on (e.g., "created_at")
 */
export function createPartitionedTableSQL(
  table: PartitionedTable,
  partitionColumn = "created_at"
): string {
  return [
    `-- Convert ${table} to range-partitioned table`,
    "-- NOTE: This requires migrating existing data. Run during maintenance window.",
    `ALTER TABLE ${table} RENAME TO ${table}_old;`,
    "",
    `CREATE TABLE ${table} (LIKE ${table}_old INCLUDING ALL)`,
    `  PARTITION BY RANGE (${partitionColumn});`,
    "",
    "-- Copy data after creating necessary partitions",
    `-- INSERT INTO ${table} SELECT * FROM ${table}_old;`,
    `-- DROP TABLE ${table}_old;`,
  ].join("\n");
}

/**
 * Ensure partitions exist for the current month and the next 3 months.
 *
 * Call this on a monthly cron or at service startup to ensure
 * upcoming partitions are ready.
 *
 * @returns Array of SQL statements for all needed partitions
 */
export function ensureCurrentPartitions(): string[] {
  const statements: string[] = [];
  const now = new Date();

  for (const table of PARTITIONED_TABLES) {
    for (let offset = 0; offset < 4; offset++) {
      const date = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      const year = date.getFullYear();
      const month = date.getMonth() + 1;

      statements.push(createPartition(table, year, month));
    }
  }

  logger.info(
    {
      tables: PARTITIONED_TABLES.length,
      monthsAhead: 3,
      totalPartitions: statements.length,
    },
    "Generated partition creation statements"
  );

  return statements;
}

/**
 * Generate SQL to drop old partitions for archival.
 *
 * @param table - Table name
 * @param olderThanMonths - Drop partitions older than this many months
 */
export function dropOldPartitions(
  table: PartitionedTable,
  olderThanMonths: number
): string[] {
  const statements: string[] = [];
  const now = new Date();

  for (let offset = olderThanMonths; offset < olderThanMonths + 12; offset++) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const paddedMonth = String(month).padStart(2, "0");
    const partitionName = `${table}_y${year}m${paddedMonth}`;

    statements.push(
      `-- Detach and optionally archive ${partitionName}`,
      `ALTER TABLE ${table} DETACH PARTITION ${partitionName};`,
      `-- DROP TABLE ${partitionName}; -- Uncomment to permanently delete`
    );
  }

  return statements;
}
