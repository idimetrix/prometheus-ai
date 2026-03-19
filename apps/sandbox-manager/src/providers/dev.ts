import { type ChildProcess, spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import type {
  ExecResult,
  SandboxConfig,
  SandboxInstance,
  SandboxProvider,
} from "../sandbox-provider";
import { validateFilePath } from "../security";

const logger = createLogger("sandbox-manager:provider:dev");

const MAX_OUTPUT_BYTES = 1024 * 1024; // 1MB

interface DevSandbox {
  instance: SandboxInstance;
  processes: Set<ChildProcess>;
  sandboxDir: string;
}

/**
 * Development-mode sandbox provider.
 *
 * Uses temp directories and child_process for sandbox isolation.
 * Suitable for local development where Docker is unavailable.
 *
 * Note: Uses spawn() with explicit argument arrays throughout.
 * The "sh -c" in exec() is intentional — commands are pre-validated
 * by the security module before reaching this provider.
 */
export class DevProvider implements SandboxProvider {
  readonly name = "dev" as const;
  private readonly sandboxes = new Map<string, DevSandbox>();
  private readonly baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir =
      baseDir ??
      process.env.SANDBOX_BASE_DIR ??
      join(tmpdir(), "prometheus-sandboxes");
  }

  async create(_config: SandboxConfig): Promise<SandboxInstance> {
    const id = generateId("sbx");
    const sandboxDir = join(this.baseDir, `prometheus-sandbox-${id}`);
    const workspaceDir = join(sandboxDir, "workspace");

    await mkdir(workspaceDir, { recursive: true });
    await mkdir(join(sandboxDir, "tmp"), { recursive: true });

    const instance: SandboxInstance = {
      id,
      provider: "dev",
      workDir: workspaceDir,
      status: "running",
      containerId: `dev-${id}`,
      createdAt: new Date(),
    };

    this.sandboxes.set(id, {
      instance,
      sandboxDir,
      processes: new Set(),
    });

    logger.info(
      { sandboxId: id, workDir: workspaceDir },
      "Dev sandbox created"
    );

    return instance;
  }

  async destroy(sandboxId: string): Promise<void> {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) {
      return;
    }

    // Kill lingering processes
    for (const proc of sandbox.processes) {
      try {
        proc.kill("SIGKILL");
      } catch {
        // Process may have already exited
      }
    }

    await rm(sandbox.sandboxDir, { recursive: true, force: true });
    sandbox.instance.status = "stopped";
    this.sandboxes.delete(sandboxId);

    logger.info({ sandboxId }, "Dev sandbox destroyed");
  }

  exec(
    sandboxId: string,
    command: string,
    timeout = 60_000
  ): Promise<ExecResult> {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) {
      throw new Error(`Sandbox ${sandboxId} not found`);
    }

    const startTime = Date.now();

    return new Promise<ExecResult>((promiseResolve) => {
      const child = spawn("sh", ["-c", command], {
        cwd: sandbox.instance.workDir,
        timeout,
        env: {
          ...process.env,
          HOME: sandbox.instance.workDir,
          TMPDIR: join(sandbox.sandboxDir, "tmp"),
          SANDBOX_ID: sandboxId,
          NODE_ENV: "development",
        },
        stdio: ["pipe", "pipe", "pipe"],
      });

      sandbox.processes.add(child);

      let stdout = "";
      let stderr = "";
      let stdoutSize = 0;
      let stderrSize = 0;

      child.stdout.on("data", (chunk: Buffer) => {
        if (stdoutSize < MAX_OUTPUT_BYTES) {
          stdout += chunk.toString("utf-8");
          stdoutSize += chunk.length;
        }
      });

      child.stderr.on("data", (chunk: Buffer) => {
        if (stderrSize < MAX_OUTPUT_BYTES) {
          stderr += chunk.toString("utf-8");
          stderrSize += chunk.length;
        }
      });

      child.on("close", (code, signal) => {
        sandbox.processes.delete(child);
        const duration = Date.now() - startTime;

        if (signal === "SIGTERM" && duration >= timeout - 100) {
          promiseResolve({
            exitCode: 124,
            output: stdout.trim(),
            stderr: `Process timed out after ${Math.round(timeout / 1000)}s`,
            duration,
          });
          return;
        }

        promiseResolve({
          exitCode: code ?? 1,
          output: stdout.trim(),
          stderr: stderr.trim(),
          duration,
        });
      });

      child.on("error", (err) => {
        sandbox.processes.delete(child);
        const duration = Date.now() - startTime;
        promiseResolve({
          exitCode: 1,
          output: "",
          stderr: err.message,
          duration,
        });
      });
    });
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

    const pathCheck = validateFilePath(sandbox.instance.workDir, path);
    if (!pathCheck.valid) {
      throw new Error(`Security: ${pathCheck.reason}`);
    }

    const fullPath = resolve(sandbox.instance.workDir, path);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, "utf-8");

    logger.debug({ sandboxId, path }, "File written in dev sandbox");
  }

  async readFile(sandboxId: string, path: string): Promise<string> {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) {
      throw new Error(`Sandbox ${sandboxId} not found`);
    }

    const pathCheck = validateFilePath(sandbox.instance.workDir, path);
    if (!pathCheck.valid) {
      throw new Error(`Security: ${pathCheck.reason}`);
    }

    const fullPath = resolve(sandbox.instance.workDir, path);
    return await readFile(fullPath, "utf-8");
  }

  async isHealthy(sandboxId: string): Promise<boolean> {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) {
      return false;
    }

    try {
      const result = await this.exec(sandboxId, "echo ok", 5000);
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }
}
