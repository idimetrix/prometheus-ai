import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "@prometheus/logger";
import { DevProvider } from "./providers/dev";
import { DockerProvider } from "./providers/docker";
import { E2BProvider } from "./providers/e2b";
import { FirecrackerProvider } from "./providers/firecracker";
import type { SandboxProvider } from "./sandbox-provider";
import { validateCommand, validateTimeout } from "./security";

const logger = createLogger("sandbox-manager:container");

type SandboxMode = "docker" | "firecracker" | "dev" | "e2b";

// ─── Resource Limits ──────────────────────────────────────────────────────────

export interface ResourceLimits {
  /** CPU core limit */
  cpu: number;
  /** Disk space limit in MB */
  diskMb: number;
  /** Memory limit in MB */
  memoryMb: number;
  /** Maximum number of processes/threads */
  pids: number;
  /** Maximum wall clock time in minutes before forced termination */
  wallClockMinutes: number;
}

/** Default resource limits applied to all sandboxes */
export const DEFAULT_RESOURCE_LIMITS: ResourceLimits = {
  memoryMb: 2048,
  cpu: 2,
  diskMb: 10_240,
  pids: 256,
  wallClockMinutes: 30,
};

// ─── Provider Selection ───────────────────────────────────────────────────────

/**
 * Check if KVM is available (required for Firecracker).
 * Uses spawn with explicit args to avoid shell injection.
 */
function isKvmAvailable(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const child = spawn("test", ["-e", "/dev/kvm"], {
      timeout: 2000,
      stdio: "ignore",
    });
    child.on("close", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}

/**
 * Select the best available sandbox provider with fallback chain:
 * 1. Firecracker (if KVM is available)
 * 2. Docker (if daemon is reachable)
 * 3. E2B (if API key is configured)
 * 4. Dev (always available)
 */
async function selectProvider(
  projectOverride?: SandboxMode
): Promise<{ mode: SandboxMode; provider: SandboxProvider }> {
  // Explicit project-level override
  if (projectOverride) {
    return createProviderForMode(projectOverride);
  }

  // Environment variable override
  const explicit = process.env.SANDBOX_MODE?.toLowerCase();
  if (
    explicit === "docker" ||
    explicit === "firecracker" ||
    explicit === "dev" ||
    explicit === "e2b"
  ) {
    return createProviderForMode(explicit as SandboxMode);
  }

  // Production auto-detection with priority chain
  if (process.env.NODE_ENV === "production") {
    // Priority 1: Firecracker if KVM is available
    const kvmAvailable = await isKvmAvailable();
    if (kvmAvailable) {
      logger.info("KVM detected, using Firecracker provider");
      return createProviderForMode("firecracker");
    }

    // Priority 2: Docker
    try {
      const dockerAvailable = await DockerProvider.isAvailable();
      if (dockerAvailable) {
        logger.info("Docker detected, using Docker provider");
        return createProviderForMode("docker");
      }
    } catch {
      // Fall through
    }

    // Priority 3: E2B if API key is set
    if (process.env.E2B_API_KEY) {
      logger.info("E2B API key found, using E2B provider");
      return createProviderForMode("e2b");
    }

    // Priority 4: Dev mode fallback
    logger.warn(
      "No production sandbox provider available, falling back to dev mode"
    );
    return createProviderForMode("dev");
  }

  // Development auto-detection
  try {
    const dockerAvailable = await DockerProvider.isAvailable();
    if (dockerAvailable) {
      logger.info("Docker detected, using container mode");
      return createProviderForMode("docker");
    }
  } catch {
    // Fall through to dev mode
  }

  logger.info("Docker not available, using dev mode (temp directories)");
  return createProviderForMode("dev");
}

/**
 * Create a provider instance for the given mode.
 */
function createProviderForMode(mode: SandboxMode): {
  mode: SandboxMode;
  provider: SandboxProvider;
} {
  const image = process.env.SANDBOX_IMAGE ?? "node:22-alpine";
  const sandboxBaseDir =
    process.env.SANDBOX_BASE_DIR ?? join(tmpdir(), "prometheus-sandboxes");

  switch (mode) {
    case "firecracker":
      return { mode, provider: new FirecrackerProvider() };
    case "docker":
      return { mode, provider: new DockerProvider(image) };
    case "e2b":
      return { mode, provider: new E2BProvider() };
    default:
      return { mode: "dev", provider: new DevProvider(sandboxBaseDir) };
  }
}

/**
 * Health check all available providers and return their status.
 */
async function checkProviderHealth(): Promise<
  Record<string, { available: boolean; latencyMs: number }>
> {
  const results: Record<string, { available: boolean; latencyMs: number }> = {};

  // Check Docker
  try {
    const start = Date.now();
    const available = await DockerProvider.isAvailable();
    results.docker = { available, latencyMs: Date.now() - start };
  } catch {
    results.docker = { available: false, latencyMs: 0 };
  }

  // Check Firecracker (KVM)
  try {
    const start = Date.now();
    const available = await isKvmAvailable();
    results.firecracker = { available, latencyMs: Date.now() - start };
  } catch {
    results.firecracker = { available: false, latencyMs: 0 };
  }

  // Check E2B
  results.e2b = {
    available: Boolean(process.env.E2B_API_KEY),
    latencyMs: 0,
  };

  // Dev is always available
  results.dev = { available: true, latencyMs: 0 };

  return results;
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
  /** Resource limits for the sandbox (merged with DEFAULT_RESOURCE_LIMITS) */
  resourceLimits?: Partial<ResourceLimits>;
  /** Override sandbox provider for this project */
  sandboxProvider?: SandboxMode;
}

/**
 * ContainerManager uses the SandboxProvider abstraction to manage sandboxes.
 *
 * Supports four modes: docker, firecracker, e2b, and dev.
 * Provider selection follows a priority chain with per-project overrides:
 *   Firecracker (KVM available) -> Docker -> E2B -> Dev
 *
 * Maintains backward compatibility with the original API while delegating
 * to the appropriate provider implementation.
 */
export class ContainerManager {
  private provider: SandboxProvider | null = null;
  private mode: SandboxMode = "dev";
  private modeResolved = false;
  private readonly containers = new Map<string, ContainerInfo>();
  private readonly runningProcesses = new Map<string, Set<ChildProcess>>();

  /**
   * Resolve the sandbox mode and initialize the appropriate provider.
   * Uses the priority-based selection with fallback chain.
   * Called lazily to avoid blocking the constructor.
   */
  private async ensureMode(projectOverride?: SandboxMode): Promise<void> {
    if (this.modeResolved && !projectOverride) {
      return;
    }

    const { mode, provider } = await selectProvider(projectOverride);
    this.mode = mode;
    this.provider = provider;

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
   * Check health of all available providers.
   */
  async getProviderHealth(): Promise<
    Record<string, { available: boolean; latencyMs: number }>
  > {
    return await checkProviderHealth();
  }

  /**
   * Resolve effective resource limits by merging user-provided limits
   * with defaults.
   */
  private resolveResourceLimits(
    overrides?: Partial<ResourceLimits>
  ): ResourceLimits {
    return {
      ...DEFAULT_RESOURCE_LIMITS,
      ...overrides,
    };
  }

  /**
   * Create a new sandbox environment.
   * Delegates to the active provider based on the resolved mode.
   * Supports per-project provider override via options.sandboxProvider.
   */
  async create(options?: CreateContainerOptions): Promise<ContainerInfo> {
    await this.ensureMode(options?.sandboxProvider);

    if (!this.provider) {
      throw new Error("No sandbox provider available");
    }

    const limits = this.resolveResourceLimits(options?.resourceLimits);

    // Allow legacy cpuLimit/memoryLimitMb to override resource limits
    const cpuLimit = options?.cpuLimit ?? limits.cpu;
    const memoryLimitMb = options?.memoryLimitMb ?? limits.memoryMb;

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
          resourceLimits: limits,
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
    return true; // Dev, E2B, and Firecracker modes don't need Docker
  }
}
