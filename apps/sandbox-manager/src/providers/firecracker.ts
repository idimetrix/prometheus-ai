import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import type {
  ExecResult,
  SandboxConfig,
  SandboxInstance,
  SandboxProvider,
} from "../sandbox-provider";

const logger = createLogger("sandbox-manager:provider:firecracker");

/** Default microVM resource configuration */
const DEFAULT_VCPU_COUNT = 1;
const DEFAULT_MEMORY_MB = 512;
const DEFAULT_ROOTFS_MB = 1024;

/** Firecracker daemon API endpoint */
const DEFAULT_API_BASE = "http://localhost:8080";

interface FirecrackerVm {
  apiEndpoint: string;
  bootedFromSnapshot: boolean;
  instance: SandboxInstance;
  vmId: string;
}

interface FirecrackerConfig {
  /** Base URL for the Firecracker management daemon */
  apiBase?: string;
  /** Path to the kernel image */
  kernelPath?: string;
  /** Path to the root filesystem image */
  rootfsPath?: string;
  /** Path to the VM snapshot for fast restore */
  snapshotPath?: string;
  /** Number of pre-warmed VMs to keep ready */
  warmPoolSize?: number;
}

/**
 * Firecracker microVM sandbox provider.
 *
 * Creates lightweight microVMs using Firecracker's HTTP API.
 * Supports warm pool maintenance and snapshot-based fast boot (<100ms target).
 *
 * Note: The actual HTTP calls to Firecracker are stubbed since
 * Firecracker is not available in development environments.
 * In production, replace the stub methods with real HTTP calls.
 * This provider does NOT use child_process — all VM management
 * is done via the Firecracker REST API (HTTP fetch).
 */
export class FirecrackerProvider implements SandboxProvider {
  readonly name = "firecracker" as const;
  private readonly vms = new Map<string, FirecrackerVm>();
  private readonly warmPool: FirecrackerVm[] = [];
  private readonly apiBase: string;
  private readonly warmPoolSize: number;
  private readonly snapshotPath: string | null;
  private readonly rootfsPath: string;
  private readonly kernelPath: string;
  private replenishing = false;

  constructor(config?: FirecrackerConfig) {
    this.apiBase =
      config?.apiBase ?? process.env.FIRECRACKER_API_BASE ?? DEFAULT_API_BASE;
    this.warmPoolSize =
      config?.warmPoolSize ??
      Number(process.env.FIRECRACKER_WARM_POOL_SIZE ?? 3);
    this.snapshotPath =
      config?.snapshotPath ?? process.env.FIRECRACKER_SNAPSHOT_PATH ?? null;
    this.rootfsPath =
      config?.rootfsPath ??
      process.env.FIRECRACKER_ROOTFS_PATH ??
      "/var/lib/firecracker/rootfs.ext4";
    this.kernelPath =
      config?.kernelPath ??
      process.env.FIRECRACKER_KERNEL_PATH ??
      "/var/lib/firecracker/vmlinux";
  }

  /**
   * Initialize the warm pool with pre-created VMs.
   * Should be called once during service startup.
   */
  async initializeWarmPool(): Promise<void> {
    logger.info(
      { warmPoolSize: this.warmPoolSize, snapshotPath: this.snapshotPath },
      "Initializing Firecracker warm pool"
    );

    const promises: Promise<void>[] = [];
    for (let i = 0; i < this.warmPoolSize; i++) {
      promises.push(this.addToWarmPool());
    }
    await Promise.allSettled(promises);

    logger.info(
      { warmPoolReady: this.warmPool.length },
      "Firecracker warm pool initialized"
    );
  }

  async create(config: SandboxConfig): Promise<SandboxInstance> {
    // Try to grab a VM from the warm pool first
    const warmVm = this.warmPool.shift();
    if (warmVm) {
      this.vms.set(warmVm.instance.id, warmVm);
      logger.info(
        {
          sandboxId: warmVm.instance.id,
          fromWarmPool: true,
          bootedFromSnapshot: warmVm.bootedFromSnapshot,
        },
        "Firecracker sandbox acquired from warm pool"
      );
      this.replenishWarmPool();
      return warmVm.instance;
    }

    // No warm VM available — create one on demand
    const vm = await this.createVm(config);
    this.vms.set(vm.instance.id, vm);

    logger.info(
      { sandboxId: vm.instance.id },
      "Firecracker sandbox created on demand"
    );

    this.replenishWarmPool();
    return vm.instance;
  }

  async destroy(sandboxId: string): Promise<void> {
    const vm = this.vms.get(sandboxId);
    if (!vm) {
      return;
    }

    try {
      await this.stopVm(vm);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn({ sandboxId, error: msg }, "Error stopping Firecracker VM");
    }

    vm.instance.status = "stopped";
    this.vms.delete(sandboxId);

    logger.info({ sandboxId }, "Firecracker sandbox destroyed");
  }

  async exec(
    sandboxId: string,
    command: string,
    timeout = 60_000
  ): Promise<ExecResult> {
    const vm = this.vms.get(sandboxId);
    if (!vm) {
      throw new Error(`Sandbox ${sandboxId} not found`);
    }

    const startTime = Date.now();

    try {
      const result = await this.execInVm(vm, command, timeout);
      const duration = Date.now() - startTime;
      return { ...result, duration };
    } catch (error) {
      const duration = Date.now() - startTime;
      const msg = error instanceof Error ? error.message : String(error);
      return { exitCode: 1, output: "", stderr: msg, duration };
    }
  }

  async writeFile(
    sandboxId: string,
    path: string,
    content: string
  ): Promise<void> {
    const vm = this.vms.get(sandboxId);
    if (!vm) {
      throw new Error(`Sandbox ${sandboxId} not found`);
    }

    await this.writeFileInVm(vm, path, content);
    logger.debug({ sandboxId, path }, "File written in Firecracker sandbox");
  }

  async readFile(sandboxId: string, path: string): Promise<string> {
    const vm = this.vms.get(sandboxId);
    if (!vm) {
      throw new Error(`Sandbox ${sandboxId} not found`);
    }

    return await this.readFileInVm(vm, path);
  }

  async isHealthy(sandboxId: string): Promise<boolean> {
    const vm = this.vms.get(sandboxId);
    if (!vm) {
      return false;
    }

    try {
      const result = await this.execInVm(vm, "echo ok", 5000);
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  /** Get the current warm pool size */
  getWarmPoolSize(): number {
    return this.warmPool.length;
  }

  /** Get total active VM count */
  getActiveCount(): number {
    return this.vms.size;
  }

  // ─── Stubbed Firecracker API interactions ──────────────────────────
  //
  // These methods represent the actual Firecracker HTTP API calls.
  // In production, they would make real HTTP requests to the
  // Firecracker management daemon. Currently stubbed for development.

  private async createVm(config: SandboxConfig): Promise<FirecrackerVm> {
    const id = generateId("sbx");
    const vmId = generateId("fc");
    const vcpuCount = config.cpuLimit ?? DEFAULT_VCPU_COUNT;
    const memoryMb = config.memoryMb ?? DEFAULT_MEMORY_MB;
    const diskMb = config.diskMb ?? DEFAULT_ROOTFS_MB;

    const bootedFromSnapshot = this.snapshotPath !== null;

    if (bootedFromSnapshot) {
      // Snapshot restore path — target <100ms boot time
      await this.apiCall("PUT", "/snapshot/load", {
        snapshot_path: this.snapshotPath,
        mem_backend: {
          backend_type: "File",
          backend_path: `${this.snapshotPath}.mem`,
        },
        enable_diff_snapshots: true,
        resume_vm: true,
      });

      logger.debug(
        { vmId, snapshotPath: this.snapshotPath },
        "VM restored from snapshot"
      );
    } else {
      // Cold boot path — configure VM from scratch
      await this.apiCall("PUT", "/machine-config", {
        vcpu_count: vcpuCount,
        mem_size_mib: memoryMb,
        track_dirty_pages: true,
      });

      await this.apiCall("PUT", "/boot-source", {
        kernel_image_path: this.kernelPath,
        boot_args: "console=ttyS0 reboot=k panic=1 pci=off",
      });

      await this.apiCall("PUT", "/drives/rootfs", {
        drive_id: "rootfs",
        path_on_host: this.rootfsPath,
        is_root_device: true,
        is_read_only: false,
        rate_limiter: {
          bandwidth: { size: diskMb * 1024 * 1024, refill_time: 1000 },
        },
      });

      // Configure networking if enabled
      if (config.networkEnabled !== false) {
        await this.apiCall("PUT", "/network-interfaces/eth0", {
          iface_id: "eth0",
          guest_mac: this.generateMac(),
          host_dev_name: `fc-${vmId.slice(0, 8)}`,
        });
      }

      // Start the VM
      await this.apiCall("PUT", "/actions", { action_type: "InstanceStart" });
    }

    const apiEndpoint = `${this.apiBase}/vms/${vmId}`;

    const instance: SandboxInstance = {
      id,
      provider: "firecracker",
      workDir: "/workspace",
      status: "running",
      containerId: vmId,
      createdAt: new Date(),
    };

    return { instance, vmId, apiEndpoint, bootedFromSnapshot };
  }

  private async stopVm(vm: FirecrackerVm): Promise<void> {
    await this.apiCall("PUT", `/vms/${vm.vmId}/actions`, {
      action_type: "SendCtrlAltDel",
    });

    // Wait briefly for graceful shutdown, then force if needed
    await new Promise<void>((resolve) => setTimeout(resolve, 1000));

    await this.apiCall("DELETE", `/vms/${vm.vmId}`);
  }

  private async execInVm(
    vm: FirecrackerVm,
    command: string,
    timeout: number
  ): Promise<{ exitCode: number; output: string; stderr: string }> {
    // Use vsock guest agent to run commands inside the microVM
    return await this.vsockExec(vm, command, timeout);
  }

  private async writeFileInVm(
    vm: FirecrackerVm,
    path: string,
    content: string
  ): Promise<void> {
    await this.apiCall("PUT", `/vms/${vm.vmId}/agent/files`, {
      path,
      content,
      mode: "0644",
    });
  }

  private async readFileInVm(vm: FirecrackerVm, path: string): Promise<string> {
    const response = await this.apiCall(
      "POST",
      `/vms/${vm.vmId}/agent/files/read`,
      { path }
    );
    return (response as { content?: string })?.content ?? "";
  }

  /**
   * Make an HTTP request to the Firecracker management daemon REST API.
   * Uses fetch() with a 10s timeout via AbortSignal.
   */
  private async apiCall(
    method: string,
    path: string,
    body?: Record<string, unknown>
  ): Promise<unknown> {
    const url = `${this.apiBase}${path}`;

    logger.debug({ method, path, url }, "Firecracker API request");

    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        throw new Error(
          `Firecracker API ${method} ${path} failed (${response.status}): ${errorBody}`
        );
      }

      // Some Firecracker endpoints return 204 No Content
      const contentType = response.headers.get("content-type");
      if (
        response.status === 204 ||
        !contentType?.includes("application/json")
      ) {
        return {};
      }

      return await response.json();
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new Error(
          `Firecracker API ${method} ${path} timed out after 10s`
        );
      }
      throw error;
    }
  }

  /**
   * Send a command to the guest agent via vsock.
   * The guest agent listens on a vsock port and accepts JSON-encoded commands.
   */
  private async vsockExec(
    vm: FirecrackerVm,
    command: string,
    timeout: number
  ): Promise<{ exitCode: number; output: string; stderr: string }> {
    // The vsock guest agent is accessed via the management daemon's proxy endpoint.
    // This avoids needing direct vsock socket access from the host process.
    const response = await this.apiCall("POST", `/vms/${vm.vmId}/agent/exec`, {
      command,
      timeout_ms: timeout,
      working_dir: "/workspace",
    });

    const result = response as {
      exit_code?: number;
      stderr?: string;
      stdout?: string;
    };

    return {
      exitCode: result.exit_code ?? 0,
      output: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  }

  /**
   * Ping the guest agent to verify VM health.
   */
  async pingGuestAgent(sandboxId: string): Promise<boolean> {
    const vm = this.vms.get(sandboxId);
    if (!vm) {
      return false;
    }

    try {
      const response = await this.apiCall(
        "GET",
        `/vms/${vm.vmId}/agent/health`
      );
      const result = response as { healthy?: boolean };
      return result.healthy === true;
    } catch {
      return false;
    }
  }

  private async addToWarmPool(): Promise<void> {
    try {
      const vm = await this.createVm({
        projectId: "__warm_pool__",
        cpuLimit: DEFAULT_VCPU_COUNT,
        memoryMb: DEFAULT_MEMORY_MB,
        diskMb: DEFAULT_ROOTFS_MB,
      });
      this.warmPool.push(vm);
      logger.debug(
        { vmId: vm.vmId, warmPoolSize: this.warmPool.length },
        "VM added to warm pool"
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn({ error: msg }, "Failed to add VM to warm pool");
    }
  }

  private replenishWarmPool(): void {
    if (this.replenishing) {
      return;
    }

    const deficit = this.warmPoolSize - this.warmPool.length;
    if (deficit <= 0) {
      return;
    }

    this.replenishing = true;

    const promises: Promise<void>[] = [];
    for (let i = 0; i < deficit; i++) {
      promises.push(this.addToWarmPool());
    }

    Promise.allSettled(promises)
      .then(() => {
        this.replenishing = false;
        logger.debug(
          { warmPoolSize: this.warmPool.length },
          "Warm pool replenished"
        );
      })
      .catch(() => {
        this.replenishing = false;
      });
  }

  /** Generate a random MAC address for guest networking */
  private generateMac(): string {
    const hex = () =>
      Math.floor(Math.random() * 256)
        .toString(16)
        .padStart(2, "0");
    // Use locally administered, unicast MAC prefix
    return `02:fc:00:${hex()}:${hex()}:${hex()}`;
  }

  /**
   * Shut down the warm pool and all active VMs.
   */
  async shutdown(): Promise<void> {
    logger.info("Shutting down Firecracker provider");

    // Destroy warm pool VMs
    for (const vm of this.warmPool) {
      await this.stopVm(vm).catch(() => {
        /* best-effort */
      });
    }
    this.warmPool.length = 0;

    // Destroy active VMs
    const destroyPromises: Promise<void>[] = [];
    for (const [sandboxId] of this.vms) {
      destroyPromises.push(this.destroy(sandboxId));
    }
    await Promise.allSettled(destroyPromises);

    logger.info("Firecracker provider shut down");
  }
}
