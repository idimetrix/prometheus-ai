/**
 * GAP-110: Audit Log Retention & Archival Engine
 *
 * Archives old audit logs to cold storage (MinIO),
 * configurable retention periods (30/60/90/365 days),
 * and search across archived logs.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("queue-worker:audit-archival-engine");

export interface ArchivalConfig {
  archiveBatchSize: number;
  coldStorageBucket: string;
  compressionEnabled: boolean;
  retentionDays: number;
}

export interface ArchivedBatch {
  archivedAt: number;
  dateRange: { from: string; to: string };
  id: string;
  logCount: number;
  orgId: string;
  sizeBytes: number;
  storagePath: string;
}

export interface ArchivalStats {
  newestArchive: string | null;
  oldestArchive: string | null;
  totalArchived: number;
  totalBatches: number;
  totalSizeBytes: number;
}

const DEFAULT_CONFIG: ArchivalConfig = {
  retentionDays: 90,
  coldStorageBucket: "prometheus-audit-archive",
  archiveBatchSize: 10_000,
  compressionEnabled: true,
};

export class AuditArchivalEngine {
  private readonly config: ArchivalConfig;
  private readonly batches: ArchivedBatch[] = [];

  constructor(config?: Partial<ArchivalConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Archive audit logs older than retention period.
   */
  async archiveLogs(params: {
    orgId: string;
    fetchOldLogs: (
      before: Date,
      limit: number
    ) => Promise<Array<{ id: string; createdAt: Date; data: unknown }>>;
    uploadToStorage: (path: string, data: string) => Promise<number>;
    deleteLogs: (ids: string[]) => Promise<void>;
  }): Promise<ArchivedBatch | null> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.retentionDays);

    logger.info(
      {
        orgId: params.orgId,
        cutoffDate: cutoffDate.toISOString(),
        retentionDays: this.config.retentionDays,
      },
      "Starting audit log archival"
    );

    const oldLogs = await params.fetchOldLogs(
      cutoffDate,
      this.config.archiveBatchSize
    );

    if (oldLogs.length === 0) {
      logger.info({ orgId: params.orgId }, "No logs to archive");
      return null;
    }

    // Serialize logs
    const serialized = JSON.stringify(oldLogs);
    const storagePath = `${params.orgId}/${cutoffDate.toISOString().split("T")[0]}/batch_${Date.now()}.json`;

    // Upload to cold storage
    const sizeBytes = await params.uploadToStorage(
      `${this.config.coldStorageBucket}/${storagePath}`,
      serialized
    );

    // Delete archived logs from primary DB
    const logIds = oldLogs.map((l) => l.id);
    await params.deleteLogs(logIds);

    const batch: ArchivedBatch = {
      id: `arch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      orgId: params.orgId,
      logCount: oldLogs.length,
      dateRange: {
        from: oldLogs.at(-1)?.createdAt.toISOString() ?? "",
        to: oldLogs[0]?.createdAt.toISOString() ?? "",
      },
      storagePath,
      sizeBytes,
      archivedAt: Date.now(),
    };

    this.batches.push(batch);

    logger.info(
      {
        batchId: batch.id,
        orgId: params.orgId,
        logCount: oldLogs.length,
        sizeBytes,
      },
      "Audit logs archived successfully"
    );

    return batch;
  }

  /**
   * Search across archived logs.
   */
  async searchArchived(params: {
    orgId: string;
    query: string;
    downloadFromStorage: (path: string) => Promise<string>;
  }): Promise<Array<{ id: string; data: unknown }>> {
    const orgBatches = this.batches.filter((b) => b.orgId === params.orgId);
    const results: Array<{ id: string; data: unknown }> = [];

    for (const batch of orgBatches) {
      try {
        const data = await params.downloadFromStorage(
          `${this.config.coldStorageBucket}/${batch.storagePath}`
        );
        const logs = JSON.parse(data) as Array<{ id: string; data: unknown }>;

        const matching = logs.filter((l) =>
          JSON.stringify(l).toLowerCase().includes(params.query.toLowerCase())
        );
        results.push(...matching);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.warn(
          { batchId: batch.id, error: msg },
          "Failed to search archived batch"
        );
      }
    }

    return results;
  }

  /**
   * Get archival statistics.
   */
  getStats(orgId?: string): ArchivalStats {
    const relevant = orgId
      ? this.batches.filter((b) => b.orgId === orgId)
      : this.batches;

    return {
      totalArchived: relevant.reduce((s, b) => s + b.logCount, 0),
      totalBatches: relevant.length,
      totalSizeBytes: relevant.reduce((s, b) => s + b.sizeBytes, 0),
      oldestArchive:
        relevant.length > 0 ? (relevant[0]?.dateRange.from ?? null) : null,
      newestArchive:
        relevant.length > 0 ? (relevant.at(-1)?.dateRange.to ?? null) : null,
    };
  }

  /**
   * Update retention configuration.
   */
  setRetentionDays(days: number): void {
    this.config.retentionDays = days;
    logger.info({ retentionDays: days }, "Audit retention updated");
  }
}
