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
 * Generate SQL to create org_id-based hash partitions.
 *
 * @param tableName - Table name
 * @param partitionCount - Number of hash partitions to create (default: 16)
 */
export function createOrgPartitions(
  tableName: string,
  partitionCount = 16
): string[] {
  const statements: string[] = [`-- Hash-partition ${tableName} by org_id`];

  for (let i = 0; i < partitionCount; i++) {
    statements.push(
      `CREATE TABLE IF NOT EXISTS ${tableName}_org_p${i} PARTITION OF ${tableName} FOR VALUES WITH (MODULUS ${partitionCount}, REMAINDER ${i});`
    );
  }

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

// ─── PartitionManager ─────────────────────────────────────────────────────────

/** Tables that should be partitioned by org_id (hash) or time (range) */
const PARTITION_TARGETS = [
  "session_events",
  "memories",
  "audit_logs",
  "usage_rollups",
] as const;

export type PartitionTarget = (typeof PARTITION_TARGETS)[number];

/** Partition size statistics */
export interface PartitionStats {
  partitions: Array<{
    name: string;
    estimatedRows: number;
    estimatedSizeBytes: number;
  }>;
  table: string;
  totalPartitions: number;
}

/**
 * PartitionManager provides higher-level partition management for
 * org-based and time-based partitioning strategies.
 */
export class PartitionManager {
  /**
   * Generate SQL to partition a table by org_id using hash partitioning.
   * Suitable for tenant-isolated tables that need even data distribution.
   */
  partitionByOrg(tableName: string, partitionCount = 16): string[] {
    logger.info(
      { tableName, partitionCount },
      "Generating org-based partition SQL"
    );
    return createOrgPartitions(tableName, partitionCount);
  }

  /**
   * Generate SQL to partition a table by time using range partitioning.
   * Creates partitions for the specified interval ahead.
   *
   * @param tableName - Must be a PartitionedTable
   * @param interval - "monthly" or "quarterly"
   * @param monthsAhead - How many months to pre-create (default: 6)
   */
  partitionByTime(
    tableName: PartitionedTable,
    interval: "monthly" | "quarterly" = "monthly",
    monthsAhead = 6
  ): string[] {
    const statements: string[] = [];
    const now = new Date();
    const step = interval === "quarterly" ? 3 : 1;

    for (let offset = 0; offset < monthsAhead; offset += step) {
      const date = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      const year = date.getFullYear();
      const month = date.getMonth() + 1;
      statements.push(createPartition(tableName, year, month));
    }

    logger.info(
      { tableName, interval, monthsAhead, partitionCount: statements.length },
      "Generated time-based partition SQL"
    );

    return statements;
  }

  /**
   * Get the SQL query to retrieve partition statistics for a table.
   */
  getPartitionStatsSQL(tableName: string): string {
    return [
      "SELECT",
      "  child.relname AS partition_name,",
      "  pg_total_relation_size(child.oid) AS size_bytes,",
      "  child.reltuples::bigint AS estimated_rows",
      "FROM pg_inherits",
      "  JOIN pg_class parent ON pg_inherits.inhparent = parent.oid",
      "  JOIN pg_class child ON pg_inherits.inhrelid = child.oid",
      `WHERE parent.relname = '${tableName}'`,
      "ORDER BY child.relname;",
    ].join("\n");
  }

  /**
   * Get the list of tables that are recommended for partitioning.
   */
  getPartitionTargets(): readonly string[] {
    return PARTITION_TARGETS;
  }
}
