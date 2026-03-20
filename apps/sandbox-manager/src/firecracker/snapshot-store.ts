/**
 * Firecracker Snapshot Store.
 *
 * Higher-level snapshot management for named snapshots with support
 * for pre-built language runtime snapshots. Wraps the lower-level
 * SnapshotManager to provide a simpler create/restore/list/delete API.
 */
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";

const logger = createLogger("sandbox-manager:snapshot-store");

const DEFAULT_API_BASE = "http://localhost:8080";

/** Pre-built snapshot templates for common language runtimes */
export type PrebuiltTemplate =
  | "node22"
  | "python312"
  | "rust"
  | "golang"
  | "java";

/** Metadata stored for each named snapshot */
export interface StoredSnapshot {
  createdAt: Date;
  id: string;
  memFilePath: string;
  name: string;
  path: string;
  sizeBytes: number;
  template: PrebuiltTemplate | null;
  vmId: string;
}

/** Pre-built template setup commands (run inside the VM before snapshotting) */
const PREBUILT_SETUP: Record<PrebuiltTemplate, string> = {
  node22:
    "apk add --no-cache nodejs npm git && mkdir -p /workspace && node --version",
  python312:
    "apk add --no-cache python3 py3-pip git && mkdir -p /workspace && python3 --version",
  rust: "apk add --no-cache rust cargo git && mkdir -p /workspace && rustc --version",
  golang: "apk add --no-cache go git && mkdir -p /workspace && go version",
  java: "apk add --no-cache openjdk17-jdk maven git && mkdir -p /workspace && java --version",
};

interface SnapshotStoreConfig {
  apiBase?: string;
  snapshotDir?: string;
}

export class SnapshotStore {
  private readonly apiBase: string;
  private readonly snapshotDir: string;
  private readonly snapshots = new Map<string, StoredSnapshot>();
  private readonly nameIndex = new Map<string, string>();

  constructor(config?: SnapshotStoreConfig) {
    this.apiBase =
      config?.apiBase ?? process.env.FIRECRACKER_API_BASE ?? DEFAULT_API_BASE;
    this.snapshotDir =
      config?.snapshotDir ??
      process.env.FIRECRACKER_SNAPSHOT_DIR ??
      "/var/lib/firecracker/snapshots";
  }

  /**
   * Create a snapshot from a running VM.
   * Pauses the VM, takes a full snapshot, then resumes.
   */
  async createSnapshot(
    vmId: string,
    snapshotName: string
  ): Promise<StoredSnapshot> {
    if (this.nameIndex.has(snapshotName)) {
      throw new Error(`Snapshot with name "${snapshotName}" already exists`);
    }

    const snapshotId = generateId("snap");
    const snapshotPath = `${this.snapshotDir}/${snapshotId}`;
    const memFilePath = `${snapshotPath}.mem`;

    logger.info({ vmId, snapshotName, snapshotId }, "Creating snapshot");

    // Pause, snapshot, resume
    await this.apiCall("PATCH", `/vms/${vmId}/vm`, { state: "Paused" });

    await this.apiCall("PUT", `/vms/${vmId}/snapshot/create`, {
      snapshot_type: "Full",
      snapshot_path: snapshotPath,
      mem_file_path: memFilePath,
    });

    await this.apiCall("PATCH", `/vms/${vmId}/vm`, { state: "Resumed" });

    const stored: StoredSnapshot = {
      id: snapshotId,
      name: snapshotName,
      vmId,
      template: null,
      path: snapshotPath,
      memFilePath,
      sizeBytes: 512 * 1024 * 1024, // estimated
      createdAt: new Date(),
    };

    this.snapshots.set(snapshotId, stored);
    this.nameIndex.set(snapshotName, snapshotId);

    logger.info({ snapshotId, snapshotName }, "Snapshot created");
    return stored;
  }

  /**
   * Restore a new VM from a named snapshot.
   * Returns the snapshot metadata; the caller should track the new VM.
   */
  async restoreFromSnapshot(snapshotName: string): Promise<StoredSnapshot> {
    const snapshotId = this.nameIndex.get(snapshotName);
    if (!snapshotId) {
      throw new Error(`Snapshot "${snapshotName}" not found`);
    }

    const stored = this.snapshots.get(snapshotId);
    if (!stored) {
      throw new Error(`Snapshot data for "${snapshotName}" is missing`);
    }

    logger.info(
      { snapshotName, snapshotId },
      "Restoring VM from named snapshot"
    );

    await this.apiCall("PUT", "/snapshot/load", {
      snapshot_path: stored.path,
      mem_backend: {
        backend_type: "File",
        backend_path: stored.memFilePath,
      },
      enable_diff_snapshots: true,
      resume_vm: true,
    });

    logger.info({ snapshotName, snapshotId }, "VM restored from snapshot");
    return stored;
  }

  /**
   * List all stored snapshots sorted by creation time (newest first).
   */
  listSnapshots(): StoredSnapshot[] {
    return Array.from(this.snapshots.values()).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );
  }

  /**
   * Delete a named snapshot and its backing files.
   */
  async deleteSnapshot(snapshotName: string): Promise<void> {
    const snapshotId = this.nameIndex.get(snapshotName);
    if (!snapshotId) {
      logger.warn({ snapshotName }, "Snapshot not found for deletion");
      return;
    }

    const stored = this.snapshots.get(snapshotId);

    logger.info({ snapshotName, snapshotId }, "Deleting snapshot");

    if (stored) {
      await this.apiCall("DELETE", `/snapshots/${snapshotId}`, {
        snapshot_path: stored.path,
        mem_file_path: stored.memFilePath,
      });
    }

    this.snapshots.delete(snapshotId);
    this.nameIndex.delete(snapshotName);

    logger.info({ snapshotName }, "Snapshot deleted");
  }

  /**
   * Get the setup command for a pre-built template.
   * Returns undefined if the template is not recognized.
   */
  getPrebuiltSetupCommand(template: PrebuiltTemplate): string {
    return PREBUILT_SETUP[template];
  }

  /**
   * Get available pre-built template names.
   */
  getPrebuiltTemplates(): PrebuiltTemplate[] {
    return Object.keys(PREBUILT_SETUP) as PrebuiltTemplate[];
  }

  /**
   * Get a snapshot by name.
   */
  getByName(name: string): StoredSnapshot | undefined {
    const id = this.nameIndex.get(name);
    if (!id) {
      return undefined;
    }
    return this.snapshots.get(id);
  }

  // ─── Private helpers ───────────────────────────────────────────────

  private async apiCall(
    method: string,
    path: string,
    body?: Record<string, unknown>
  ): Promise<unknown> {
    const url = `${this.apiBase}${path}`;

    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        throw new Error(
          `Firecracker API ${method} ${path} failed (${response.status}): ${errorBody}`
        );
      }

      const contentType = response.headers.get("content-type");
      if (
        response.status === 204 ||
        !contentType?.includes("application/json")
      ) {
        return {};
      }

      return await response.json();
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new Error(
          `Firecracker API ${method} ${path} timed out after 10s`
        );
      }
      throw error;
    }
  }
}
