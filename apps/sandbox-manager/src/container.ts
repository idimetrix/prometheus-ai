import { type ChildProcess, spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { validateCommand, validateFilePath, validateTimeout } from "./security";

const logger = createLogger("sandbox-manager:container");

/**
 * Determine sandbox execution mode:
 * 1. SANDBOX_MODE env var takes priority ("docker" | "dev")
 * 2. NODE_ENV=production defaults to "docker"
 * 3. Otherwise, auto-detect: use Docker if available, fall back to dev
 */
async function detectSandboxMode(): Promise<"docker" | "dev"> {
  const explicit = process.env.SANDBOX_MODE?.toLowerCase();
  if (explicit === "docker") {
    return "docker";
  }
  if (explicit === "dev") {
    return "dev";
  }

  if (process.env.NODE_ENV === "production") {
    return "docker";
  }

  // Auto-detect: check if Docker daemon is reachable
  try {
    const available = await isDockerAvailable();
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

/**
 * Check whether the Docker CLI can connect to a running daemon.
 */
function isDockerAvailable(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const child = spawn("docker", ["info", "--format", "{{.ID}}"], {
      timeout: 5000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.on("close", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
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

export class ContainerManager {
  private docker: DockerClient | null = null;
  private mode: "docker" | "dev" = "dev";
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
   * Resolve the sandbox mode (docker vs dev) on first use.
   * Called lazily to avoid blocking the constructor.
   */
  private async ensureMode(): Promise<void> {
    if (this.modeResolved) {
      return;
    }

    this.mode = await detectSandboxMode();
    if (this.mode === "docker") {
      this.docker = new DockerClient();
    }
    this.modeResolved = true;
  }

  /** Get the current sandbox execution mode */
  getMode(): "docker" | "dev" {
    return this.mode;
  }

  /**
   * Create a new sandbox environment.
   * In dev mode: creates a temp directory with process isolation.
   * In docker mode: creates a Docker container with security constraints.
   */
  async create(options?: CreateContainerOptions): Promise<ContainerInfo> {
    await this.ensureMode();

    const id = generateId("sbx");
    const cpuLimit = options?.cpuLimit ?? 1;
    const memoryLimitMb = options?.memoryLimitMb ?? 2048;

    const info: ContainerInfo = {
      id,
      containerId: "",
      projectId: options?.projectId ?? null,
      sessionId: null,
      status: "creating",
      createdAt: new Date(),
      lastUsedAt: new Date(),
      workspacePath: "",
      cpuLimit,
      memoryLimitMb,
    };

    try {
      if (this.mode === "docker" && this.docker) {
        await this.createDockerContainer(info, cpuLimit, memoryLimitMb);
      } else {
        await this.createDevSandbox(info);
      }

      info.status = "ready";
      this.containers.set(id, info);
      this.runningProcesses.set(id, new Set());

      logger.info(
        { sandboxId: id, mode: this.mode, workspace: info.workspacePath },
        "Sandbox created"
      );

      return info;
    } catch (error) {
      info.status = "stopped";
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ sandboxId: id, error: msg }, "Failed to create sandbox");
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
    const startTime = Date.now();

    try {
      let result: ExecResult;
      if (this.mode === "docker" && this.docker) {
        result = await this.execInDocker(info, command, effectiveTimeout);
      } else {
        result = await this.execInDev(
          info,
          command,
          effectiveTimeout,
          sandboxId
        );
      }

      info.status = "ready";
      return result;
    } catch (error) {
      info.status = "ready";
      const duration = Date.now() - startTime;
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(
        { sandboxId, command: command.slice(0, 100), error: msg },
        "Exec failed"
      );
      return { exitCode: 1, stdout: "", stderr: msg, duration };
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
    const info = this.containers.get(sandboxId);
    if (!info) {
      throw new Error(`Sandbox ${sandboxId} not found`);
    }

    info.lastUsedAt = new Date();

    if (this.mode === "docker" && this.docker) {
      // Use docker exec to write the file
      await this.execInDocker(
        info,
        `mkdir -p "$(dirname '${filePath}')" && cat > '${filePath}'`,
        30_000,
        content
      );
    } else {
      const pathCheck = validateFilePath(info.workspacePath, filePath);
      if (!pathCheck.valid) {
        throw new Error(`Security: ${pathCheck.reason}`);
      }

      const fullPath = resolve(info.workspacePath, filePath);
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, content, "utf-8");
    }

    logger.debug({ sandboxId, filePath }, "File written");
  }

  /**
   * Read a file from the sandbox.
   */
  async readFile(sandboxId: string, filePath: string): Promise<string> {
    const info = this.containers.get(sandboxId);
    if (!info) {
      throw new Error(`Sandbox ${sandboxId} not found`);
    }

    info.lastUsedAt = new Date();

    if (this.mode === "docker" && this.docker) {
      const result = await this.execInDocker(info, `cat '${filePath}'`, 10_000);
      if (result.exitCode !== 0) {
        throw new Error(`Failed to read file: ${result.stderr}`);
      }
      return result.stdout;
    }
    const pathCheck = validateFilePath(info.workspacePath, filePath);
    if (!pathCheck.valid) {
      throw new Error(`Security: ${pathCheck.reason}`);
    }

    const fullPath = resolve(info.workspacePath, filePath);
    return await readFile(fullPath, "utf-8");
  }

  /**
   * Destroy a sandbox and clean up all resources.
   */
  async destroy(sandboxId: string): Promise<void> {
    const info = this.containers.get(sandboxId);
    if (!info) {
      return;
    }

    info.status = "stopping";

    // Kill any running processes
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
      if (this.mode === "docker" && this.docker) {
        await this.destroyDockerContainer(info);
      } else {
        await this.destroyDevSandbox(info);
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
   * Check if Docker is available.
   */
  async checkDockerConnectivity(): Promise<boolean> {
    if (this.mode !== "docker" || !this.docker) {
      return true; // Dev mode doesn't need Docker
    }
    return await this.docker.ping();
  }

  // ─── Development mode: temp directories + child_process ────────────

  private async createDevSandbox(info: ContainerInfo): Promise<void> {
    const sandboxDir = join(
      this.sandboxBaseDir,
      `prometheus-sandbox-${info.id}`
    );
    await mkdir(sandboxDir, { recursive: true });
    await mkdir(join(sandboxDir, "workspace"), { recursive: true });
    await mkdir(join(sandboxDir, "tmp"), { recursive: true });

    info.workspacePath = join(sandboxDir, "workspace");
    info.containerId = `dev-${info.id}`;
  }

  private execInDev(
    info: ContainerInfo,
    command: string,
    timeout: number,
    sandboxId: string
  ): Promise<ExecResult> {
    const startTime = Date.now();

    return new Promise<ExecResult>((resolve) => {
      const child = spawn("sh", ["-c", command], {
        cwd: info.workspacePath,
        timeout,
        env: {
          ...process.env,
          HOME: info.workspacePath,
          TMPDIR: join(dirname(info.workspacePath), "tmp"),
          SANDBOX_ID: sandboxId,
          NODE_ENV: "development",
        },
        stdio: ["pipe", "pipe", "pipe"],
      });

      // Track process for cleanup
      const processes = this.runningProcesses.get(sandboxId);
      if (processes) {
        processes.add(child);
      }

      let stdout = "";
      let stderr = "";
      let stdoutSize = 0;
      let stderrSize = 0;
      const MAX_OUTPUT = 1024 * 1024; // 1MB max output

      child.stdout.on("data", (chunk: Buffer) => {
        if (stdoutSize < MAX_OUTPUT) {
          stdout += chunk.toString("utf-8");
          stdoutSize += chunk.length;
        }
      });

      child.stderr.on("data", (chunk: Buffer) => {
        if (stderrSize < MAX_OUTPUT) {
          stderr += chunk.toString("utf-8");
          stderrSize += chunk.length;
        }
      });

      child.on("close", (code, signal) => {
        const processes = this.runningProcesses.get(sandboxId);
        if (processes) {
          processes.delete(child);
        }

        const duration = Date.now() - startTime;

        // Detect timeout (signal SIGTERM from node's timeout)
        if (signal === "SIGTERM" && duration >= timeout - 100) {
          resolve({
            exitCode: 124, // Standard timeout exit code
            stdout: stdout.trim(),
            stderr: `Process timed out after ${Math.round(timeout / 1000)}s`,
            duration,
          });
          return;
        }

        resolve({
          exitCode: code ?? 1,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          duration,
        });
      });

      child.on("error", (err) => {
        const processes = this.runningProcesses.get(sandboxId);
        if (processes) {
          processes.delete(child);
        }

        const duration = Date.now() - startTime;
        resolve({
          exitCode: 1,
          stdout: "",
          stderr: err.message,
          duration,
        });
      });
    });
  }

  private async destroyDevSandbox(info: ContainerInfo): Promise<void> {
    // Kill any lingering processes in the sandbox directory
    const sandboxDir = dirname(info.workspacePath);
    await rm(sandboxDir, { recursive: true, force: true });
  }

  // ─── Production mode: Docker containers ────────────────────────────

  private async createDockerContainer(
    info: ContainerInfo,
    cpuLimit: number,
    memoryLimitMb: number
  ): Promise<void> {
    if (!this.docker) {
      throw new Error("Docker not available");
    }

    const containerName = `prometheus-sandbox-${info.id}`;
    const diskLimitMb = Number(process.env.SANDBOX_DISK_LIMIT_MB ?? 10_240); // 10GB default

    const createResult = await this.docker.createContainer({
      Image: this.image,
      name: containerName,
      Cmd: ["sleep", "infinity"],
      HostConfig: {
        NanoCpus: cpuLimit * 1e9,
        Memory: memoryLimitMb * 1024 * 1024,
        MemorySwap: memoryLimitMb * 1024 * 1024, // No swap
        NetworkMode: "bridge",
        SecurityOpt: ["no-new-privileges"],
        ReadonlyRootfs: true,
        Tmpfs: {
          "/tmp": `rw,noexec,nosuid,size=${Math.min(512, diskLimitMb)}m`,
          "/home/sandbox": "rw,nosuid,size=256m",
        },
        // Disk quota via storage-opt (requires overlay2 with xfs + pquota)
        StorageOpt: diskLimitMb ? { size: `${diskLimitMb}M` } : undefined,
        // Drop all capabilities except what's minimally needed
        CapDrop: ["ALL"],
        CapAdd: ["CHOWN", "DAC_OVERRIDE", "FOWNER", "SETGID", "SETUID"],
        // PID limit to prevent fork bombs
        PidsLimit: 256,
      },
      WorkingDir: "/workspace",
      Env: ["NODE_ENV=development", "HOME=/home/sandbox"],
      Labels: {
        "prometheus.sandbox": "true",
        "prometheus.sandbox.id": info.id,
      },
      // Mount a volume for the writable workspace
      Volumes: { "/workspace": {} },
    });

    await this.docker.startContainer(createResult.Id);
    info.containerId = createResult.Id;
    info.workspacePath = "/workspace";
  }

  private async execInDocker(
    info: ContainerInfo,
    command: string,
    timeout: number,
    stdin?: string
  ): Promise<ExecResult> {
    if (!this.docker) {
      throw new Error("Docker not available");
    }

    const startTime = Date.now();
    const result = await this.docker.execInContainer(
      info.containerId,
      ["sh", "-c", command],
      timeout,
      stdin
    );
    const duration = Date.now() - startTime;

    return { ...result, duration };
  }

  private async destroyDockerContainer(info: ContainerInfo): Promise<void> {
    if (!this.docker) {
      return;
    }
    await this.docker.stopContainer(info.containerId, 5);
    await this.docker.removeContainer(info.containerId);
  }
}

/**
 * Minimal Docker client using the Docker CLI.
 * Shells out to docker commands for simplicity and portability.
 */
class DockerClient {
  readonly socketPath: string;

  constructor(socketPath?: string) {
    this.socketPath = socketPath ?? "/var/run/docker.sock";
  }

  async ping(): Promise<boolean> {
    try {
      const result = await this.dockerExec([
        "docker",
        "info",
        "--format",
        "{{.ID}}",
      ]);
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  async createContainer(
    config: Record<string, unknown>
  ): Promise<{ Id: string }> {
    const name = config.name as string;
    config.name = undefined;

    const args = ["docker", "create", "--name", name];

    const hostConfig = config.HostConfig as Record<string, unknown> | undefined;
    if (hostConfig) {
      if (hostConfig.NanoCpus) {
        args.push("--cpus", String((hostConfig.NanoCpus as number) / 1e9));
      }
      if (hostConfig.Memory) {
        args.push("--memory", String(hostConfig.Memory));
      }
      if (hostConfig.MemorySwap) {
        args.push("--memory-swap", String(hostConfig.MemorySwap));
      }
      if (hostConfig.NetworkMode) {
        args.push("--network", String(hostConfig.NetworkMode));
      }
      if (hostConfig.SecurityOpt) {
        for (const opt of hostConfig.SecurityOpt as string[]) {
          args.push("--security-opt", opt);
        }
      }
      if (hostConfig.ReadonlyRootfs) {
        args.push("--read-only");
      }
      if (hostConfig.Tmpfs) {
        for (const [mount, opts] of Object.entries(
          hostConfig.Tmpfs as Record<string, string>
        )) {
          args.push("--tmpfs", `${mount}:${opts}`);
        }
      }
      if (hostConfig.CapDrop) {
        for (const cap of hostConfig.CapDrop as string[]) {
          args.push("--cap-drop", cap);
        }
      }
      if (hostConfig.CapAdd) {
        for (const cap of hostConfig.CapAdd as string[]) {
          args.push("--cap-add", cap);
        }
      }
      if (hostConfig.PidsLimit) {
        args.push("--pids-limit", String(hostConfig.PidsLimit));
      }
      if (hostConfig.StorageOpt) {
        for (const [key, value] of Object.entries(
          hostConfig.StorageOpt as Record<string, string>
        )) {
          args.push("--storage-opt", `${key}=${value}`);
        }
      }
    }

    if (config.WorkingDir) {
      args.push("--workdir", String(config.WorkingDir));
    }

    if (config.Env) {
      for (const env of config.Env as string[]) {
        args.push("--env", env);
      }
    }

    if (config.Labels) {
      for (const [key, value] of Object.entries(
        config.Labels as Record<string, string>
      )) {
        args.push("--label", `${key}=${value}`);
      }
    }

    args.push(String(config.Image));

    if (config.Cmd) {
      args.push(...(config.Cmd as string[]));
    }

    const result = await this.dockerExec(args);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to create container: ${result.stderr}`);
    }

    return { Id: result.stdout.trim() };
  }

  async startContainer(containerId: string): Promise<void> {
    const result = await this.dockerExec(["docker", "start", containerId]);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to start container: ${result.stderr}`);
    }
  }

  async stopContainer(containerId: string, timeoutSec: number): Promise<void> {
    await this.dockerExec([
      "docker",
      "stop",
      "-t",
      String(timeoutSec),
      containerId,
    ]).catch(() => {
      /* best-effort stop */
    });
  }

  async removeContainer(containerId: string): Promise<void> {
    await this.dockerExec(["docker", "rm", "-f", containerId]).catch(() => {
      /* best-effort remove */
    });
  }

  async execInContainer(
    containerId: string,
    cmd: string[],
    timeout: number,
    stdin?: string
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const args = ["docker", "exec"];
    if (stdin) {
      args.push("-i");
    }
    args.push(containerId, ...cmd);

    return await this.dockerExec(args, timeout, stdin);
  }

  private dockerExec(
    args: string[],
    timeout = 30_000,
    stdin?: string
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      const child = spawn(args[0] as string, args.slice(1), {
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

      if (stdin) {
        child.stdin.write(stdin);
        child.stdin.end();
      }

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
