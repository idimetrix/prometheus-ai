import Docker from "dockerode";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";

const logger = createLogger("sandbox-manager:container");

export interface ContainerInfo {
  id: string;
  containerId: string;
  sessionId: string | null;
  status: "creating" | "ready" | "busy" | "stopping" | "stopped";
  createdAt: Date;
  cpuLimit: number;
  memoryLimitMb: number;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export class ContainerManager {
  private readonly docker: Docker;
  private readonly containers = new Map<string, ContainerInfo>();
  private readonly image = process.env.SANDBOX_IMAGE ?? "node:22-alpine";

  constructor() {
    this.docker = new Docker({ socketPath: "/var/run/docker.sock" });
  }

  async createContainer(options?: {
    cpuLimit?: number;
    memoryLimitMb?: number;
  }): Promise<ContainerInfo> {
    const id = generateId("sbx");
    const cpuLimit = options?.cpuLimit ?? 1;
    const memoryLimitMb = options?.memoryLimitMb ?? 2048;

    const info: ContainerInfo = {
      id,
      containerId: "",
      sessionId: null,
      status: "creating",
      createdAt: new Date(),
      cpuLimit,
      memoryLimitMb,
    };

    try {
      const container = await this.docker.createContainer({
        Image: this.image,
        name: `prometheus-sandbox-${id}`,
        Cmd: ["sleep", "infinity"],
        HostConfig: {
          NanoCpus: cpuLimit * 1e9,
          Memory: memoryLimitMb * 1024 * 1024,
          MemorySwap: memoryLimitMb * 1024 * 1024, // No swap
          NetworkMode: "bridge",
          SecurityOpt: ["no-new-privileges"],
          ReadonlyRootfs: false,
          Tmpfs: { "/tmp": "rw,noexec,nosuid,size=512m" },
        },
        WorkingDir: "/workspace",
        Env: [
          "NODE_ENV=development",
          "HOME=/home/sandbox",
        ],
        Labels: {
          "prometheus.sandbox": "true",
          "prometheus.sandbox.id": id,
        },
      });

      await container.start();
      info.containerId = container.id;
      info.status = "ready";
      this.containers.set(id, info);

      logger.info({ sandboxId: id, containerId: container.id }, "Container created");
      return info;
    } catch (error) {
      info.status = "stopped";
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ sandboxId: id, error: msg }, "Failed to create container");
      throw error;
    }
  }

  async exec(sandboxId: string, command: string, workDir?: string): Promise<ExecResult> {
    const info = this.containers.get(sandboxId);
    if (!info || info.status !== "ready" && info.status !== "busy") {
      throw new Error(`Sandbox ${sandboxId} not available`);
    }

    const container = this.docker.getContainer(info.containerId);

    try {
      const exec = await container.exec({
        Cmd: ["sh", "-c", command],
        WorkingDir: workDir ?? "/workspace",
        AttachStdout: true,
        AttachStderr: true,
      });

      const stream = await exec.start({ hijack: true, stdin: false });

      return new Promise<ExecResult>((resolve, reject) => {
        let stdout = "";
        let stderr = "";

        stream.on("data", (chunk: Buffer) => {
          // Docker multiplexed stream: first 8 bytes are header
          const header = chunk.subarray(0, 8);
          const streamType = header[0]; // 1=stdout, 2=stderr
          const payload = chunk.subarray(8).toString("utf-8");

          if (streamType === 1) {
            stdout += payload;
          } else {
            stderr += payload;
          }
        });

        stream.on("end", async () => {
          try {
            const inspectData = await exec.inspect();
            resolve({
              exitCode: inspectData.ExitCode ?? 0,
              stdout: stdout.trim(),
              stderr: stderr.trim(),
            });
          } catch {
            resolve({ exitCode: 0, stdout: stdout.trim(), stderr: stderr.trim() });
          }
        });

        stream.on("error", reject);
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ sandboxId, command, error: msg }, "Exec failed");
      return { exitCode: 1, stdout: "", stderr: msg };
    }
  }

  async destroyContainer(sandboxId: string): Promise<void> {
    const info = this.containers.get(sandboxId);
    if (!info) return;

    info.status = "stopping";

    try {
      const container = this.docker.getContainer(info.containerId);
      await container.stop({ t: 5 }).catch(() => {});
      await container.remove({ force: true }).catch(() => {});
      info.status = "stopped";
      this.containers.delete(sandboxId);
      logger.info({ sandboxId }, "Container destroyed");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ sandboxId, error: msg }, "Failed to destroy container");
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
}
