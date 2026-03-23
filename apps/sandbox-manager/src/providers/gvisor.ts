import { spawn } from "node:child_process";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import type {
  ExecResult,
  SandboxConfig,
  SandboxInstance,
  SandboxProvider,
} from "../sandbox-provider";

const logger = createLogger("sandbox-manager:provider:gvisor");

const DEFAULT_CPU_LIMIT = 1;
const DEFAULT_MEMORY_MB = 2048;

interface GVisorSandbox {
  containerId: string;
  instance: SandboxInstance;
}

function spawnDocker(
  args: string[],
  timeout = 30_000
): Promise<{
  output: string;
  stderr: string;
  exitCode: number;
  duration: number;
}> {
  const start = performance.now();
  return new Promise((resolve, reject) => {
    const proc = spawn("docker", args, { timeout });
    let output = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => {
      output += d.toString();
    });
    proc.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      resolve({
        output: output.trim(),
        stderr: stderr.trim(),
        exitCode: code ?? 1,
        duration: Math.round(performance.now() - start),
      });
    });
  });
}

export class GVisorProvider implements SandboxProvider {
  readonly name = "gvisor" as const;
  private readonly sandboxes = new Map<string, GVisorSandbox>();
  private readonly image: string;

  constructor(image?: string) {
    this.image = image ?? process.env.SANDBOX_IMAGE ?? "node:22-alpine";
  }

  async create(config: SandboxConfig): Promise<SandboxInstance> {
    const id = generateId("sbx");
    const cpuLimit = config.cpuLimit ?? DEFAULT_CPU_LIMIT;
    const memoryMb = config.memoryMb ?? DEFAULT_MEMORY_MB;
    const containerName = `prometheus-gvisor-${id}`;

    const args = [
      "create",
      "--name",
      containerName,
      "--runtime=runsc",
      `--cpus=${cpuLimit}`,
      `--memory=${memoryMb}m`,
      "--read-only",
      "--tmpfs",
      "/tmp:size=512m",
      "--tmpfs",
      "/workspace:size=4g",
      "--cap-drop=ALL",
      "--cap-add=NET_BIND_SERVICE",
      "--security-opt=no-new-privileges",
      "--network=none",
      "--pids-limit=256",
      "--ulimit",
      "nofile=1024:4096",
      "-w",
      "/workspace",
      this.image,
      "sleep",
      "infinity",
    ];

    const result = await spawnDocker(args, 60_000);
    if (result.exitCode !== 0) {
      throw new Error(
        `Failed to create gVisor sandbox: exit code ${result.exitCode}`
      );
    }

    const containerId = result.output;
    await spawnDocker(["start", containerName]);

    const instance: SandboxInstance = {
      id,
      containerId,
      provider: "gvisor",
      status: "running",
      workDir: "/workspace",
      createdAt: new Date(),
    };

    this.sandboxes.set(id, { containerId, instance });
    logger.info(
      { id, containerId: containerId.slice(0, 12) },
      "gVisor sandbox created"
    );
    return instance;
  }

  async exec(
    sandboxId: string,
    command: string,
    timeout?: number
  ): Promise<ExecResult> {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) {
      return {
        output: "",
        stderr: "Sandbox not found",
        exitCode: 1,
        duration: 0,
      };
    }

    const args = [
      "exec",
      "-w",
      sandbox.instance.workDir,
      sandbox.containerId,
      "sh",
      "-c",
      command,
    ];

    return await spawnDocker(args, timeout ?? 30_000);
  }

  async destroy(sandboxId: string): Promise<void> {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) {
      return;
    }

    await spawnDocker(["rm", "-f", sandbox.containerId]);
    this.sandboxes.delete(sandboxId);
    logger.info({ sandboxId }, "gVisor sandbox destroyed");
  }

  async writeFile(
    sandboxId: string,
    path: string,
    content: string
  ): Promise<void> {
    const encoded = Buffer.from(content).toString("base64");
    await this.exec(sandboxId, `echo '${encoded}' | base64 -d > '${path}'`);
  }

  async readFile(sandboxId: string, path: string): Promise<string> {
    const result = await this.exec(sandboxId, `cat '${path}'`);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to read file: ${result.stderr}`);
    }
    return result.output;
  }

  async isHealthy(sandboxId: string): Promise<boolean> {
    const result = await this.exec(sandboxId, "echo ok", 5000);
    return result.exitCode === 0;
  }

  getActiveCount(): number {
    return this.sandboxes.size;
  }

  async checkAvailability(): Promise<boolean> {
    try {
      const result = await spawnDocker(
        ["info", "--format", "{{.Runtimes}}"],
        5000
      );
      return result.output.includes("runsc");
    } catch {
      return false;
    }
  }
}
