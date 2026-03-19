/**
 * Firecracker Snapshot Manager.
 *
 * Manages base template snapshots (node, python, rust), incremental
 * session snapshots, and TTL-based expiry for automatic cleanup.
 *
 * Snapshots enable sub-100ms VM boot times by restoring from a
 * pre-configured memory image rather than cold-booting.
 */
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";

const logger = createLogger("sandbox-manager:snapshot-manager");

/** Default Firecracker management daemon endpoint */
const DEFAULT_API_BASE = "http://localhost:8080";

/** Default snapshot TTL: 1 hour */
const DEFAULT_SNAPSHOT_TTL_MS = 60 * 60 * 1000;

/** Supported template types */
export type SnapshotTemplate = "node" | "python" | "rust";

/** Template-specific setup commands */
const TEMPLATE_SETUP_COMMANDS: Record<SnapshotTemplate, string> = {
  node: "apk add --no-cache nodejs npm git && mkdir -p /workspace && node --version",
  python:
    "apk add --no-cache python3 py3-pip git && mkdir -p /workspace && python3 --version",
  rust: "apk add --no-cache rust cargo git && mkdir -p /workspace && rustc --version",
};

interface SnapshotConfig {
  /** Base URL for the Firecracker management daemon */
  apiBase?: string;
  /** Directory to store snapshot files */
  snapshotDir?: string;
  /** Snapshot TTL in milliseconds (default: 1 hour) */
  ttlMs?: number;
}

interface BaseSnapshotConfig {
  /** Disk size in MB for the rootfs */
  diskMb?: number;
  /** Memory allocation in MB */
  memoryMb?: number;
  /** Number of vCPUs */
  vcpuCount?: number;
}

interface SnapshotInfo {
  createdAt: Date;
  diskMb: number;
  id: string;
  /** Whether this is an incremental (diff) snapshot */
  incremental: boolean;
  memoryMb: number;
  /** Parent snapshot ID for incremental snapshots */
  parentId: string | null;
  path: string;
  projectId: string | null;
  /** Template this snapshot was created from */
  template: SnapshotTemplate | null;
  ttlMs: number;
  type: "base" | "project" | "incremental";
}

export class SnapshotManager {
  private readonly apiBase: string;
  private readonly snapshotDir: string;
  private readonly defaultTtlMs: number;
  private readonly snapshots = new Map<string, SnapshotInfo>();
  /** Track base snapshots per template for fast lookup */
  private readonly templateSnapshots = new Map<SnapshotTemplate, string>();

  constructor(config?: SnapshotConfig) {
    this.apiBase =
      config?.apiBase ?? process.env.FIRECRACKER_API_BASE ?? DEFAULT_API_BASE;
    this.snapshotDir =
      config?.snapshotDir ??
      process.env.FIRECRACKER_SNAPSHOT_DIR ??
      "/var/lib/firecracker/snapshots";
    this.defaultTtlMs = config?.ttlMs ?? DEFAULT_SNAPSHOT_TTL_MS;
  }

  /**
   * Create a snapshot for a specific sandbox and template.
   * Returns the snapshot file path.
   */
  async createSnapshot(sandboxId: string, template: string): Promise<string> {
    const snapshotTemplate = this.isValidTemplate(template) ? template : null;

    logger.info({ sandboxId, template }, "Creating snapshot");

    // Pause the VM before snapshotting
    await this.apiCall("PATCH", "/vm", { state: "Paused" });

    const snapshotId = generateId("snap");
    const snapshotPath = `${this.snapshotDir}/${snapshotId}`;

    await this.apiCall("PUT", "/snapshot/create", {
      snapshot_type: "Full",
      snapshot_path: snapshotPath,
      mem_file_path: `${snapshotPath}.mem`,
    });

    // Resume the VM after snapshot
    await this.apiCall("PATCH", "/vm", { state: "Resumed" });

    const info: SnapshotInfo = {
      id: snapshotId,
      type: "base",
      template: snapshotTemplate,
      projectId: null,
      parentId: null,
      path: snapshotPath,
      memoryMb: 512,
      diskMb: 1024,
      incremental: false,
      ttlMs: this.defaultTtlMs,
      createdAt: new Date(),
    };

    this.snapshots.set(snapshotId, info);

    // Track as template snapshot if applicable
    if (snapshotTemplate) {
      this.templateSnapshots.set(snapshotTemplate, snapshotId);
    }

    logger.info(
      { snapshotId, path: snapshotPath, template },
      "Snapshot created"
    );

    return snapshotPath;
  }

  /**
   * Restore a sandbox from a snapshot path.
   * Returns a new sandbox ID for the restored instance.
   */
  async restoreSnapshot(snapshotPath: string): Promise<string> {
    const sandboxId = generateId("sbx");

    logger.info(
      { snapshotPath, newSandboxId: sandboxId },
      "Restoring from snapshot"
    );

    await this.apiCall("PUT", "/snapshot/load", {
      snapshot_path: snapshotPath,
      mem_backend: {
        backend_type: "File",
        backend_path: `${snapshotPath}.mem`,
      },
      enable_diff_snapshots: true,
      resume_vm: true,
    });

    logger.info({ snapshotPath, sandboxId }, "Snapshot restored");

    return sandboxId;
  }

  /**
   * Remove expired snapshots based on TTL.
   * Returns the number of snapshots cleaned up.
   */
  async cleanup(): Promise<number> {
    const now = Date.now();
    let removed = 0;
    const toRemove: string[] = [];

    for (const [id, info] of this.snapshots) {
      const age = now - info.createdAt.getTime();
      if (age > info.ttlMs) {
        toRemove.push(id);
      }
    }

    for (const id of toRemove) {
      try {
        await this.deleteSnapshot(id);
        removed++;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.warn(
          { snapshotId: id, error: msg },
          "Failed to delete expired snapshot"
        );
      }
    }

    if (removed > 0) {
      logger.info(
        { removed, remaining: this.snapshots.size },
        "Expired snapshots cleaned up"
      );
    }

    return removed;
  }

  /**
   * Create a base snapshot with Alpine + template-specific toolchain.
   * This is the foundation for template-based warm pools.
   */
  async createBaseSnapshot(
    template: SnapshotTemplate,
    config?: BaseSnapshotConfig
  ): Promise<SnapshotInfo> {
    const vcpuCount = config?.vcpuCount ?? 1;
    const memoryMb = config?.memoryMb ?? 512;
    const diskMb = config?.diskMb ?? 1024;

    const setupCommand = TEMPLATE_SETUP_COMMANDS[template];

    logger.info(
      { template, vcpuCount, memoryMb, diskMb },
      "Creating base template snapshot"
    );

    // 1. Boot a fresh VM with the base rootfs
    await this.apiCall("PUT", "/machine-config", {
      vcpu_count: vcpuCount,
      mem_size_mib: memoryMb,
      track_dirty_pages: true,
    });

    await this.apiCall("PUT", "/boot-source", {
      kernel_image_path: "/var/lib/firecracker/vmlinux",
      boot_args: "console=ttyS0 reboot=k panic=1 pci=off",
    });

    await this.apiCall("PUT", "/drives/rootfs", {
      drive_id: "rootfs",
      path_on_host: "/var/lib/firecracker/rootfs.ext4",
      is_root_device: true,
      is_read_only: false,
    });

    await this.apiCall("PUT", "/actions", { action_type: "InstanceStart" });

    // 2. Install template-specific packages inside the VM
    await this.apiCall("POST", "/agent/exec", {
      command: setupCommand,
      timeout_ms: 120_000,
    });

    // 3. Pause the VM and take a snapshot
    await this.apiCall("PATCH", "/vm", { state: "Paused" });

    const snapshotId = generateId("snap");
    const snapshotPath = `${this.snapshotDir}/${snapshotId}`;

    await this.apiCall("PUT", "/snapshot/create", {
      snapshot_type: "Full",
      snapshot_path: snapshotPath,
      mem_file_path: `${snapshotPath}.mem`,
    });

    // 4. Stop the VM
    await this.apiCall("PUT", "/actions", {
      action_type: "SendCtrlAltDel",
    });

    const info: SnapshotInfo = {
      id: snapshotId,
      type: "base",
      template,
      projectId: null,
      parentId: null,
      path: snapshotPath,
      memoryMb,
      diskMb,
      incremental: false,
      ttlMs: this.defaultTtlMs,
      createdAt: new Date(),
    };

    this.snapshots.set(snapshotId, info);
    this.templateSnapshots.set(template, snapshotId);

    logger.info(
      { snapshotId, template, path: snapshotPath },
      "Base template snapshot created"
    );

    return info;
  }

  /**
   * Create an incremental snapshot during a session.
   * These are diff-based and smaller than full snapshots.
   */
  async createIncrementalSnapshot(
    sandboxId: string,
    parentSnapshotId: string
  ): Promise<SnapshotInfo> {
    const parent = this.snapshots.get(parentSnapshotId);
    if (!parent) {
      throw new Error(`Parent snapshot ${parentSnapshotId} not found`);
    }

    logger.info(
      { sandboxId, parentSnapshotId },
      "Creating incremental snapshot"
    );

    // Pause VM
    await this.apiCall("PATCH", "/vm", { state: "Paused" });

    const snapshotId = generateId("snap");
    const snapshotPath = `${this.snapshotDir}/${snapshotId}`;

    // Create a diff snapshot (only dirty pages)
    await this.apiCall("PUT", "/snapshot/create", {
      snapshot_type: "Diff",
      snapshot_path: snapshotPath,
      mem_file_path: `${snapshotPath}.mem`,
    });

    // Resume VM
    await this.apiCall("PATCH", "/vm", { state: "Resumed" });

    const info: SnapshotInfo = {
      id: snapshotId,
      type: "incremental",
      template: parent.template,
      projectId: parent.projectId,
      parentId: parentSnapshotId,
      path: snapshotPath,
      memoryMb: parent.memoryMb,
      diskMb: parent.diskMb,
      incremental: true,
      ttlMs: this.defaultTtlMs,
      createdAt: new Date(),
    };

    this.snapshots.set(snapshotId, info);

    logger.info(
      { snapshotId, parentSnapshotId, path: snapshotPath },
      "Incremental snapshot created"
    );

    return info;
  }

  /**
   * Create a project-specific snapshot with dependencies pre-installed.
   */
  async createProjectSnapshot(
    projectId: string,
    template: SnapshotTemplate,
    baseDeps: string[]
  ): Promise<SnapshotInfo> {
    logger.info(
      { projectId, template, depCount: baseDeps.length },
      "Creating project snapshot"
    );

    // Restore from the template base snapshot
    const baseSnapshotId = this.templateSnapshots.get(template);
    if (!baseSnapshotId) {
      throw new Error(
        `No base snapshot for template "${template}". Create one first.`
      );
    }

    const baseSnapshot = this.snapshots.get(baseSnapshotId);
    if (!baseSnapshot) {
      throw new Error(`Base snapshot ${baseSnapshotId} not found in registry`);
    }

    await this.apiCall("PUT", "/snapshot/load", {
      snapshot_path: baseSnapshot.path,
      mem_backend: {
        backend_type: "File",
        backend_path: `${baseSnapshot.path}.mem`,
      },
      enable_diff_snapshots: true,
      resume_vm: true,
    });

    // Install project-specific dependencies
    if (baseDeps.length > 0) {
      const depString = baseDeps.join(" ");
      let installCmd: string;
      if (template === "node") {
        installCmd = `cd /workspace && npm install ${depString}`;
      } else if (template === "python") {
        installCmd = `cd /workspace && pip install ${depString}`;
      } else {
        installCmd = `cd /workspace && cargo add ${depString}`;
      }

      await this.apiCall("POST", "/agent/exec", {
        command: installCmd,
        timeout_ms: 120_000,
      });
    }

    // Pause and snapshot
    await this.apiCall("PATCH", "/vm", { state: "Paused" });

    const snapshotId = generateId("snap");
    const snapshotPath = `${this.snapshotDir}/${snapshotId}`;

    await this.apiCall("PUT", "/snapshot/create", {
      snapshot_type: "Full",
      snapshot_path: snapshotPath,
      mem_file_path: `${snapshotPath}.mem`,
    });

    await this.apiCall("PUT", "/actions", {
      action_type: "SendCtrlAltDel",
    });

    const info: SnapshotInfo = {
      id: snapshotId,
      type: "project",
      template,
      projectId,
      parentId: baseSnapshotId,
      path: snapshotPath,
      memoryMb: baseSnapshot.memoryMb,
      diskMb: baseSnapshot.diskMb,
      incremental: false,
      ttlMs: this.defaultTtlMs,
      createdAt: new Date(),
    };

    this.snapshots.set(snapshotId, info);

    logger.info(
      { snapshotId, projectId, template, path: snapshotPath },
      "Project snapshot created"
    );

    return info;
  }

  /**
   * Restore a VM from a snapshot by ID.
   */
  async restoreFromSnapshot(snapshotId: string): Promise<SnapshotInfo> {
    const info = this.snapshots.get(snapshotId);
    if (!info) {
      throw new Error(`Snapshot ${snapshotId} not found`);
    }

    logger.info(
      { snapshotId, type: info.type, template: info.template },
      "Restoring VM from snapshot"
    );

    await this.apiCall("PUT", "/snapshot/load", {
      snapshot_path: info.path,
      mem_backend: {
        backend_type: "File",
        backend_path: `${info.path}.mem`,
      },
      enable_diff_snapshots: true,
      resume_vm: true,
    });

    logger.info({ snapshotId }, "VM restored from snapshot");
    return info;
  }

  /** Get the base snapshot ID for a given template */
  getTemplateSnapshotId(template: SnapshotTemplate): string | undefined {
    return this.templateSnapshots.get(template);
  }

  /** List all available snapshots, sorted by creation time descending */
  listSnapshots(): SnapshotInfo[] {
    return Array.from(this.snapshots.values()).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );
  }

  /** Get snapshot by ID */
  getSnapshot(id: string): SnapshotInfo | undefined {
    return this.snapshots.get(id);
  }

  /** Get count of snapshots by type */
  getSnapshotCounts(): Record<string, number> {
    const counts: Record<string, number> = {
      base: 0,
      project: 0,
      incremental: 0,
      total: 0,
    };

    for (const info of this.snapshots.values()) {
      counts[info.type] = (counts[info.type] ?? 0) + 1;
      counts.total = (counts.total ?? 0) + 1;
    }

    return counts;
  }

  /**
   * Delete a snapshot and its associated memory file.
   */
  async deleteSnapshot(id: string): Promise<void> {
    const info = this.snapshots.get(id);
    if (!info) {
      logger.warn({ snapshotId: id }, "Snapshot not found for deletion");
      return;
    }

    logger.info(
      { snapshotId: id, path: info.path, type: info.type },
      "Deleting snapshot"
    );

    // Delete snapshot files via the management API
    await this.apiCall("DELETE", `/snapshots/${id}`, {
      snapshot_path: info.path,
      mem_file_path: `${info.path}.mem`,
    });

    this.snapshots.delete(id);

    // Remove from template map if it was a template snapshot
    if (info.template) {
      const currentTemplateSnap = this.templateSnapshots.get(info.template);
      if (currentTemplateSnap === id) {
        this.templateSnapshots.delete(info.template);
      }
    }

    logger.info({ snapshotId: id }, "Snapshot deleted");
  }

  // ─── Private helpers ────────────────────────────────────────────────

  private isValidTemplate(template: string): template is SnapshotTemplate {
    return template === "node" || template === "python" || template === "rust";
  }

  /**
   * Make an HTTP request to the Firecracker management daemon.
   */
  private async apiCall(
    method: string,
    path: string,
    body?: Record<string, unknown>
  ): Promise<unknown> {
    const url = `${this.apiBase}${path}`;

    logger.debug({ method, path, url }, "Firecracker API request");

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
