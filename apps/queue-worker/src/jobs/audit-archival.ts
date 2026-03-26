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

const logger = createLogger("queue-worker:audit-archival");

/** Default retention period in days when no org-specific policy exists */
const DEFAULT_RETENTION_DAYS = Number(process.env.AUDIT_RETENTION_DAYS ?? "90");

/** Maximum records to archive per batch to avoid memory issues */
const BATCH_SIZE = 5000;

// ─── MinIO/S3 Upload ────────────────────────────────────────────────────────

async function uploadToStorage(
  objectKey: string,
  content: string,
  contentType: string
): Promise<{ bucket: string; objectKey: string; sizeBytes: number }> {
  const endpoint = process.env.MINIO_ENDPOINT ?? "http://localhost:9000";
  const accessKey = process.env.MINIO_ACCESS_KEY ?? "minioadmin";
  const secretKey = process.env.MINIO_SECRET_KEY ?? "minioadmin";
  const bucket = process.env.MINIO_BUCKET ?? "prometheus";
  const url = `${endpoint}/${bucket}/${objectKey}`;

  const authHeader = `Basic ${Buffer.from(`${accessKey}:${secretKey}`).toString("base64")}`;
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

  return { bucket, objectKey, sizeBytes };
}

// ─── Archive Single Org ─────────────────────────────────────────────────────

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: archive handles batching, compression, upload, and cleanup
async function archiveOrgLogs(orgId: string): Promise<{
  archivedCount: number;
  archiveId: string | null;
}> {
  // Get org-specific retention policy
  const [policy] = await db
    .select({
      retentionDays: auditRetentionPolicies.retentionDays,
      archiveEnabled: auditRetentionPolicies.archiveEnabled,
    })
    .from(auditRetentionPolicies)
    .where(eq(auditRetentionPolicies.orgId, orgId))
    .limit(1);

  const retentionDays = policy?.retentionDays ?? DEFAULT_RETENTION_DAYS;
  const archiveEnabled = policy?.archiveEnabled !== "false";
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
    return { archivedCount: 0, archiveId: null };
  }

  logger.info(
    { orgId, retentionDays, totalCount, cutoffDate: cutoffDate.toISOString() },
    "Archiving audit logs for org"
  );

  let archiveId: string | null = null;

  if (archiveEnabled) {
    // Fetch and serialize logs to JSON Lines
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

    const jsonlContent = allLines.join("\n");
    const checksum = createHash("sha256")
      .update(jsonlContent, "utf-8")
      .digest("hex");
    const _sizeBytes = Buffer.byteLength(jsonlContent, "utf-8");

    const now = new Date();
    const objectKey = `audit-archives/${orgId}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${generateId("arch")}.jsonl`;

    try {
      const uploadResult = await uploadToStorage(
        objectKey,
        jsonlContent,
        "application/x-ndjson"
      );

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
        "Audit archive uploaded to MinIO"
      );
    } catch (uploadError) {
      const msg =
        uploadError instanceof Error
          ? uploadError.message
          : String(uploadError);
      logger.error(
        { orgId, error: msg },
        "Failed to upload audit archive, skipping deletion"
      );
      // Do not delete logs if upload failed
      return { archivedCount: 0, archiveId: null };
    }
  }

  // Delete archived logs from PostgreSQL
  await db
    .delete(auditLogs)
    .where(
      and(eq(auditLogs.orgId, orgId), lt(auditLogs.createdAt, cutoffDate))
    );

  // Update last archived timestamp
  if (policy) {
    await db
      .update(auditRetentionPolicies)
      .set({ lastArchivedAt: new Date() })
      .where(eq(auditRetentionPolicies.orgId, orgId));
  }

  return { archivedCount: totalCount, archiveId };
}

// ─── Job Processor ──────────────────────────────────────────────────────────

export interface AuditArchivalData {
  /** If provided, only archive this org. Otherwise archive all orgs. */
  orgId?: string;
  trigger: "scheduled" | "manual";
}

export async function processAuditArchival(data: AuditArchivalData): Promise<{
  orgsProcessed: number;
  totalArchived: number;
  errors: Array<{ orgId: string; error: string }>;
}> {
  logger.info(
    { trigger: data.trigger, orgId: data.orgId ?? "all" },
    "Starting audit archival job"
  );

  const startTime = Date.now();
  let orgsToProcess: Array<{ id: string }>;

  if (data.orgId) {
    orgsToProcess = [{ id: data.orgId }];
  } else {
    orgsToProcess = await db
      .select({ id: organizations.id })
      .from(organizations);
  }

  let totalArchived = 0;
  const errors: Array<{ orgId: string; error: string }> = [];

  for (const org of orgsToProcess) {
    try {
      const result = await archiveOrgLogs(org.id);
      totalArchived += result.archivedCount;

      if (result.archivedCount > 0) {
        logger.info(
          {
            orgId: org.id,
            archivedCount: result.archivedCount,
            archiveId: result.archiveId,
          },
          "Org audit logs archived"
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(
        { orgId: org.id, error: message },
        "Failed to archive audit logs for org"
      );
      errors.push({ orgId: org.id, error: message });
    }
  }

  const durationMs = Date.now() - startTime;
  logger.info(
    {
      orgsProcessed: orgsToProcess.length,
      totalArchived,
      errorCount: errors.length,
      durationMs,
    },
    "Audit archival job completed"
  );

  return {
    orgsProcessed: orgsToProcess.length,
    totalArchived,
    errors,
  };
}
