import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import type {
  ExecResult,
  SandboxConfig,
  SandboxInstance,
  SandboxProvider,
} from "../sandbox-provider";

const logger = createLogger("sandbox-manager:provider:e2b");

/** Target boot time for E2B managed infra */
const TARGET_BOOT_MS = 125;

/** Default execution timeout */
const DEFAULT_EXEC_TIMEOUT_MS = 60_000;

/** Snapshot TTL in milliseconds (1 hour) */
const SNAPSHOT_TTL_MS = 60 * 60 * 1000;

/**
 * Type definitions for the real @e2b/code-interpreter SDK.
 * Uses conditional dynamic imports since the package may not be installed.
 */
interface E2BSandbox {
  close: () => Promise<void>;
  filesystem: {
    list: (path: string) => Promise<Array<{ name: string }>>;
    read: (path: string) => Promise<string>;
    write: (path: string, content: string) => Promise<void>;
  };
  id: string;
  process: {
    start: (opts: { cmd: string; timeout?: number }) => Promise<{
      exitCode: number;
      stderr: string;
      stdout: string;
    }>;
  };
}

interface E2BCodeInterpreterModule {
  Sandbox: {
    create: (opts?: {
      apiKey?: string;
      metadata?: Record<string, string>;
      template?: string;
      timeout?: number;
    }) => Promise<E2BSandbox>;
    reconnect: (
      sandboxId: string,
      opts?: { apiKey?: string }
    ) => Promise<E2BSandbox>;
  };
}

interface SnapshotEntry {
  createdAt: number;
  sandboxId: string;
  snapshotId: string;
}

/** Cost tracking record for sandbox usage */
interface SandboxUsageRecord {
  cost: number;
  durationMs: number;
  endedAt: Date | null;
  orgId: string;
  provider: "e2b";
  sandboxId: string;
  startedAt: Date;
}

/**
 * E2B sandbox provider using the real @e2b/code-interpreter SDK.
 *
 * E2B provides managed cloud sandboxes with ~125ms boot times.
 * The SDK is loaded via conditional dynamic import so the provider
 * can be registered without requiring the package at build time.
 *
 * Features:
 * - Real E2B API calls via @e2b/code-interpreter SDK
 * - Snapshot/restore for session persistence
 * - Package installation for runtime customization
 * - Sandbox cost tracking per organization
 */
export class E2BProvider implements SandboxProvider {
  readonly name = "e2b" as const;

  private readonly apiKey: string;
  private readonly sandboxes = new Map<string, E2BSandbox>();
  private readonly instanceMap = new Map<string, SandboxInstance>();
  private readonly snapshots = new Map<string, SnapshotEntry>();
  private readonly usageRecords: SandboxUsageRecord[] = [];
  private e2bModule: E2BCodeInterpreterModule | null = null;
  private moduleLoadAttempted = false;

  /** Cost per sandbox minute in credits */
  private readonly costPerMinute: number;

  constructor(apiKey?: string, costPerMinute = 0.01) {
    this.apiKey = apiKey ?? process.env.E2B_API_KEY ?? "";
    this.costPerMinute = costPerMinute;
  }

  /**
   * Lazily load the @e2b/code-interpreter module.
   * Returns null if the package is not installed.
   */
  private async loadModule(): Promise<E2BCodeInterpreterModule | null> {
    if (this.moduleLoadAttempted) {
      return this.e2bModule;
    }

    this.moduleLoadAttempted = true;

    try {
      const mod = (await import(
        "@e2b/code-interpreter" as string
      )) as unknown as E2BCodeInterpreterModule;
      this.e2bModule = mod;
      logger.info("E2B code-interpreter SDK loaded successfully");
      return mod;
    } catch {
      logger.warn(
        "E2B code-interpreter SDK not available - install @e2b/code-interpreter to use this provider"
      );
      return null;
    }
  }

  /**
   * Ensure the SDK is loaded, throwing if unavailable.
   */
  private async requireModule(): Promise<E2BCodeInterpreterModule> {
    const mod = await this.loadModule();
    if (!mod) {
      throw new Error(
        "E2B provider requires @e2b/code-interpreter package. Install it with: pnpm add @e2b/code-interpreter"
      );
    }
    return mod;
  }

  async create(config: SandboxConfig): Promise<SandboxInstance> {
    const mod = await this.requireModule();
    const id = generateId("sbx");
    const startTime = Date.now();

    logger.info(
      { sandboxId: id, projectId: config.projectId },
      "Creating E2B sandbox"
    );

    const sandbox = await mod.Sandbox.create({
      apiKey: this.apiKey,
      template: this.resolveTemplate(config),
      timeout: TARGET_BOOT_MS * 10, // Allow 10x target as upper bound
      metadata: {
        projectId: config.projectId,
        prometheusId: id,
      },
    });

    const bootTime = Date.now() - startTime;

    const instance: SandboxInstance = {
      id,
      provider: "e2b",
      workDir: "/home/user",
      status: "running",
      containerId: sandbox.id,
      createdAt: new Date(),
    };

    this.sandboxes.set(id, sandbox);
    this.instanceMap.set(id, instance);

    // Start usage tracking
    this.startUsageTracking(id, config.projectId);

    logger.info(
      {
        sandboxId: id,
        e2bId: sandbox.id,
        bootTimeMs: bootTime,
        targetMs: TARGET_BOOT_MS,
      },
      "E2B sandbox created"
    );

    return instance;
  }

  async destroy(sandboxId: string): Promise<void> {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) {
      return;
    }

    // Stop usage tracking
    this.stopUsageTracking(sandboxId);

    try {
      await sandbox.close();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn({ sandboxId, error: msg }, "Error closing E2B sandbox");
    }

    this.sandboxes.delete(sandboxId);
    const instance = this.instanceMap.get(sandboxId);
    if (instance) {
      instance.status = "stopped";
    }
    this.instanceMap.delete(sandboxId);

    logger.info({ sandboxId }, "E2B sandbox destroyed");
  }

  async exec(
    sandboxId: string,
    command: string,
    timeout?: number
  ): Promise<ExecResult> {
    const sandbox = this.getSandboxOrThrow(sandboxId);
    const effectiveTimeout = timeout ?? DEFAULT_EXEC_TIMEOUT_MS;
    const startTime = Date.now();

    try {
      const result = await sandbox.process.start({
        cmd: command,
        timeout: effectiveTimeout,
      });

      const duration = Date.now() - startTime;

      return {
        exitCode: result.exitCode,
        output: result.stdout,
        stderr: result.stderr,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const msg = error instanceof Error ? error.message : String(error);

      return {
        exitCode: 1,
        output: "",
        stderr: msg,
        duration,
      };
    }
  }

  async isHealthy(sandboxId: string): Promise<boolean> {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) {
      return false;
    }

    try {
      const result = await sandbox.process.start({
        cmd: "echo ok",
        timeout: 5000,
      });
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  async readFile(sandboxId: string, path: string): Promise<string> {
    const sandbox = this.getSandboxOrThrow(sandboxId);
    return await sandbox.filesystem.read(path);
  }

  async writeFile(
    sandboxId: string,
    path: string,
    content: string
  ): Promise<void> {
    const sandbox = this.getSandboxOrThrow(sandboxId);
    await sandbox.filesystem.write(path, content);
    logger.debug({ sandboxId, path }, "File written in E2B sandbox");
  }

  async listFiles(sandboxId: string, path: string): Promise<string[]> {
    const sandbox = this.getSandboxOrThrow(sandboxId);
    const entries = await sandbox.filesystem.list(path);
    return entries.map((entry) => entry.name);
  }

  /**
   * Take a snapshot of a running sandbox.
   * Returns a snapshot ID that can be used to restore later.
   */
  snapshot(sandboxId: string): Promise<string> {
    const sandbox = this.getSandboxOrThrow(sandboxId);
    const snapshotId = generateId("snap");

    logger.info(
      { sandboxId, snapshotId, e2bId: sandbox.id },
      "Creating E2B sandbox snapshot"
    );

    // E2B snapshots are handled by preserving the sandbox ID for reconnection.
    // The sandbox ID itself acts as the snapshot reference.
    this.snapshots.set(snapshotId, {
      snapshotId,
      sandboxId,
      createdAt: Date.now(),
    });

    logger.info({ snapshotId, sandboxId }, "E2B snapshot created");
    return Promise.resolve(snapshotId);
  }

  /**
   * Restore a sandbox from a previously taken snapshot.
   * Uses E2B's reconnect API to re-attach to a preserved sandbox.
   */
  async restore(snapshotId: string): Promise<SandboxInstance> {
    const entry = this.snapshots.get(snapshotId);
    if (!entry) {
      throw new Error(`Snapshot ${snapshotId} not found`);
    }

    // Check TTL
    if (Date.now() - entry.createdAt > SNAPSHOT_TTL_MS) {
      this.snapshots.delete(snapshotId);
      throw new Error(`Snapshot ${snapshotId} has expired (TTL exceeded)`);
    }

    const mod = await this.requireModule();
    const id = generateId("sbx");

    logger.info(
      { snapshotId, newSandboxId: id },
      "Restoring E2B sandbox from snapshot"
    );

    // Reconnect to the preserved sandbox using the original E2B sandbox ID
    const originalSandbox = this.sandboxes.get(entry.sandboxId);
    const e2bSandboxId = originalSandbox?.id ?? entry.sandboxId;

    const sandbox = await mod.Sandbox.reconnect(e2bSandboxId, {
      apiKey: this.apiKey,
    });

    const instance: SandboxInstance = {
      id,
      provider: "e2b",
      workDir: "/home/user",
      status: "running",
      containerId: sandbox.id,
      createdAt: new Date(),
    };

    this.sandboxes.set(id, sandbox);
    this.instanceMap.set(id, instance);

    logger.info(
      { snapshotId, sandboxId: id, e2bId: sandbox.id },
      "E2B sandbox restored from snapshot"
    );

    return instance;
  }

  /**
   * Install packages inside a running sandbox.
   * Detects package manager based on available lock files.
   */
  async installPackages(sandboxId: string, packages: string[]): Promise<void> {
    if (packages.length === 0) {
      return;
    }

    const sandbox = this.getSandboxOrThrow(sandboxId);
    const packageList = packages.join(" ");

    logger.info(
      { sandboxId, packageCount: packages.length },
      "Installing packages in E2B sandbox"
    );

    // Detect package manager by checking for lock files
    const detectResult = await sandbox.process.start({
      cmd: 'test -f package-lock.json && echo "npm" || (test -f yarn.lock && echo "yarn" || (test -f pnpm-lock.yaml && echo "pnpm" || echo "npm"))',
      timeout: 5000,
    });

    const packageManager = detectResult.stdout.trim() || "npm";
    let installCmd: string;
    if (packageManager === "pnpm") {
      installCmd = `pnpm add ${packageList}`;
    } else if (packageManager === "yarn") {
      installCmd = `yarn add ${packageList}`;
    } else {
      installCmd = `npm install ${packageList}`;
    }

    const result = await sandbox.process.start({
      cmd: installCmd,
      timeout: 120_000,
    });

    if (result.exitCode !== 0) {
      throw new Error(
        `Package installation failed (exit ${result.exitCode}): ${result.stderr}`
      );
    }

    logger.info(
      { sandboxId, packages, packageManager },
      "Packages installed in E2B sandbox"
    );
  }

  /**
   * Clean up expired snapshots.
   * Returns the number of snapshots removed.
   */
  cleanupExpiredSnapshots(): number {
    const now = Date.now();
    let removed = 0;

    for (const [id, entry] of this.snapshots) {
      if (now - entry.createdAt > SNAPSHOT_TTL_MS) {
        this.snapshots.delete(id);
        removed++;
      }
    }

    if (removed > 0) {
      logger.info({ removed }, "Cleaned up expired E2B snapshots");
    }

    return removed;
  }

  // ─── Cost tracking ───────────────────────────────────────────────────

  /**
   * Record sandbox usage for cost tracking.
   * Cloud sandbox minutes count toward org credits.
   */
  recordSandboxUsage(
    orgId: string,
    provider: "e2b",
    durationMs: number,
    cost: number
  ): void {
    const record: SandboxUsageRecord = {
      sandboxId: generateId("usage"),
      orgId,
      provider,
      durationMs,
      cost,
      startedAt: new Date(Date.now() - durationMs),
      endedAt: new Date(),
    };

    this.usageRecords.push(record);

    logger.info(
      {
        orgId,
        provider,
        durationMinutes: Math.round((durationMs / 60_000) * 100) / 100,
        cost,
      },
      "Sandbox usage recorded"
    );
  }

  /** Get total usage cost for an organization */
  getUsageCost(orgId: string): { totalCost: number; totalMinutes: number } {
    let totalCost = 0;
    let totalMs = 0;

    for (const record of this.usageRecords) {
      if (record.orgId === orgId) {
        totalCost += record.cost;
        totalMs += record.durationMs;
      }
    }

    return {
      totalCost,
      totalMinutes: Math.round((totalMs / 60_000) * 100) / 100,
    };
  }

  /** Get the number of active sandboxes */
  getActiveCount(): number {
    return this.sandboxes.size;
  }

  /** Get the number of stored snapshots */
  getSnapshotCount(): number {
    return this.snapshots.size;
  }

  /**
   * Shut down all active sandboxes.
   */
  async shutdown(): Promise<void> {
    logger.info(
      { activeCount: this.sandboxes.size },
      "Shutting down E2B provider"
    );

    const destroyPromises: Promise<void>[] = [];
    for (const [sandboxId] of this.sandboxes) {
      destroyPromises.push(this.destroy(sandboxId));
    }
    await Promise.allSettled(destroyPromises);

    this.snapshots.clear();
    logger.info("E2B provider shut down");
  }

  // ─── Private helpers ────────────────────────────────────────────────

  private getSandboxOrThrow(sandboxId: string): E2BSandbox {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) {
      throw new Error(`E2B sandbox ${sandboxId} not found`);
    }
    return sandbox;
  }

  /**
   * Map sandbox config trust levels to E2B template names.
   */
  private resolveTemplate(_config: SandboxConfig): string {
    return "base";
  }

  /**
   * Start tracking usage for a sandbox.
   */
  private startUsageTracking(sandboxId: string, orgId: string): void {
    const record: SandboxUsageRecord = {
      sandboxId,
      orgId,
      provider: "e2b",
      durationMs: 0,
      cost: 0,
      startedAt: new Date(),
      endedAt: null,
    };

    this.usageRecords.push(record);
  }

  /**
   * Stop tracking usage and calculate final cost.
   */
  private stopUsageTracking(sandboxId: string): void {
    const record = this.usageRecords.find(
      (r) => r.sandboxId === sandboxId && r.endedAt === null
    );

    if (!record) {
      return;
    }

    record.endedAt = new Date();
    record.durationMs = record.endedAt.getTime() - record.startedAt.getTime();
    record.cost = (record.durationMs / 60_000) * this.costPerMinute;

    logger.info(
      {
        sandboxId,
        durationMinutes: Math.round((record.durationMs / 60_000) * 100) / 100,
        cost: record.cost,
      },
      "Sandbox usage tracking completed"
    );
  }
}
