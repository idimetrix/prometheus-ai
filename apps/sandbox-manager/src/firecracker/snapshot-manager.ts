/**
 * Firecracker Snapshot Manager.
 *
 * Manages base template snapshots (node, python, rust, go, java, multi),
 * incremental session snapshots, warmup pool for instant allocation,
 * and TTL-based expiry for automatic cleanup.
 *
 * Snapshots enable sub-100ms VM boot times by restoring from a
 * pre-configured memory image rather than cold-booting.
 *
 * Features:
 * - LRU eviction when storage exceeds capacity
 * - Local SSD snapshot storage
 * - Base snapshot creation after VM init
 * - Restore targeting <100ms
 * - Warmup pool for pre-allocated snapshots
 * - Boot time tracking with percentile calculation
 * - Auto-detect template from manifest files
 */
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";

const logger = createLogger("sandbox-manager:snapshot-manager");

/** Default Firecracker management daemon endpoint */
const DEFAULT_API_BASE = "http://localhost:8080";

/** Default snapshot TTL: 1 hour */
const DEFAULT_SNAPSHOT_TTL_MS = 60 * 60 * 1000;

/** Default max storage bytes: 10GB */
const DEFAULT_MAX_STORAGE_BYTES = 10 * 1024 * 1024 * 1024;

/** Default warmup pool size per template */
const DEFAULT_WARMUP_POOL_SIZE = 3;

/** Supported template types */
export type SnapshotTemplate =
  | "node"
  | "python"
  | "rust"
  | "go"
  | "java"
  | "multi";

/** Template-specific setup commands */
const TEMPLATE_SETUP_COMMANDS: Record<SnapshotTemplate, string> = {
  node: "apk add --no-cache nodejs npm git && mkdir -p /workspace && node --version",
  python:
    "apk add --no-cache python3 py3-pip git && mkdir -p /workspace && python3 --version",
  rust: "apk add --no-cache rust cargo git && mkdir -p /workspace && rustc --version",
  go: "apk add --no-cache go git && mkdir -p /workspace && go version",
  java: "apk add --no-cache openjdk17-jdk maven git && mkdir -p /workspace && java --version",
  multi:
    "apk add --no-cache nodejs npm python3 py3-pip go git && mkdir -p /workspace",
};

/** Manifest file to template mapping for auto-detection */
const MANIFEST_TEMPLATE_MAP: Record<string, SnapshotTemplate> = {
  "package.json": "node",
  "requirements.txt": "python",
  Pipfile: "python",
  "pyproject.toml": "python",
  "setup.py": "python",
  "Cargo.toml": "rust",
  "go.mod": "go",
  "go.sum": "go",
  "pom.xml": "java",
  "build.gradle": "java",
  "build.gradle.kts": "java",
};

interface SnapshotConfig {
  /** Base URL for the Firecracker management daemon */
  apiBase?: string;
  /** Maximum total storage in bytes for snapshots (for LRU eviction) */
  maxStorageBytes?: number;
  /** Directory to store snapshot files */
  snapshotDir?: string;
  /** Snapshot TTL in milliseconds (default: 1 hour) */
  ttlMs?: number;
  /** Number of pre-warmed snapshots per template (default: 3) */
  warmupPoolSize?: number;
}

interface BaseSnapshotConfig {
  /** Disk size in MB for the rootfs */
  diskMb?: number;
  /** Memory allocation in MB */
  memoryMb?: number;
  /** Number of vCPUs */
  vcpuCount?: number;
}

export interface SnapshotMetadata {
  createdAt: Date;
  id: string;
  sizeBytes: number;
  vmConfig: {
    diskMb: number;
    memoryMb: number;
    template: SnapshotTemplate | null;
    vcpuCount: number;
  };
}

interface SnapshotInfo {
  createdAt: Date;
  diskMb: number;
  id: string;
  /** Whether this is an incremental (diff) snapshot */
  incremental: boolean;
  /** Last access time for LRU eviction */
  lastAccessedAt: Date;
  memoryMb: number;
  /** Parent snapshot ID for incremental snapshots */
  parentId: string | null;
  path: string;
  projectId: string | null;
  /** Estimated size in bytes */
  sizeBytes: number;
  /** Template this snapshot was created from */
  template: SnapshotTemplate | null;
  ttlMs: number;
  type: "base" | "project" | "incremental";
  /** vCPU count used when snapshot was taken */
  vcpuCount: number;
}

/** Warmup pool entry: a pre-allocated snapshot ready for instant use */
interface WarmupEntry {
  createdAt: Date;
  snapshotId: string;
  template: SnapshotTemplate;
}

/** Boot time percentile statistics */
export interface BootTimeStats {
  count: number;
  maxMs: number;
  meanMs: number;
  minMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

export class SnapshotManager {
  private readonly apiBase: string;
  private readonly snapshotDir: string;
  private readonly defaultTtlMs: number;
  private readonly maxStorageBytes: number;
  private readonly warmupPoolSize: number;
  private readonly snapshots = new Map<string, SnapshotInfo>();
  /** Track base snapshots per template for fast lookup */
  private readonly templateSnapshots = new Map<SnapshotTemplate, string>();
  /** Pre-warmed snapshot pool for instant allocation */
  private readonly warmupPool = new Map<SnapshotTemplate, WarmupEntry[]>();
  /** Boot time history for percentile tracking (bounded) */
  private readonly bootTimes: number[] = [];
  private static readonly MAX_BOOT_TIME_HISTORY = 1000;

  constructor(config?: SnapshotConfig) {
    this.apiBase =
      config?.apiBase ?? process.env.FIRECRACKER_API_BASE ?? DEFAULT_API_BASE;
    this.snapshotDir =
      config?.snapshotDir ??
      process.env.FIRECRACKER_SNAPSHOT_DIR ??
      "/var/lib/firecracker/snapshots";
    this.defaultTtlMs = config?.ttlMs ?? DEFAULT_SNAPSHOT_TTL_MS;
    this.maxStorageBytes = config?.maxStorageBytes ?? DEFAULT_MAX_STORAGE_BYTES;
    this.warmupPoolSize = config?.warmupPoolSize ?? DEFAULT_WARMUP_POOL_SIZE;
  }

  /**
   * Create a base snapshot after VM initialization.
   * This is the primary method for snapshot-based fast boot.
   */
  async createBaseSnapshot(
    vmId: string,
    template?: SnapshotTemplate,
    config?: BaseSnapshotConfig
  ): Promise<SnapshotMetadata> {
    const vcpuCount = config?.vcpuCount ?? 1;
    const memoryMb = config?.memoryMb ?? 512;
    const diskMb = config?.diskMb ?? 1024;

    logger.info(
      { vmId, template, vcpuCount, memoryMb, diskMb },
      "Creating base snapshot after VM init"
    );

    // If template is provided, set up the environment first
    if (template) {
      const setupCommand = TEMPLATE_SETUP_COMMANDS[template];
      await this.apiCall("POST", `/vms/${vmId}/agent/exec`, {
        command: setupCommand,
        timeout_ms: 120_000,
      });
    }

    // Pause the VM before snapshotting
    await this.apiCall("PATCH", `/vms/${vmId}/vm`, { state: "Paused" });

    const snapshotId = generateId("snap");
    const snapshotPath = `${this.snapshotDir}/${snapshotId}`;

    await this.apiCall("PUT", `/vms/${vmId}/snapshot/create`, {
      snapshot_type: "Full",
      snapshot_path: snapshotPath,
      mem_file_path: `${snapshotPath}.mem`,
    });

    // Resume the VM after snapshot
    await this.apiCall("PATCH", `/vms/${vmId}/vm`, { state: "Resumed" });

    // Estimate snapshot size (memory + rootfs state)
    const estimatedSizeBytes = (memoryMb + diskMb / 4) * 1024 * 1024;

    const info: SnapshotInfo = {
      id: snapshotId,
      type: "base",
      template: template ?? null,
      projectId: null,
      parentId: null,
      path: snapshotPath,
      memoryMb,
      diskMb,
      vcpuCount,
      incremental: false,
      sizeBytes: estimatedSizeBytes,
      ttlMs: this.defaultTtlMs,
      createdAt: new Date(),
      lastAccessedAt: new Date(),
    };

    this.snapshots.set(snapshotId, info);

    // Track as template snapshot if applicable
    if (template) {
      this.templateSnapshots.set(template, snapshotId);
    }

    // Evict old snapshots if over storage limit
    await this.evictIfNeeded();

    logger.info(
      {
        snapshotId,
        path: snapshotPath,
        template,
        sizeBytes: estimatedSizeBytes,
      },
      "Base snapshot created"
    );

    return this.toMetadata(info);
  }

  /**
   * Restore a VM from a snapshot. Target: <100ms restore time.
   * Uses Firecracker's snapshot/load API with memory file backend.
   * Tracks boot time for percentile calculation.
   */
  async restoreFromSnapshot(snapshotId: string): Promise<SnapshotMetadata> {
    const info = this.snapshots.get(snapshotId);
    if (!info) {
      throw new Error(`Snapshot ${snapshotId} not found`);
    }

    const startTime = Date.now();

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

    const restoreTimeMs = Date.now() - startTime;
    info.lastAccessedAt = new Date();

    // Track boot time
    this.recordBootTime(restoreTimeMs);

    logger.info(
      { snapshotId, restoreTimeMs, targetMs: 100 },
      "VM restored from snapshot"
    );

    return this.toMetadata(info);
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
      vcpuCount: 1,
      incremental: false,
      sizeBytes: 512 * 1024 * 1024,
      ttlMs: this.defaultTtlMs,
      createdAt: new Date(),
      lastAccessedAt: new Date(),
    };

    this.snapshots.set(snapshotId, info);

    // Track as template snapshot if applicable
    if (snapshotTemplate) {
      this.templateSnapshots.set(snapshotTemplate, snapshotId);
    }

    await this.evictIfNeeded();

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
    const startTime = Date.now();

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

    const restoreTimeMs = Date.now() - startTime;
    this.recordBootTime(restoreTimeMs);

    logger.info(
      { snapshotPath, sandboxId, restoreTimeMs },
      "Snapshot restored"
    );

    return sandboxId;
  }

  /**
   * List all available snapshots, sorted by creation time descending.
   */
  listSnapshots(): SnapshotMetadata[] {
    return Array.from(this.snapshots.values())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((info) => this.toMetadata(info));
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
   * Create an incremental snapshot during a session.
   * These are diff-based and smaller than full snapshots.
   */
  async createIncrementalSnapshot(
    sandboxId: string,
    parentSnapshotId: string
  ): Promise<SnapshotMetadata> {
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

    // Incremental snapshots are typically 10-20% of full size
    const estimatedSizeBytes = Math.round(parent.sizeBytes * 0.15);

    const info: SnapshotInfo = {
      id: snapshotId,
      type: "incremental",
      template: parent.template,
      projectId: parent.projectId,
      parentId: parentSnapshotId,
      path: snapshotPath,
      memoryMb: parent.memoryMb,
      diskMb: parent.diskMb,
      vcpuCount: parent.vcpuCount,
      incremental: true,
      sizeBytes: estimatedSizeBytes,
      ttlMs: this.defaultTtlMs,
      createdAt: new Date(),
      lastAccessedAt: new Date(),
    };

    this.snapshots.set(snapshotId, info);

    await this.evictIfNeeded();

    logger.info(
      { snapshotId, parentSnapshotId, path: snapshotPath },
      "Incremental snapshot created"
    );

    return this.toMetadata(info);
  }

  /**
   * Create a project-specific snapshot with dependencies pre-installed.
   */
  async createProjectSnapshot(
    projectId: string,
    template: SnapshotTemplate,
    baseDeps: string[]
  ): Promise<SnapshotMetadata> {
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
      } else if (template === "go") {
        installCmd = `cd /workspace && go get ${depString}`;
      } else if (template === "java") {
        installCmd = "cd /workspace && mvn dependency:resolve";
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

    const estimatedSizeBytes =
      (baseSnapshot.memoryMb + baseSnapshot.diskMb / 4) * 1024 * 1024;

    const info: SnapshotInfo = {
      id: snapshotId,
      type: "project",
      template,
      projectId,
      parentId: baseSnapshotId,
      path: snapshotPath,
      memoryMb: baseSnapshot.memoryMb,
      diskMb: baseSnapshot.diskMb,
      vcpuCount: baseSnapshot.vcpuCount,
      incremental: false,
      sizeBytes: estimatedSizeBytes,
      ttlMs: this.defaultTtlMs,
      createdAt: new Date(),
      lastAccessedAt: new Date(),
    };

    this.snapshots.set(snapshotId, info);

    await this.evictIfNeeded();

    logger.info(
      { snapshotId, projectId, template, path: snapshotPath },
      "Project snapshot created"
    );

    return this.toMetadata(info);
  }

  /** Get the base snapshot ID for a given template */
  getTemplateSnapshotId(template: SnapshotTemplate): string | undefined {
    return this.templateSnapshots.get(template);
  }

  /** Get snapshot by ID */
  getSnapshot(id: string): SnapshotMetadata | undefined {
    const info = this.snapshots.get(id);
    return info ? this.toMetadata(info) : undefined;
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

  /** Get total storage used by all snapshots in bytes */
  getTotalStorageBytes(): number {
    let total = 0;
    for (const info of this.snapshots.values()) {
      total += info.sizeBytes;
    }
    return total;
  }

  // ─── Warmup Pool ───────────────────────────────────────────────────

  /**
   * Fill the warmup pool for a given template with pre-allocated snapshots.
   * Creates snapshots up to the configured pool size for instant allocation.
   */
  async fillWarmupPool(template: SnapshotTemplate): Promise<number> {
    const baseSnapshotId = this.templateSnapshots.get(template);
    if (!baseSnapshotId) {
      logger.warn(
        { template },
        "Cannot fill warmup pool: no base snapshot for template"
      );
      return 0;
    }

    const existing = this.warmupPool.get(template) ?? [];
    const needed = this.warmupPoolSize - existing.length;

    if (needed <= 0) {
      return 0;
    }

    logger.info(
      { template, needed, poolSize: this.warmupPoolSize },
      "Filling warmup pool"
    );

    let created = 0;
    for (let i = 0; i < needed; i++) {
      try {
        const metadata = await this.restoreFromSnapshot(baseSnapshotId);
        const entry: WarmupEntry = {
          snapshotId: metadata.id,
          template,
          createdAt: new Date(),
        };

        if (!this.warmupPool.has(template)) {
          this.warmupPool.set(template, []);
        }
        this.warmupPool.get(template)?.push(entry);
        created++;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.warn(
          { template, error: msg },
          "Failed to create warmup pool entry"
        );
        break;
      }
    }

    logger.info(
      {
        template,
        created,
        totalInPool: (this.warmupPool.get(template) ?? []).length,
      },
      "Warmup pool filled"
    );

    return created;
  }

  /**
   * Acquire a pre-warmed snapshot from the pool.
   * Returns the snapshot ID or undefined if pool is empty.
   */
  acquireFromWarmupPool(template: SnapshotTemplate): string | undefined {
    const pool = this.warmupPool.get(template);
    if (!pool || pool.length === 0) {
      return undefined;
    }

    const entry = pool.shift();
    if (!entry) {
      return undefined;
    }

    logger.info(
      {
        template,
        snapshotId: entry.snapshotId,
        remainingInPool: pool.length,
      },
      "Acquired snapshot from warmup pool"
    );

    return entry.snapshotId;
  }

  /**
   * Get the current warmup pool status for all templates.
   */
  getWarmupPoolStatus(): Record<SnapshotTemplate, number> {
    const status: Record<string, number> = {};
    for (const template of Object.keys(TEMPLATE_SETUP_COMMANDS)) {
      status[template] = (
        this.warmupPool.get(template as SnapshotTemplate) ?? []
      ).length;
    }
    return status as Record<SnapshotTemplate, number>;
  }

  // ─── Template Detection ────────────────────────────────────────────

  /**
   * Auto-detect the appropriate template from a list of manifest files
   * found in a project directory.
   */
  detectTemplate(manifestFiles: string[]): SnapshotTemplate | null {
    const templateScores = new Map<SnapshotTemplate, number>();

    for (const file of manifestFiles) {
      // Match against the filename (not full path)
      const filename = file.split("/").pop() ?? file;
      const template = MANIFEST_TEMPLATE_MAP[filename];
      if (template) {
        templateScores.set(template, (templateScores.get(template) ?? 0) + 1);
      }
    }

    if (templateScores.size === 0) {
      return null;
    }

    // If multiple templates detected, use "multi"
    if (templateScores.size > 1) {
      logger.info(
        { detectedTemplates: Array.from(templateScores.keys()) },
        "Multiple templates detected, using multi"
      );
      return "multi";
    }

    // Single template detected
    const detected = Array.from(templateScores.keys())[0];
    if (detected) {
      logger.info({ template: detected }, "Template auto-detected");
      return detected;
    }

    return null;
  }

  // ─── Boot Time Tracking ────────────────────────────────────────────

  /**
   * Record a boot/restore time measurement.
   */
  private recordBootTime(ms: number): void {
    this.bootTimes.push(ms);
    // Keep history bounded
    if (this.bootTimes.length > SnapshotManager.MAX_BOOT_TIME_HISTORY) {
      this.bootTimes.shift();
    }
  }

  /**
   * Get boot time statistics with percentile calculations.
   */
  getBootTimeStats(): BootTimeStats {
    if (this.bootTimes.length === 0) {
      return {
        count: 0,
        minMs: 0,
        maxMs: 0,
        meanMs: 0,
        p50Ms: 0,
        p95Ms: 0,
        p99Ms: 0,
      };
    }

    const sorted = [...this.bootTimes].sort((a, b) => a - b);
    const count = sorted.length;
    const sum = sorted.reduce((acc, v) => acc + v, 0);

    return {
      count,
      minMs: sorted[0] ?? 0,
      maxMs: sorted[count - 1] ?? 0,
      meanMs: Math.round(sum / count),
      p50Ms: this.percentile(sorted, 50),
      p95Ms: this.percentile(sorted, 95),
      p99Ms: this.percentile(sorted, 99),
    };
  }

  /**
   * Calculate the Nth percentile from a sorted array.
   */
  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) {
      return 0;
    }
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))] ?? 0;
  }

  // ─── Private helpers ────────────────────────────────────────────────

  /**
   * LRU eviction: remove least recently accessed snapshots when
   * total storage exceeds the configured maximum.
   */
  private async evictIfNeeded(): Promise<void> {
    let totalBytes = this.getTotalStorageBytes();

    if (totalBytes <= this.maxStorageBytes) {
      return;
    }

    // Sort by last accessed time (LRU = oldest first)
    const sorted = Array.from(this.snapshots.entries())
      .filter(([, info]) => info.type !== "base") // Never evict base templates
      .sort(
        ([, a], [, b]) =>
          a.lastAccessedAt.getTime() - b.lastAccessedAt.getTime()
      );

    for (const [id, info] of sorted) {
      if (totalBytes <= this.maxStorageBytes) {
        break;
      }

      logger.info(
        { snapshotId: id, sizeBytes: info.sizeBytes },
        "LRU eviction: removing snapshot"
      );

      try {
        await this.deleteSnapshot(id);
        totalBytes -= info.sizeBytes;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.warn({ snapshotId: id, error: msg }, "LRU eviction failed");
      }
    }
  }

  private toMetadata(info: SnapshotInfo): SnapshotMetadata {
    return {
      id: info.id,
      createdAt: info.createdAt,
      sizeBytes: info.sizeBytes,
      vmConfig: {
        memoryMb: info.memoryMb,
        diskMb: info.diskMb,
        vcpuCount: info.vcpuCount,
        template: info.template,
      },
    };
  }

  private isValidTemplate(template: string): template is SnapshotTemplate {
    return (
      template === "node" ||
      template === "python" ||
      template === "rust" ||
      template === "go" ||
      template === "java" ||
      template === "multi"
    );
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
