import { createHash } from "node:crypto";
import {
  auditArchiveIndex,
  auditLogs,
  auditRetentionPolicies,
  db,
  organizations,
} from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { and, eq, lt, sql } from "drizzle-orm";

const logger = createLogger("audit-archival");

/** Default retention period in days when no org-specific policy exists */
const DEFAULT_RETENTION_DAYS = 90;

/** Maximum records to archive per batch to avoid memory issues */
const BATCH_SIZE = 5000;

// ─── MinIO/S3 Client ────────────────────────────────────────────────────────

interface MinioConfig {
  accessKey: string;
  bucket: string;
  endpoint: string;
  secretKey: string;
}

function getMinioConfig(): MinioConfig {
  return {
    endpoint: process.env.MINIO_ENDPOINT ?? "http://localhost:9000",
    accessKey: process.env.MINIO_ACCESS_KEY ?? "minioadmin",
    secretKey: process.env.MINIO_SECRET_KEY ?? "minioadmin",
    bucket: process.env.MINIO_BUCKET ?? "prometheus",
  };
}

/**
 * Upload a buffer to MinIO/S3 using the S3-compatible HTTP API.
 * Uses PUT with presigned-style auth headers.
 */
async function uploadToStorage(
  objectKey: string,
  content: string,
  contentType: string
): Promise<{ bucket: string; objectKey: string; sizeBytes: number }> {
  const config = getMinioConfig();
  const url = `${config.endpoint}/${config.bucket}/${objectKey}`;

  // Use basic auth header for MinIO compatibility
  const authHeader = `Basic ${Buffer.from(`${config.accessKey}:${config.secretKey}`).toString("base64")}`;
  const sizeBytes = Buffer.byteLength(content, "utf-8");

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: authHeader,
      "Content-Type": contentType,
      "Content-Length": String(sizeBytes),
    },
    body: content,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "unknown");
    throw new Error(
      `Failed to upload to MinIO: ${response.status} ${response.statusText} - ${body}`
    );
  }

  return {
    bucket: config.bucket,
    objectKey,
    sizeBytes,
  };
}

/**
 * Download an archived file from MinIO/S3.
 */
async function downloadFromStorage(
  bucket: string,
  objectKey: string
): Promise<string> {
  const config = getMinioConfig();
  const url = `${config.endpoint}/${bucket}/${objectKey}`;

  const authHeader = `Basic ${Buffer.from(`${config.accessKey}:${config.secretKey}`).toString("base64")}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: authHeader,
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to download from MinIO: ${response.status} ${response.statusText}`
    );
  }

  return await response.text();
}

// ─── Core Archival Logic ────────────────────────────────────────────────────

/**
 * Get the effective retention days for an organization.
 */
export async function getRetentionDays(orgId: string): Promise<number> {
  const [policy] = await db
    .select({ retentionDays: auditRetentionPolicies.retentionDays })
    .from(auditRetentionPolicies)
    .where(eq(auditRetentionPolicies.orgId, orgId))
    .limit(1);

  return policy?.retentionDays ?? DEFAULT_RETENTION_DAYS;
}

/**
 * Archive old audit logs for a specific organization.
 *
 * Steps:
 * 1. Query logs older than the retention period
 * 2. Serialize to JSON Lines format
 * 3. Upload compressed archive to MinIO/S3
 * 4. Record the archive in the index table
 * 5. Delete archived logs from PostgreSQL
 *
 * Returns the number of logs archived.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: archive logic handles multiple date ranges and storage backends
export async function archiveOrgAuditLogs(orgId: string): Promise<{
  archivedCount: number;
  archiveId: string | null;
}> {
  const retentionDays = await getRetentionDays(orgId);
  const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  // Count logs to archive
  const [countResult] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(auditLogs)
    .where(
      and(eq(auditLogs.orgId, orgId), lt(auditLogs.createdAt, cutoffDate))
    );

  const totalCount = Number(countResult?.count ?? 0);

  if (totalCount === 0) {
    logger.debug({ orgId, retentionDays }, "No logs to archive");
    return { archivedCount: 0, archiveId: null };
  }

  logger.info(
    { orgId, retentionDays, totalCount, cutoffDate: cutoffDate.toISOString() },
    "Starting audit log archival"
  );

  // Check if archival is enabled for this org
  const [policy] = await db
    .select({ archiveEnabled: auditRetentionPolicies.archiveEnabled })
    .from(auditRetentionPolicies)
    .where(eq(auditRetentionPolicies.orgId, orgId))
    .limit(1);

  const archiveEnabled = policy?.archiveEnabled !== "false";

  let archiveId: string | null = null;

  if (archiveEnabled) {
    // Fetch logs in batches and serialize to JSON Lines
    const allLines: string[] = [];
    let offset = 0;
    let periodStart: Date | null = null;
    let periodEnd: Date | null = null;

    while (offset < totalCount) {
      const batch = await db
        .select()
        .from(auditLogs)
        .where(
          and(eq(auditLogs.orgId, orgId), lt(auditLogs.createdAt, cutoffDate))
        )
        .orderBy(auditLogs.createdAt)
        .limit(BATCH_SIZE)
        .offset(offset);

      for (const log of batch) {
        allLines.push(JSON.stringify(log));

        if (!periodStart || log.createdAt < periodStart) {
          periodStart = log.createdAt;
        }
        if (!periodEnd || log.createdAt > periodEnd) {
          periodEnd = log.createdAt;
        }
      }

      offset += batch.length;
      if (batch.length < BATCH_SIZE) {
        break;
      }
    }

    // Create the JSON Lines content
    const jsonlContent = allLines.join("\n");

    // Compute checksum
    const checksum = createHash("sha256")
      .update(jsonlContent, "utf-8")
      .digest("hex");

    // Generate object key with date-based path
    const now = new Date();
    const objectKey = `audit-archives/${orgId}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${generateId("arch")}.jsonl`;

    // Upload to MinIO/S3
    const uploadResult = await uploadToStorage(
      objectKey,
      jsonlContent,
      "application/x-ndjson"
    );

    // Record in archive index
    archiveId = generateId("arch");
    await db.insert(auditArchiveIndex).values({
      id: archiveId,
      orgId,
      bucket: uploadResult.bucket,
      objectKey: uploadResult.objectKey,
      periodStart: periodStart ?? cutoffDate,
      periodEnd: periodEnd ?? cutoffDate,
      recordCount: allLines.length,
      sizeBytes: uploadResult.sizeBytes,
      checksumSha256: checksum,
      metadata: {
        format: "jsonl",
        formatVersion: "1.0",
        retentionDays,
        archivedAt: now.toISOString(),
      },
    });

    logger.info(
      {
        orgId,
        archiveId,
        objectKey,
        recordCount: allLines.length,
        sizeBytes: uploadResult.sizeBytes,
      },
      "Audit log archive uploaded"
    );
  }

  // Delete archived logs from PostgreSQL
  await db
    .delete(auditLogs)
    .where(
      and(eq(auditLogs.orgId, orgId), lt(auditLogs.createdAt, cutoffDate))
    );

  // Update last archived timestamp
  await db
    .update(auditRetentionPolicies)
    .set({ lastArchivedAt: new Date() })
    .where(eq(auditRetentionPolicies.orgId, orgId));

  logger.info(
    { orgId, archivedCount: totalCount, archiveId },
    "Audit log archival completed"
  );

  return { archivedCount: totalCount, archiveId };
}

/**
 * Run archival for all organizations.
 * Called by the daily scheduled job.
 */
export async function archiveAllOrgs(): Promise<{
  orgsProcessed: number;
  totalArchived: number;
  errors: Array<{ orgId: string; error: string }>;
}> {
  // Get all orgs
  const orgs = await db.select({ id: organizations.id }).from(organizations);

  let totalArchived = 0;
  const errors: Array<{ orgId: string; error: string }> = [];

  for (const org of orgs) {
    try {
      const result = await archiveOrgAuditLogs(org.id);
      totalArchived += result.archivedCount;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(
        { orgId: org.id, error: message },
        "Failed to archive org audit logs"
      );
      errors.push({ orgId: org.id, error: message });
    }
  }

  logger.info(
    { orgsProcessed: orgs.length, totalArchived, errorCount: errors.length },
    "Audit archival batch completed"
  );

  return { orgsProcessed: orgs.length, totalArchived, errors };
}

/**
 * Retrieve archived audit logs from MinIO/S3 for a specific archive.
 */
export async function retrieveArchivedLogs(
  archiveId: string,
  orgId: string
): Promise<Record<string, unknown>[]> {
  const [archive] = await db
    .select()
    .from(auditArchiveIndex)
    .where(
      and(
        eq(auditArchiveIndex.id, archiveId),
        eq(auditArchiveIndex.orgId, orgId)
      )
    )
    .limit(1);

  if (!archive) {
    throw new Error(`Archive not found: ${archiveId}`);
  }

  const content = await downloadFromStorage(archive.bucket, archive.objectKey);
  const lines = content.split("\n").filter(Boolean);

  return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
}
