/**
 * Phase 14: Firecracker Snapshot Manager.
 * Manages base and project-specific microVM snapshots for fast restore.
 */
import { createLogger } from "@prometheus/logger";

const logger = createLogger("sandbox-manager:snapshot-manager");

/** Default Firecracker management daemon endpoint */
const DEFAULT_API_BASE = "http://localhost:8080";

interface SnapshotConfig {
  /** Base URL for the Firecracker management daemon */
  apiBase?: string;
  /** Directory to store snapshot files */
  snapshotDir?: string;
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
  memoryMb: number;
  path: string;
  projectId: string | null;
  type: "base" | "project";
}

/**
 * Manages Firecracker microVM snapshots.
 *
 * Base snapshot: Alpine Linux + Node 22 + Python 3.12 + Git
 * Project snapshots: Base + project-specific dependencies pre-installed
 *
 * Snapshots enable sub-100ms VM boot times by restoring from a
 * pre-configured memory image rather than cold-booting.
 *
 * Note: HTTP calls to the Firecracker API are stubbed for development.
 */
export class SnapshotManager {
  private readonly apiBase: string;
  private readonly snapshotDir: string;
  private readonly snapshots = new Map<string, SnapshotInfo>();

  constructor(config?: SnapshotConfig) {
    this.apiBase =
      config?.apiBase ?? process.env.FIRECRACKER_API_BASE ?? DEFAULT_API_BASE;
    this.snapshotDir =
      config?.snapshotDir ??
      process.env.FIRECRACKER_SNAPSHOT_DIR ??
      "/var/lib/firecracker/snapshots";
  }

  /**
   * Create a base snapshot with Alpine + Node 22 + Python 3.12 + Git.
   * This is the foundation for all project-specific snapshots.
   */
  async createBaseSnapshot(config?: BaseSnapshotConfig): Promise<SnapshotInfo> {
    const vcpuCount = config?.vcpuCount ?? 1;
    const memoryMb = config?.memoryMb ?? 512;
    const diskMb = config?.diskMb ?? 1024;

    logger.info(
      { vcpuCount, memoryMb, diskMb },
      "Creating base snapshot (Alpine + Node 22 + Python 3.12 + Git)"
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

    // 2. Install base packages inside the VM
    await this.apiCall("POST", "/exec", {
      command:
        "apk add --no-cache nodejs npm python3 py3-pip git && mkdir -p /workspace",
    });

    // 3. Pause the VM and take a snapshot
    await this.apiCall("PATCH", "/vm", { state: "Paused" });

    const snapshotId = `snap_base_${Date.now()}`;
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
      projectId: null,
      path: snapshotPath,
      memoryMb,
      diskMb,
      createdAt: new Date(),
    };

    this.snapshots.set(snapshotId, info);

    logger.info({ snapshotId, path: snapshotPath }, "Base snapshot created");
    return info;
  }

  /**
   * Create a project-specific snapshot with dependencies pre-installed.
   * Starts from the base snapshot and installs project deps.
   */
  async createProjectSnapshot(
    projectId: string,
    baseDeps: string[]
  ): Promise<SnapshotInfo> {
    logger.info(
      { projectId, depCount: baseDeps.length },
      "Creating project snapshot"
    );

    // 1. Restore from the latest base snapshot
    const baseSnapshot = this.getLatestBaseSnapshot();
    if (!baseSnapshot) {
      throw new Error("No base snapshot available. Create one first.");
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

    // 2. Install project-specific dependencies
    if (baseDeps.length > 0) {
      const depString = baseDeps.join(" ");
      await this.apiCall("POST", "/exec", {
        command: `cd /workspace && npm install ${depString}`,
      });
    }

    // 3. Pause and snapshot
    await this.apiCall("PATCH", "/vm", { state: "Paused" });

    const snapshotId = `snap_proj_${projectId}_${Date.now()}`;
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
      projectId,
      path: snapshotPath,
      memoryMb: baseSnapshot.memoryMb,
      diskMb: baseSnapshot.diskMb,
      createdAt: new Date(),
    };

    this.snapshots.set(snapshotId, info);

    logger.info(
      { snapshotId, projectId, path: snapshotPath },
      "Project snapshot created"
    );
    return info;
  }

  /**
   * Restore a VM from a snapshot. Returns the snapshot info
   * so the caller can configure the VM with the right resources.
   */
  async restoreFromSnapshot(snapshotId: string): Promise<SnapshotInfo> {
    const info = this.snapshots.get(snapshotId);
    if (!info) {
      throw new Error(`Snapshot ${snapshotId} not found`);
    }

    logger.info(
      { snapshotId, type: info.type, projectId: info.projectId },
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

  /**
   * List all available snapshots.
   */
  listSnapshots(): SnapshotInfo[] {
    return Array.from(this.snapshots.values()).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );
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

    logger.info({ snapshotId: id, path: info.path }, "Deleting snapshot");

    // In production, delete the snapshot and mem files from disk
    await this.apiCall("DELETE", `/snapshots/${id}`, {
      snapshot_path: info.path,
      mem_file_path: `${info.path}.mem`,
    });

    this.snapshots.delete(id);

    logger.info({ snapshotId: id }, "Snapshot deleted");
  }

  /**
   * Get the most recently created base snapshot.
   */
  private getLatestBaseSnapshot(): SnapshotInfo | undefined {
    const baseSnapshots = Array.from(this.snapshots.values())
      .filter((s) => s.type === "base")
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return baseSnapshots[0];
  }

  /**
   * Stub for Firecracker HTTP API calls.
   * In production, replace with real fetch() to the Firecracker daemon.
   */
  private apiCall(
    _method: string,
    _path: string,
    _body?: Record<string, unknown>
  ): Promise<unknown> {
    logger.debug(
      { method: _method, path: _path },
      "Firecracker API call (stubbed)"
    );

    return Promise.resolve({});
  }
}
