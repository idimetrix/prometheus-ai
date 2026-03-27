import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";

const logger = createLogger("sandbox-manager:provider:persistent");

const DEFAULT_CPU_LIMIT = 2;
const DEFAULT_MEMORY_MB = 2048;
const DEFAULT_DISK_MB = 20_480;
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

type PersistentSandboxStatus = "running" | "paused" | "destroyed";

interface PersistentSandbox {
  containerId: string;
  createdAt: Date;
  hostWorkDir: string;
  id: string;
  lastActivityAt: Date;
  orgId: string;
  projectId: string;
  status: PersistentSandboxStatus;
}

export interface PersistentSandboxInfo {
  createdAt: string;
  id: string;
  lastActivityAt: string;
  orgId: string;
  projectId: string;
  status: PersistentSandboxStatus;
}

/**
 * Persistent sandbox provider.
 *
 * Unlike ephemeral sandboxes, persistent sandboxes survive task completion.
 * Containers are stopped (not removed) after an idle timeout, and restarted
 * on-demand when the user reconnects. This preserves filesystem state,
 * installed packages, and git repos across sessions.
 *
 * Limits: max 1 persistent sandbox per project, 2GB RAM, 2 CPU, 20GB disk.
 */
/**
 * DB-ready sandbox persistence layer.
 * Currently uses in-memory Map; swap with Drizzle queries for production.
 * Schema: packages/db/src/schema/tables/sessions/persistent-sandboxes.ts
 */
export class PersistentSandboxProvider {
  private readonly sandboxes = new Map<string, PersistentSandbox>();
  /** Maps projectId -> sandboxId for the 1-per-project constraint */
  private readonly projectIndex = new Map<string, string>();
  private readonly image: string;
  private readonly baseDir: string;
  private idleCheckInterval: ReturnType<typeof setInterval> | null = null;

  constructor(image?: string) {
    this.image = image ?? process.env.SANDBOX_IMAGE ?? "node:20-slim";
    this.baseDir =
      process.env.PERSISTENT_SANDBOX_BASE_DIR ??
      join(tmpdir(), "prometheus-sandboxes", "persistent");
  }

  /**
   * Start the idle-pause background loop.
   * Should be called once during service startup.
   */
  startIdleMonitor(): void {
    if (this.idleCheckInterval) {
      return;
    }
    this.idleCheckInterval = setInterval(() => {
      this.pauseIdleSandboxes().catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn({ error: msg }, "Idle monitor tick failed");
      });
    }, 60_000); // check every minute
  }

  stopIdleMonitor(): void {
    if (this.idleCheckInterval) {
      clearInterval(this.idleCheckInterval);
      this.idleCheckInterval = null;
    }
  }

  /**
   * Get an existing persistent sandbox for this project, or create a new one.
   * Enforces the 1-per-project constraint.
   */
  async getOrCreate(
    projectId: string,
    orgId: string
  ): Promise<PersistentSandboxInfo> {
    const existingId = this.projectIndex.get(projectId);

    if (existingId) {
      const existing = this.sandboxes.get(existingId);
      if (existing) {
        // If paused, resume it
        if (existing.status === "paused") {
          await this.resume(existingId);
        }
        existing.lastActivityAt = new Date();
        return this.toInfo(existing);
      }
      // Stale index entry — clean up
      this.projectIndex.delete(projectId);
    }

    return this.create(projectId, orgId);
  }

  private async create(
    projectId: string,
    orgId: string
  ): Promise<PersistentSandboxInfo> {
    const id = generateId("psbx");
    const containerName = `prometheus-persistent-${id}`;

    const hostWorkDir = join(this.baseDir, id, "workspace");
    await mkdir(hostWorkDir, { recursive: true });

    const args = [
      "create",
      "--name",
      containerName,
      "--cpus",
      String(DEFAULT_CPU_LIMIT),
      "--memory",
      `${DEFAULT_MEMORY_MB}m`,
      "--memory-swap",
      `${DEFAULT_MEMORY_MB}m`,
      "--network",
      "bridge",
      "--security-opt",
      "no-new-privileges",
      "-v",
      `${hostWorkDir}:/workspace`,
      "--cap-drop",
      "ALL",
      "--cap-add",
      "CHOWN",
      "--cap-add",
      "DAC_OVERRIDE",
      "--cap-add",
      "FOWNER",
      "--cap-add",
      "SETGID",
      "--cap-add",
      "SETUID",
      "--pids-limit",
      "256",
      "--workdir",
      "/workspace",
      "--env",
      "NODE_ENV=development",
      "--env",
      "HOME=/home/sandbox",
      "--env",
      "TERM=xterm-256color",
      "--label",
      "prometheus.sandbox=true",
      "--label",
      "prometheus.sandbox.persistent=true",
      "--label",
      `prometheus.sandbox.id=${id}`,
      "--label",
      `prometheus.sandbox.projectId=${projectId}`,
      "--label",
      `prometheus.sandbox.orgId=${orgId}`,
      // Restart policy: unless manually stopped — helps survive daemon restarts
      "--restart",
      "unless-stopped",
      this.image,
      "sleep",
      "infinity",
    ];

    // Try with storage-opt first, fall back without
    let createResult = await this.spawnDocker([
      ...args.slice(0, args.indexOf(this.image)),
      "--storage-opt",
      `size=${DEFAULT_DISK_MB}M`,
      ...args.slice(args.indexOf(this.image)),
    ]);
    if (
      createResult.exitCode !== 0 &&
      createResult.stderr.includes("storage-opt")
    ) {
      logger.warn(
        "Docker storage-opt not supported, creating persistent sandbox without disk quota"
      );
      createResult = await this.spawnDocker(args);
    }
    if (createResult.exitCode !== 0) {
      throw new Error(
        `Failed to create persistent container: ${createResult.stderr}`
      );
    }

    const containerId = createResult.stdout.trim();

    const startResult = await this.spawnDocker(["start", containerId]);
    if (startResult.exitCode !== 0) {
      await this.spawnDocker(["rm", "-f", containerId]).catch(() => {
        /* best-effort */
      });
      throw new Error(
        `Failed to start persistent container: ${startResult.stderr}`
      );
    }

    const now = new Date();
    const sandbox: PersistentSandbox = {
      id,
      projectId,
      orgId,
      containerId,
      hostWorkDir,
      status: "running",
      createdAt: now,
      lastActivityAt: now,
    };

    this.sandboxes.set(id, sandbox);
    this.projectIndex.set(projectId, id);

    logger.info(
      {
        sandboxId: id,
        projectId,
        orgId,
        containerId: containerId.slice(0, 12),
      },
      "Persistent sandbox created"
    );

    return this.toInfo(sandbox);
  }

  /**
   * Pause (stop) a running persistent sandbox. The container is NOT removed.
   */
  async pause(sandboxId: string): Promise<void> {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) {
      throw new Error(`Persistent sandbox ${sandboxId} not found`);
    }
    if (sandbox.status === "paused") {
      return;
    }
    if (sandbox.status === "destroyed") {
      throw new Error(`Persistent sandbox ${sandboxId} has been destroyed`);
    }

    const result = await this.spawnDocker([
      "stop",
      "-t",
      "10",
      sandbox.containerId,
    ]);
    if (result.exitCode !== 0) {
      logger.warn(
        { sandboxId, error: result.stderr },
        "Docker stop returned non-zero (may already be stopped)"
      );
    }

    sandbox.status = "paused";
    logger.info({ sandboxId }, "Persistent sandbox paused");
  }

  /**
   * Resume a paused persistent sandbox.
   */
  async resume(sandboxId: string): Promise<void> {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) {
      throw new Error(`Persistent sandbox ${sandboxId} not found`);
    }
    if (sandbox.status === "running") {
      return;
    }
    if (sandbox.status === "destroyed") {
      throw new Error(`Persistent sandbox ${sandboxId} has been destroyed`);
    }

    const result = await this.spawnDocker(["start", sandbox.containerId]);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to resume persistent sandbox: ${result.stderr}`);
    }

    sandbox.status = "running";
    sandbox.lastActivityAt = new Date();
    logger.info({ sandboxId }, "Persistent sandbox resumed");
  }

  /**
   * Fully destroy a persistent sandbox — removes the container and host workspace.
   */
  async destroy(sandboxId: string): Promise<void> {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) {
      return;
    }

    await this.spawnDocker(["stop", "-t", "5", sandbox.containerId]).catch(
      () => {
        /* best-effort */
      }
    );
    await this.spawnDocker(["rm", "-f", sandbox.containerId]).catch(() => {
      /* best-effort */
    });

    // Clean up host workspace
    try {
      const { rm } = await import("node:fs/promises");
      const hostDir = join(this.baseDir, sandboxId);
      await rm(hostDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }

    sandbox.status = "destroyed";
    this.projectIndex.delete(sandbox.projectId);
    this.sandboxes.delete(sandboxId);

    logger.info(
      { sandboxId, projectId: sandbox.projectId },
      "Persistent sandbox destroyed"
    );
  }

  /**
   * Get the current status of a persistent sandbox by sandbox ID.
   */
  getStatus(sandboxId: string): PersistentSandboxInfo | null {
    const sandbox = this.sandboxes.get(sandboxId);
    return sandbox ? this.toInfo(sandbox) : null;
  }

  /**
   * Get the persistent sandbox for a given project.
   */
  getByProject(projectId: string): PersistentSandboxInfo | null {
    const sandboxId = this.projectIndex.get(projectId);
    if (!sandboxId) {
      return null;
    }
    return this.getStatus(sandboxId);
  }

  /**
   * List all active (running or paused) persistent sandboxes for an org.
   */
  listActive(orgId: string): PersistentSandboxInfo[] {
    const results: PersistentSandboxInfo[] = [];
    for (const sandbox of this.sandboxes.values()) {
      if (sandbox.orgId === orgId && sandbox.status !== "destroyed") {
        results.push(this.toInfo(sandbox));
      }
    }
    return results;
  }

  /**
   * Record activity on a sandbox (prevents idle pause).
   */
  touch(sandboxId: string): void {
    const sandbox = this.sandboxes.get(sandboxId);
    if (sandbox) {
      sandbox.lastActivityAt = new Date();
    }
  }

  /**
   * Pause all sandboxes that have been idle for longer than the threshold.
   */
  private async pauseIdleSandboxes(): Promise<void> {
    const now = Date.now();
    const promises: Promise<void>[] = [];

    for (const sandbox of this.sandboxes.values()) {
      if (sandbox.status !== "running") {
        continue;
      }
      const idleMs = now - sandbox.lastActivityAt.getTime();
      if (idleMs >= IDLE_TIMEOUT_MS) {
        logger.info(
          { sandboxId: sandbox.id, idleMs },
          "Auto-pausing idle persistent sandbox"
        );
        promises.push(this.pause(sandbox.id));
      }
    }

    await Promise.allSettled(promises);
  }

  /**
   * Gracefully shut down — pause all running sandboxes.
   */
  async shutdown(): Promise<void> {
    this.stopIdleMonitor();
    const promises: Promise<void>[] = [];
    for (const sandbox of this.sandboxes.values()) {
      if (sandbox.status === "running") {
        promises.push(this.pause(sandbox.id));
      }
    }
    await Promise.allSettled(promises);
    logger.info("Persistent sandbox provider shut down");
  }

  private toInfo(sandbox: PersistentSandbox): PersistentSandboxInfo {
    return {
      id: sandbox.id,
      projectId: sandbox.projectId,
      orgId: sandbox.orgId,
      status: sandbox.status,
      createdAt: sandbox.createdAt.toISOString(),
      lastActivityAt: sandbox.lastActivityAt.toISOString(),
    };
  }

  private spawnDocker(
    args: string[],
    timeout = 30_000
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      const child = spawn("docker", args, {
        timeout,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf-8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf-8");
      });

      child.on("close", (code) => {
        resolve({
          exitCode: code ?? 1,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        });
      });

      child.on("error", (err) => {
        resolve({ exitCode: 1, stdout: "", stderr: err.message });
      });
    });
  }
}
