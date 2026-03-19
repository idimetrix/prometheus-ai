/**
 * Abstract interface for sandbox providers.
 *
 * Each provider implements a different sandbox backend (Docker, Firecracker, dev mode)
 * while exposing a uniform API to the pool manager and container manager.
 */

export interface SandboxProvider {
  /** Create a new sandbox instance */
  create(config: SandboxConfig): Promise<SandboxInstance>;

  /** Destroy a sandbox and release all resources */
  destroy(sandboxId: string): Promise<void>;

  /** Execute a shell command inside a sandbox */
  exec(
    sandboxId: string,
    command: string,
    timeout?: number
  ): Promise<ExecResult>;

  /** Check whether a sandbox is healthy and responsive */
  isHealthy(sandboxId: string): Promise<boolean>;
  /** Unique name for this provider */
  readonly name: "docker" | "firecracker" | "dev" | "gvisor";

  /** Read a file from a sandbox */
  readFile(sandboxId: string, path: string): Promise<string>;

  /** Write a file inside a sandbox */
  writeFile(sandboxId: string, path: string, content: string): Promise<void>;
}

export interface SandboxConfig {
  cpuLimit?: number;
  diskMb?: number;
  memoryMb?: number;
  networkAllowlist?: string[];
  networkEnabled?: boolean;
  projectId: string;
  trustLevel?: "untrusted" | "semi-trusted" | "lightweight" | "dev";
}

export interface SandboxInstance {
  containerId: string;
  createdAt: Date;
  id: string;
  provider: "docker" | "firecracker" | "dev" | "gvisor";
  status: "running" | "stopped" | "error";
  workDir: string;
}

export interface ExecResult {
  duration: number;
  exitCode: number;
  output: string;
  stderr: string;
}
