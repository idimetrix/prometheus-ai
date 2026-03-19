import type { ChildProcess } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "@prometheus/logger";
import { DevProvider } from "./providers/dev";
import { DockerProvider } from "./providers/docker";
import { FirecrackerProvider } from "./providers/firecracker";
import type { SandboxProvider } from "./sandbox-provider";
import { validateCommand, validateTimeout } from "./security";

const logger = createLogger("sandbox-manager:container");

type SandboxMode = "docker" | "firecracker" | "dev";

/**
 * Determine sandbox execution mode:
 * 1. SANDBOX_MODE env var takes priority ("docker" | "firecracker" | "dev")
 * 2. NODE_ENV=production defaults to "docker"
 * 3. Otherwise, auto-detect: use Docker if available, fall back to dev
 */
async function detectSandboxMode(): Promise<SandboxMode> {
  const explicit = process.env.SANDBOX_MODE?.toLowerCase();
  if (explicit === "docker") {
    return "docker";
  }
  if (explicit === "firecracker") {
    return "firecracker";
  }
  if (explicit === "dev") {
    return "dev";
  }

  if (process.env.NODE_ENV === "production") {
    return "docker";
  }

  // Auto-detect: check if Docker daemon is reachable via spawn (not shell)
  try {
    const available = await DockerProvider.isAvailable();
    if (available) {
      logger.info("Docker detected, using container mode");
      return "docker";
    }
  } catch {
    // Fall through to dev mode
  }

  logger.info(
    "Docker not available, using dev mode (temp directories + child_process)"
  );
  return "dev";
}

export interface ContainerInfo {
  containerId: string;
  cpuLimit: number;
  createdAt: Date;
  id: string;
  lastUsedAt: Date;
  memoryLimitMb: number;
  projectId: string | null;
  sessionId: string | null;
  status: "creating" | "ready" | "busy" | "stopping" | "stopped";
  workspacePath: string;
}

export interface ExecResult {
  duration: number;
  exitCode: number;
  stderr: string;
  stdout: string;
}

export interface CreateContainerOptions {
  branch?: string;
  cpuLimit?: number;
  memoryLimitMb?: number;
  projectId?: string;
  repoUrl?: string;
}

/**
 * ContainerManager uses the SandboxProvider abstraction to manage sandboxes.
 *
 * Supports three modes: docker, firecracker, and dev.
 * Maintains backward compatibility with the original API while delegating
 * to the appropriate provider implementation.
 *
 * Note: All process spawning is handled by the individual providers
 * using spawn() with explicit argument arrays (not shell strings).
 */
export class ContainerManager {
  private provider: SandboxProvider | null = null;
  private mode: SandboxMode = "dev";
  private modeResolved = false;
  private readonly containers = new Map<string, ContainerInfo>();
  private readonly runningProcesses = new Map<string, Set<ChildProcess>>();
  private readonly image = process.env.SANDBOX_IMAGE ?? "node:22-alpine";
  private readonly sandboxBaseDir: string;

  constructor() {
    this.sandboxBaseDir =
      process.env.SANDBOX_BASE_DIR ?? join(tmpdir(), "prometheus-sandboxes");
  }

  /**
   * Resolve the sandbox mode and initialize the appropriate provider.
   * Called lazily to avoid blocking the constructor.
   */
  private async ensureMode(): Promise<void> {
    if (this.modeResolved) {
      return;
    }

    this.mode = await detectSandboxMode();

    switch (this.mode) {
      case "docker": {
        this.provider = new DockerProvider(this.image);
        break;
      }
      case "firecracker": {
        this.provider = new FirecrackerProvider();
        break;
      }
      default: {
        this.provider = new DevProvider(this.sandboxBaseDir);
        break;
      }
    }

    logger.info({ mode: this.mode }, "Sandbox provider initialized");
    this.modeResolved = true;
  }

  /** Get the current sandbox execution mode */
  getMode(): SandboxMode {
    return this.mode;
  }

  /** Get the active provider instance */
  getProvider(): SandboxProvider | null {
    return this.provider;
  }

  /**
   * Create a new sandbox environment.
   * Delegates to the active provider based on the resolved mode.
   */
  async create(options?: CreateContainerOptions): Promise<ContainerInfo> {
    await this.ensureMode();

    if (!this.provider) {
      throw new Error("No sandbox provider available");
    }

    const cpuLimit = options?.cpuLimit ?? 1;
    const memoryLimitMb = options?.memoryLimitMb ?? 2048;

    try {
      const instance = await this.provider.create({
        projectId: options?.projectId ?? "unknown",
        cpuLimit,
        memoryMb: memoryLimitMb,
      });

      const info: ContainerInfo = {
        id: instance.id,
        containerId: instance.containerId,
        projectId: options?.projectId ?? null,
        sessionId: null,
        status: "ready",
        createdAt: instance.createdAt,
        lastUsedAt: new Date(),
        workspacePath: instance.workDir,
        cpuLimit,
        memoryLimitMb,
      };

      this.containers.set(instance.id, info);
      this.runningProcesses.set(instance.id, new Set());

      logger.info(
        {
          sandboxId: instance.id,
          mode: this.mode,
          workspace: instance.workDir,
        },
        "Sandbox created"
      );

      return info;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ error: msg }, "Failed to create sandbox");
      throw error;
    }
  }

  /**
   * Execute a shell command inside a sandbox.
   */
  async exec(
    sandboxId: string,
    command: string,
    timeout?: number
  ): Promise<ExecResult> {
    await this.ensureMode();

    const info = this.containers.get(sandboxId);
    if (!info || (info.status !== "ready" && info.status !== "busy")) {
      throw new Error(
        `Sandbox ${sandboxId} not available (status: ${info?.status ?? "not found"})`
      );
    }

    // Validate command security
    const cmdCheck = validateCommand(command);
    if (!cmdCheck.valid) {
      return {
        exitCode: 126,
        stdout: "",
        stderr: `Security: ${cmdCheck.reason}`,
        duration: 0,
      };
    }

    // Validate and clamp timeout (max 5 minutes)
    const timeoutCheck = validateTimeout(timeout ?? 60_000);
    const effectiveTimeout = timeoutCheck.timeout;

    info.status = "busy";
    info.lastUsedAt = new Date();

    try {
      if (!this.provider) {
        throw new Error("No sandbox provider available");
      }

      const providerResult = await this.provider.exec(
        sandboxId,
        command,
        effectiveTimeout
      );

      info.status = "ready";

      // Map provider ExecResult to ContainerManager ExecResult
      return {
        exitCode: providerResult.exitCode,
        stdout: providerResult.output,
        stderr: providerResult.stderr,
        duration: providerResult.duration,
      };
    } catch (error) {
      info.status = "ready";
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(
        { sandboxId, command: command.slice(0, 100), error: msg },
        "Exec failed"
      );
      return { exitCode: 1, stdout: "", stderr: msg, duration: 0 };
    }
  }

  /**
   * Write a file inside the sandbox.
   */
  async writeFile(
    sandboxId: string,
    filePath: string,
    content: string
  ): Promise<void> {
    await this.ensureMode();

    const info = this.containers.get(sandboxId);
    if (!info) {
      throw new Error(`Sandbox ${sandboxId} not found`);
    }

    if (!this.provider) {
      throw new Error("No sandbox provider available");
    }

    info.lastUsedAt = new Date();
    await this.provider.writeFile(sandboxId, filePath, content);
    logger.debug({ sandboxId, filePath }, "File written");
  }

  /**
   * Read a file from the sandbox.
   */
  async readFile(sandboxId: string, filePath: string): Promise<string> {
    await this.ensureMode();

    const info = this.containers.get(sandboxId);
    if (!info) {
      throw new Error(`Sandbox ${sandboxId} not found`);
    }

    if (!this.provider) {
      throw new Error("No sandbox provider available");
    }

    info.lastUsedAt = new Date();
    return await this.provider.readFile(sandboxId, filePath);
  }

  /**
   * Destroy a sandbox and clean up all resources.
   */
  async destroy(sandboxId: string): Promise<void> {
    await this.ensureMode();

    const info = this.containers.get(sandboxId);
    if (!info) {
      return;
    }

    info.status = "stopping";

    // Kill any tracked running processes (legacy dev mode tracking)
    const processes = this.runningProcesses.get(sandboxId);
    if (processes) {
      for (const proc of processes) {
        try {
          proc.kill("SIGKILL");
        } catch {
          // Process may have already exited
        }
      }
      this.runningProcesses.delete(sandboxId);
    }

    try {
      if (this.provider) {
        await this.provider.destroy(sandboxId);
      }

      info.status = "stopped";
      this.containers.delete(sandboxId);
      logger.info({ sandboxId }, "Sandbox destroyed");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ sandboxId, error: msg }, "Failed to destroy sandbox");
      // Still remove from map to prevent leaks
      this.containers.delete(sandboxId);
    }
  }

  getContainerInfo(sandboxId: string): ContainerInfo | undefined {
    return this.containers.get(sandboxId);
  }

  getActiveCount(): number {
    return Array.from(this.containers.values()).filter(
      (c) => c.status === "ready" || c.status === "busy"
    ).length;
  }

  getAllContainers(): ContainerInfo[] {
    return Array.from(this.containers.values());
  }

  /**
   * Check if the sandbox provider is healthy.
   */
  async checkDockerConnectivity(): Promise<boolean> {
    if (this.mode === "docker") {
      return await DockerProvider.isAvailable();
    }
    return true; // Dev and Firecracker modes don't need Docker
  }
}
