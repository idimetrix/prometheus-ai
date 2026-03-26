import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { timestamps } from "../../helpers";
import { organizations } from "../organizations/organizations";

/**
 * Tracks archived audit log files stored in MinIO/S3.
 * Each row represents one compressed archive file containing audit logs
 * for a specific org and time range.
 */
export const auditArchiveIndex = pgTable(
  "audit_archive_index",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** MinIO/S3 bucket name */
    bucket: text("bucket").notNull(),
    /** Object key within the bucket */
    objectKey: text("object_key").notNull(),
    /** Start of the time range covered by this archive */
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    /** End of the time range covered by this archive */
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    /** Number of audit log records in this archive */
    recordCount: integer("record_count").notNull().default(0),
    /** File size in bytes */
    sizeBytes: integer("size_bytes").notNull().default(0),
    /** SHA-256 hash of the archive for integrity verification */
    checksumSha256: text("checksum_sha256"),
    /** Metadata about the archive (e.g., compression method, format version) */
    metadata: jsonb("metadata").default({}),
    ...timestamps,
  },
  (table) => [
    index("audit_archive_org_id_idx").on(table.orgId),
    index("audit_archive_period_idx").on(
      table.orgId,
      table.periodStart,
      table.periodEnd
    ),
  ]
);

/**
 * Per-org audit retention policy configuration.
 * If no row exists for an org, the system default (90 days) applies.
 */
export const auditRetentionPolicies = pgTable(
  "audit_retention_policies",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .unique()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** Number of days to retain logs in the hot database before archiving */
    retentionDays: integer("retention_days").notNull().default(90),
    /** Whether archival is enabled (if false, old logs are simply deleted) */
    archiveEnabled: text("archive_enabled").notNull().default("true"),
    /** Last time the archival job ran for this org */
    lastArchivedAt: timestamp("last_archived_at", { withTimezone: true }),
    /** User who last modified this policy */
    updatedBy: text("updated_by"),
    ...timestamps,
  },
  (table) => [index("audit_retention_org_id_idx").on(table.orgId)]
);
