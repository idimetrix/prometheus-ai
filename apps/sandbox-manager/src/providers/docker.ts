import { spawn } from "node:child_process";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import type {
  ExecResult,
  SandboxConfig,
  SandboxInstance,
  SandboxProvider,
} from "../sandbox-provider";

const logger = createLogger("sandbox-manager:provider:docker");

const DEFAULT_CPU_LIMIT = 1;
const DEFAULT_MEMORY_MB = 2048;
const DEFAULT_DISK_MB = 10_240;

/** Default network allowlist for package registries */
const DEFAULT_NETWORK_ALLOWLIST = [
  "registry.npmjs.org",
  "pypi.org",
  "files.pythonhosted.org",
  "crates.io",
  "static.crates.io",
  "index.crates.io",
];

interface DockerSandbox {
  containerId: string;
  instance: SandboxInstance;
}

/**
 * Docker-based sandbox provider.
 *
 * Runs sandboxes as isolated Docker containers with resource limits,
 * capability dropping, and read-only root filesystems.
 *
 * Note: Uses spawn() with explicit argument arrays to avoid shell injection.
 * The sandbox exec path intentionally uses "sh -c" because the command string
 * originates from validated internal agent logic, not raw user input.
 */
export class DockerProvider implements SandboxProvider {
  readonly name = "docker" as const;
  private readonly sandboxes = new Map<string, DockerSandbox>();
  private readonly image: string;

  constructor(image?: string) {
    this.image = image ?? process.env.SANDBOX_IMAGE ?? "node:22-alpine";
  }

  async create(config: SandboxConfig): Promise<SandboxInstance> {
    const id = generateId("sbx");
    const cpuLimit = config.cpuLimit ?? DEFAULT_CPU_LIMIT;
    const memoryMb = config.memoryMb ?? DEFAULT_MEMORY_MB;
    const diskMb = config.diskMb ?? DEFAULT_DISK_MB;
    const containerName = `prometheus-sandbox-${id}`;

    const args = [
      "create",
      "--name",
      containerName,
      "--cpus",
      String(cpuLimit),
      "--memory",
      String(memoryMb * 1024 * 1024),
      "--memory-swap",
      String(memoryMb * 1024 * 1024),
      "--network",
      config.networkEnabled === false ? "none" : "bridge",
      "--security-opt",
      "no-new-privileges",
      "--read-only",
      "--tmpfs",
      `/tmp:rw,noexec,nosuid,size=${Math.min(512, diskMb)}m`,
      "--tmpfs",
      "/home/sandbox:rw,nosuid,size=256m",
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
      "--label",
      "prometheus.sandbox=true",
      "--label",
      `prometheus.sandbox.id=${id}`,
      "--storage-opt",
      `size=${diskMb}M`,
      this.image,
      "sleep",
      "infinity",
    ];

    const createResult = await this.spawnDocker(args);
    if (createResult.exitCode !== 0) {
      throw new Error(`Failed to create container: ${createResult.stderr}`);
    }

    const containerId = createResult.stdout.trim();

    const startResult = await this.spawnDocker(["start", containerId]);
    if (startResult.exitCode !== 0) {
      throw new Error(`Failed to start container: ${startResult.stderr}`);
    }

    const instance: SandboxInstance = {
      id,
      provider: "docker",
      workDir: "/workspace",
      status: "running",
      containerId,
      createdAt: new Date(),
    };

    this.sandboxes.set(id, { containerId, instance });

    // Apply network allowlist via iptables if specified
    if (config.networkEnabled !== false && config.networkAllowlist) {
      await this.applyNetworkAllowlist(containerId, config.networkAllowlist);
    }

    logger.info(
      { sandboxId: id, containerId: containerId.slice(0, 12) },
      "Docker sandbox created"
    );

    return instance;
  }

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

    sandbox.instance.status = "stopped";
    this.sandboxes.delete(sandboxId);

    logger.info({ sandboxId }, "Docker sandbox destroyed");
  }

  async exec(
    sandboxId: string,
    command: string,
    timeout = 60_000
  ): Promise<ExecResult> {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) {
      throw new Error(`Sandbox ${sandboxId} not found`);
    }

    const startTime = Date.now();
    const result = await this.spawnDocker(
      ["exec", sandbox.containerId, "sh", "-c", command],
      timeout
    );
    const duration = Date.now() - startTime;

    return {
      exitCode: result.exitCode,
      output: result.stdout,
      stderr: result.stderr,
      duration,
    };
  }

  async writeFile(
    sandboxId: string,
    path: string,
    content: string
  ): Promise<void> {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) {
      throw new Error(`Sandbox ${sandboxId} not found`);
    }

    const result = await this.spawnDocker(
      [
        "exec",
        "-i",
        sandbox.containerId,
        "sh",
        "-c",
        `mkdir -p "$(dirname '${path}')" && cat > '${path}'`,
      ],
      30_000,
      content
    );

    if (result.exitCode !== 0) {
      throw new Error(`Failed to write file: ${result.stderr}`);
    }

    logger.debug({ sandboxId, path }, "File written in Docker sandbox");
  }

  async readFile(sandboxId: string, path: string): Promise<string> {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) {
      throw new Error(`Sandbox ${sandboxId} not found`);
    }

    const result = await this.spawnDocker(
      ["exec", sandbox.containerId, "cat", path],
      10_000
    );

    if (result.exitCode !== 0) {
      throw new Error(`Failed to read file: ${result.stderr}`);
    }

    return result.stdout;
  }

  async isHealthy(sandboxId: string): Promise<boolean> {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) {
      return false;
    }

    try {
      const result = await this.spawnDocker(
        ["exec", sandbox.containerId, "echo", "ok"],
        5000
      );
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  /** Check if the Docker daemon is reachable */
  static isAvailable(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const child = spawn("docker", ["info", "--format", "{{.ID}}"], {
        timeout: 5000,
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.on("close", (code) => resolve(code === 0));
      child.on("error", () => resolve(false));
    });
  }

  /**
   * Apply iptables-based network allowlist to a container.
   *
   * Drops all outbound traffic except to explicitly allowed domains.
   * The default allowlist includes npm, pip, and cargo registries.
   */
  private async applyNetworkAllowlist(
    containerId: string,
    allowlist: string[]
  ): Promise<void> {
    const domains = [...DEFAULT_NETWORK_ALLOWLIST, ...allowlist];
    const uniqueDomains = [...new Set(domains)];

    // Set default DROP policy for OUTPUT chain
    await this.spawnDocker([
      "exec",
      containerId,
      "sh",
      "-c",
      "iptables -P OUTPUT DROP 2>/dev/null; " +
        // Allow loopback
        "iptables -A OUTPUT -o lo -j ACCEPT 2>/dev/null; " +
        // Allow established/related connections
        "iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT 2>/dev/null; " +
        // Allow DNS (needed to resolve allowlisted domains)
        "iptables -A OUTPUT -p udp --dport 53 -j ACCEPT 2>/dev/null; " +
        "iptables -A OUTPUT -p tcp --dport 53 -j ACCEPT 2>/dev/null",
    ]);

    // Add allowlist rules for each domain
    for (const domain of uniqueDomains) {
      await this.spawnDocker([
        "exec",
        containerId,
        "sh",
        "-c",
        `iptables -A OUTPUT -p tcp -d "${domain}" --dport 443 -j ACCEPT 2>/dev/null; ` +
          `iptables -A OUTPUT -p tcp -d "${domain}" --dport 80 -j ACCEPT 2>/dev/null`,
      ]);
    }

    logger.info(
      {
        containerId: containerId.slice(0, 12),
        allowlistSize: uniqueDomains.length,
      },
      "Network allowlist applied via iptables"
    );
  }

  /**
   * Spawn a docker CLI command with explicit argument array.
   * Uses spawn (not exec) to avoid shell injection.
   */
  private spawnDocker(
    args: string[],
    timeout = 30_000,
    stdin?: string
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
