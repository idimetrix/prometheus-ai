import { exec } from "node:child_process";
import {
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";

const execAsync = promisify(exec);

const logger = createLogger("sandbox-manager:sandbox-store");

const DEFAULT_STORAGE_DIR = "/tmp/prometheus-snapshots";
const SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface SnapshotInfo {
  createdAt: Date;
  id: string;
  metadata: Record<string, unknown>;
  projectId: string | null;
  sandboxId: string;
  sizeBytes: number;
}

interface SnapshotMeta {
  createdAt: string;
  id: string;
  metadata: Record<string, unknown>;
  projectId: string | null;
  sandboxId: string;
}

/**
 * File-based sandbox snapshot store.
 *
 * Snapshots a sandbox workspace by creating a tar archive and storing
 * metadata in a JSON sidecar file. Supports restore, list, and cleanup.
 */
export class SandboxStore {
  private readonly storageDir: string;

  constructor(storageDir?: string) {
    this.storageDir =
      storageDir ?? process.env.SNAPSHOT_STORAGE_DIR ?? DEFAULT_STORAGE_DIR;
  }

  private snapshotPath(snapshotId: string): string {
    return join(this.storageDir, `${snapshotId}.tar.gz`);
  }

  private metaPath(snapshotId: string): string {
    return join(this.storageDir, `${snapshotId}.meta.json`);
  }

  /**
   * Create a snapshot of a sandbox workspace directory.
   * Returns the snapshot ID.
   */
  async snapshot(
    sandboxId: string,
    metadata?: Record<string, unknown>
  ): Promise<string> {
    const snapshotId = generateId("snap");
    await mkdir(this.storageDir, { recursive: true });

    const workspaceDir = metadata?.workspaceDir
      ? String(metadata.workspaceDir)
      : `/tmp/prometheus-sandboxes/${sandboxId}/workspace`;

    const tarPath = this.snapshotPath(snapshotId);

    try {
      await execAsync(`tar -czf "${tarPath}" -C "${workspaceDir}" .`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to create snapshot tarball: ${msg}`);
    }

    const meta: SnapshotMeta = {
      id: snapshotId,
      sandboxId,
      projectId: metadata?.projectId ? String(metadata.projectId) : null,
      metadata: metadata ?? {},
      createdAt: new Date().toISOString(),
    };

    await writeFile(this.metaPath(snapshotId), JSON.stringify(meta, null, 2));

    const tarStat = await stat(tarPath);

    logger.info(
      { snapshotId, sandboxId, sizeBytes: tarStat.size },
      "Sandbox snapshot created"
    );

    return snapshotId;
  }

  /**
   * Restore a snapshot into a new sandbox workspace directory.
   * Returns the new sandbox ID.
   */
  async restore(snapshotId: string): Promise<string> {
    const tarPath = this.snapshotPath(snapshotId);
    const metaPath = this.metaPath(snapshotId);

    // Verify snapshot exists
    try {
      await stat(tarPath);
    } catch {
      throw new Error(`Snapshot ${snapshotId} not found`);
    }

    const newSandboxId = generateId("sbx");
    const workspaceDir = `/tmp/prometheus-sandboxes/${newSandboxId}/workspace`;
    await mkdir(workspaceDir, { recursive: true });

    try {
      await execAsync(`tar -xzf "${tarPath}" -C "${workspaceDir}"`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to extract snapshot: ${msg}`);
    }

    // Read original metadata
    try {
      const rawMeta = await readFile(metaPath, "utf-8");
      const meta = JSON.parse(rawMeta) as SnapshotMeta;
      logger.info(
        {
          snapshotId,
          newSandboxId,
          originalSandboxId: meta.sandboxId,
        },
        "Sandbox restored from snapshot"
      );
    } catch {
      logger.info(
        { snapshotId, newSandboxId },
        "Sandbox restored from snapshot (no metadata)"
      );
    }

    return newSandboxId;
  }

  /**
   * List all available snapshots, optionally filtered by project ID.
   */
  async list(projectId?: string): Promise<SnapshotInfo[]> {
    try {
      await mkdir(this.storageDir, { recursive: true });
    } catch {
      // Directory may already exist
    }

    let entries: string[];
    try {
      entries = await readdir(this.storageDir);
    } catch {
      return [];
    }

    const metaFiles = entries.filter((f) => f.endsWith(".meta.json"));
    const results: SnapshotInfo[] = [];

    for (const metaFile of metaFiles) {
      try {
        const rawMeta = await readFile(
          join(this.storageDir, metaFile),
          "utf-8"
        );
        const meta = JSON.parse(rawMeta) as SnapshotMeta;

        if (projectId && meta.projectId !== projectId) {
          continue;
        }

        const tarFile = `${meta.id}.tar.gz`;
        let sizeBytes = 0;
        try {
          const tarStat = await stat(join(this.storageDir, tarFile));
          sizeBytes = tarStat.size;
        } catch {
          // Tar may have been deleted
        }

        results.push({
          id: meta.id,
          sandboxId: meta.sandboxId,
          projectId: meta.projectId,
          metadata: meta.metadata,
          createdAt: new Date(meta.createdAt),
          sizeBytes,
        });
      } catch {
        // Skip corrupted metadata files
      }
    }

    // Sort by creation time (newest first)
    results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return results;
  }

  /**
   * Delete a specific snapshot and its metadata.
   */
  async delete(snapshotId: string): Promise<void> {
    const tarPath = this.snapshotPath(snapshotId);
    const metaPath = this.metaPath(snapshotId);

    await rm(tarPath, { force: true });
    await rm(metaPath, { force: true });

    logger.info({ snapshotId }, "Snapshot deleted");
  }

  /**
   * Clean up snapshots older than 7 days.
   */
  async cleanup(): Promise<number> {
    const snapshots = await this.list();
    const now = Date.now();
    let deleted = 0;

    for (const snapshot of snapshots) {
      const age = now - snapshot.createdAt.getTime();
      if (age > SNAPSHOT_MAX_AGE_MS) {
        await this.delete(snapshot.id);
        deleted++;
      }
    }

    if (deleted > 0) {
      logger.info({ deleted }, "Old snapshots cleaned up");
    }

    return deleted;
  }
}
