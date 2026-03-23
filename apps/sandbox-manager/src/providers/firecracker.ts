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

/** Health check timeout for vsock agent pings */
const HEALTH_CHECK_TIMEOUT_MS = 5000;

/** API call timeout */
const API_TIMEOUT_MS = 10_000;

/** Warm pool replenish cap per cycle */
const WARM_POOL_REPLENISH_CAP = 5;

/** Metrics collection interval */
const METRICS_INTERVAL_MS = 15_000;

/** Time-of-day based demand prediction window (24 hours) */
const PREDICTION_WINDOW_HOURS = 24;

interface FirecrackerVm {
  apiEndpoint: string;
  bootedFromSnapshot: boolean;
  bootTimeMs: number;
  instance: SandboxInstance;
  vmId: string;
}

interface FirecrackerConfig {
  /** Base URL for the Firecracker management daemon */
  apiBase?: string;
  /** Boot arguments for the kernel */
  bootArgs?: string;
  /** Path to the kernel image */
  kernelPath?: string;
  /** Maximum warm pool size for auto-scaling */
  maxWarmPoolSize?: number;
  /** Path to the root filesystem image */
  rootfsPath?: string;
  /** Path to the VM snapshot for fast restore */
  snapshotPath?: string;
  /** Number of pre-warmed VMs to keep ready */
  warmPoolSize?: number;
}

/** Prometheus-style metrics for monitoring */
interface PoolMetrics {
  available: number;
  avgBootTimeMs: number;
  inUse: number;
  poolSize: number;
  snapshotRestoreCount: number;
  totalCreated: number;
  totalDestroyed: number;
}

/** Time-of-day usage sample for predictive allocation */
interface HourlyDemandSample {
  hour: number;
  peakInUse: number;
  sampleCount: number;
}

/**
 * Firecracker microVM sandbox provider.
 *
 * Creates lightweight microVMs using Firecracker's HTTP API with real
 * lifecycle management: configure -> boot -> monitor -> shutdown.
 *
 * Features:
 * - Real Firecracker REST API calls (PUT /machine-config, /boot-source, etc.)
 * - Warm pool with predictive allocation based on time-of-day patterns
 * - Snapshot-based fast boot (<100ms target)
 * - Health checks via vsock guest agent
 * - Resource limits configuration (vCPU, memory, disk)
 * - Prometheus utilization metrics
 */
export class FirecrackerProvider implements SandboxProvider {
  readonly name = "firecracker" as const;
  private readonly vms = new Map<string, FirecrackerVm>();
  private readonly warmPool: FirecrackerVm[] = [];
  private readonly apiBase: string;
  private readonly warmPoolSize: number;
  private readonly maxWarmPoolSize: number;
  private readonly snapshotPath: string | null;
  private readonly rootfsPath: string;
  private readonly kernelPath: string;
  private readonly bootArgs: string;
  private replenishing = false;

  /** Metrics tracking */
  private totalCreated = 0;
  private totalDestroyed = 0;
  private snapshotRestoreCount = 0;
  private readonly bootTimes: number[] = [];

  /** Time-of-day demand tracking for predictive allocation */
  private readonly hourlyDemand: HourlyDemandSample[] = Array.from(
    { length: PREDICTION_WINDOW_HOURS },
    (_, i) => ({ hour: i, peakInUse: 0, sampleCount: 0 })
  );

  /** Metrics collection interval handle */
  private metricsInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config?: FirecrackerConfig) {
    this.apiBase =
      config?.apiBase ?? process.env.FIRECRACKER_API_BASE ?? DEFAULT_API_BASE;
    this.warmPoolSize =
      config?.warmPoolSize ??
      Number(process.env.FIRECRACKER_WARM_POOL_SIZE ?? 5);
    this.maxWarmPoolSize =
      config?.maxWarmPoolSize ??
      Number(process.env.FIRECRACKER_MAX_WARM_POOL_SIZE ?? 15);
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
    this.bootArgs =
      config?.bootArgs ?? "console=ttyS0 reboot=k panic=1 pci=off";
  }

  /**
   * Initialize the warm pool with pre-created VMs and start metrics collection.
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

    // Start metrics collection and predictive scaling
    this.metricsInterval = setInterval(() => {
      this.recordDemandSample();
      this.adjustPoolSize();
    }, METRICS_INTERVAL_MS);

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
          bootTimeMs: warmVm.bootTimeMs,
        },
        "Firecracker sandbox acquired from warm pool"
      );
      this.replenishWarmPool();
      return warmVm.instance;
    }

    // No warm VM available -- create one on demand
    const vm = await this.createVm(config);
    this.vms.set(vm.instance.id, vm);
    this.totalCreated++;

    logger.info(
      { sandboxId: vm.instance.id, bootTimeMs: vm.bootTimeMs },
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
    this.totalDestroyed++;

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
      const result = await this.vsockExec(vm, command, timeout);
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
    return await this.pingGuestAgent(sandboxId);
  }

  /**
   * Take a snapshot of a running VM.
   * Pauses the VM, takes a full snapshot, then resumes.
   */
  async snapshot(sandboxId: string): Promise<string> {
    const vm = this.vms.get(sandboxId);
    if (!vm) {
      throw new Error(`Sandbox ${sandboxId} not found`);
    }

    const snapshotId = generateId("snap");
    const snapshotPath = `/var/lib/firecracker/snapshots/${snapshotId}`;

    logger.info({ sandboxId, snapshotId }, "Creating Firecracker VM snapshot");

    // Pause VM before snapshot
    await this.apiCall("PATCH", `/vms/${vm.vmId}/vm`, { state: "Paused" });

    // Create the snapshot
    await this.apiCall("PUT", `/vms/${vm.vmId}/snapshot/create`, {
      snapshot_type: "Full",
      snapshot_path: snapshotPath,
      mem_file_path: `${snapshotPath}.mem`,
    });

    // Resume VM
    await this.apiCall("PATCH", `/vms/${vm.vmId}/vm`, { state: "Resumed" });

    logger.info({ sandboxId, snapshotId, snapshotPath }, "VM snapshot created");
    return snapshotId;
  }

  /**
   * Restore a VM from a snapshot.
   */
  async restore(snapshotId: string): Promise<SandboxInstance> {
    const snapshotPath = `/var/lib/firecracker/snapshots/${snapshotId}`;
    const id = generateId("sbx");
    const vmId = generateId("fc");

    logger.info({ snapshotId, newSandboxId: id }, "Restoring VM from snapshot");

    const startTime = Date.now();

    await this.apiCall("PUT", "/snapshot/load", {
      snapshot_path: snapshotPath,
      mem_backend: {
        backend_type: "File",
        backend_path: `${snapshotPath}.mem`,
      },
      enable_diff_snapshots: true,
      resume_vm: true,
    });

    const bootTimeMs = Date.now() - startTime;
    this.snapshotRestoreCount++;

    const instance: SandboxInstance = {
      id,
      provider: "firecracker",
      workDir: "/workspace",
      status: "running",
      containerId: vmId,
      createdAt: new Date(),
    };

    const vm: FirecrackerVm = {
      instance,
      vmId,
      apiEndpoint: `${this.apiBase}/vms/${vmId}`,
      bootedFromSnapshot: true,
      bootTimeMs,
    };

    this.vms.set(id, vm);

    logger.info(
      { sandboxId: id, snapshotId, bootTimeMs },
      "VM restored from snapshot"
    );

    return instance;
  }

  /** Get the current warm pool size */
  getWarmPoolSize(): number {
    return this.warmPool.length;
  }

  /** Get total active VM count */
  getActiveCount(): number {
    return this.vms.size;
  }

  /** Get Prometheus-style utilization metrics */
  getMetrics(): PoolMetrics {
    const avgBootTimeMs =
      this.bootTimes.length > 0
        ? this.bootTimes.reduce((a, b) => a + b, 0) / this.bootTimes.length
        : 0;

    return {
      poolSize: this.warmPool.length + this.vms.size,
      available: this.warmPool.length,
      inUse: this.vms.size,
      totalCreated: this.totalCreated,
      totalDestroyed: this.totalDestroyed,
      snapshotRestoreCount: this.snapshotRestoreCount,
      avgBootTimeMs: Math.round(avgBootTimeMs),
    };
  }

  // ─── Real Firecracker API lifecycle ──────────────────────────────────

  /**
   * Create a new microVM with full lifecycle:
   * 1. PUT /machine-config (vcpus, mem_size_mib)
   * 2. PUT /boot-source (kernel_image_path, boot_args)
   * 3. PUT /drives/rootfs (path_on_host, is_root_device, is_read_only)
   * 4. PUT /vsock (guest agent communication)
   * 5. PUT /network-interfaces (optional)
   * 6. PUT /actions (InstanceStart)
   * 7. Health check via vsock guest agent
   */
  private async createVm(config: SandboxConfig): Promise<FirecrackerVm> {
    const id = generateId("sbx");
    const vmId = generateId("fc");
    const vcpuCount = config.cpuLimit ?? DEFAULT_VCPU_COUNT;
    const memoryMb = config.memoryMb ?? DEFAULT_MEMORY_MB;
    const diskMb = config.diskMb ?? DEFAULT_ROOTFS_MB;
    const startTime = Date.now();

    const bootedFromSnapshot = this.snapshotPath !== null;

    if (bootedFromSnapshot) {
      // Snapshot restore path -- target <100ms boot time
      await this.apiCall("PUT", "/snapshot/load", {
        snapshot_path: this.snapshotPath,
        mem_backend: {
          backend_type: "File",
          backend_path: `${this.snapshotPath}.mem`,
        },
        enable_diff_snapshots: true,
        resume_vm: true,
      });

      this.snapshotRestoreCount++;

      logger.debug(
        { vmId, snapshotPath: this.snapshotPath },
        "VM restored from snapshot"
      );
    } else {
      // Cold boot path -- configure VM from scratch

      // Step 1: Configure machine resources (vCPUs, memory)
      await this.apiCall("PUT", "/machine-config", {
        vcpu_count: vcpuCount,
        mem_size_mib: memoryMb,
        track_dirty_pages: true,
      });

      // Step 2: Configure boot source (kernel image and boot arguments)
      await this.apiCall("PUT", "/boot-source", {
        kernel_image_path: this.kernelPath,
        boot_args: this.bootArgs,
      });

      // Step 3: Configure root filesystem drive with rate limiting
      await this.apiCall("PUT", "/drives/rootfs", {
        drive_id: "rootfs",
        path_on_host: this.rootfsPath,
        is_root_device: true,
        is_read_only: false,
        rate_limiter: {
          bandwidth: { size: diskMb * 1024 * 1024, refill_time: 1000 },
        },
      });

      // Step 4: Configure vsock for guest agent communication
      await this.apiCall("PUT", "/vsock", {
        guest_cid: 3,
        uds_path: `/tmp/fc-${vmId}.sock`,
      });

      // Step 5: Configure networking if enabled
      if (config.networkEnabled !== false) {
        await this.apiCall("PUT", "/network-interfaces/eth0", {
          iface_id: "eth0",
          guest_mac: this.generateMac(),
          host_dev_name: `fc-${vmId.slice(0, 8)}`,
        });
      }

      // Step 6: Start the VM
      await this.apiCall("PUT", "/actions", { action_type: "InstanceStart" });

      // Step 7: Wait for guest agent to become healthy
      await this.waitForGuestAgent(vmId);
    }

    const bootTimeMs = Date.now() - startTime;
    this.recordBootTime(bootTimeMs);

    const apiEndpoint = `${this.apiBase}/vms/${vmId}`;

    const instance: SandboxInstance = {
      id,
      provider: "firecracker",
      workDir: "/workspace",
      status: "running",
      containerId: vmId,
      createdAt: new Date(),
    };

    this.totalCreated++;

    return { instance, vmId, apiEndpoint, bootedFromSnapshot, bootTimeMs };
  }

  /**
   * Stop a VM gracefully with fallback to force shutdown.
   * Sends CtrlAltDel for graceful shutdown, then force-stops if needed.
   */
  private async stopVm(vm: FirecrackerVm): Promise<void> {
    // Try graceful shutdown via SendCtrlAltDel
    try {
      await this.apiCall("PUT", `/vms/${vm.vmId}/actions`, {
        action_type: "SendCtrlAltDel",
      });

      // Wait briefly for graceful shutdown
      await new Promise<void>((resolve) => setTimeout(resolve, 1000));
    } catch {
      // Graceful shutdown failed, proceed to force stop
      logger.debug({ vmId: vm.vmId }, "Graceful shutdown failed, forcing stop");
    }

    // Force delete the VM
    try {
      await this.apiCall("DELETE", `/vms/${vm.vmId}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn({ vmId: vm.vmId, error: msg }, "Force VM deletion failed");
    }
  }

  /**
   * Wait for the guest agent inside the VM to become responsive.
   * Retries with exponential backoff up to 10 seconds.
   */
  private async waitForGuestAgent(vmId: string): Promise<void> {
    const maxAttempts = 10;
    let delay = 100;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await this.apiCall("GET", `/vms/${vmId}/agent/health`);
        const result = response as { healthy?: boolean };
        if (result.healthy === true) {
          logger.debug(
            { vmId, attempts: attempt + 1 },
            "Guest agent is healthy"
          );
          return;
        }
      } catch {
        // Agent not ready yet, retry
      }

      await new Promise<void>((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, 2000);
    }

    logger.warn({ vmId }, "Guest agent did not become healthy within timeout");
  }

  /**
   * Execute a command inside the microVM via vsock guest agent.
   * The guest agent listens on a vsock port and accepts JSON-encoded commands.
   */
  private async vsockExec(
    vm: FirecrackerVm,
    command: string,
    timeout: number
  ): Promise<{ exitCode: number; output: string; stderr: string }> {
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
   * Ping the guest agent via vsock to verify VM health.
   */
  async pingGuestAgent(sandboxId: string): Promise<boolean> {
    const vm = this.vms.get(sandboxId);
    if (!vm) {
      return false;
    }

    try {
      const response = await fetch(
        `${this.apiBase}/vms/${vm.vmId}/agent/health`,
        {
          method: "GET",
          signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
        }
      );

      if (!response.ok) {
        return false;
      }

      const result = (await response.json()) as { healthy?: boolean };
      return result.healthy === true;
    } catch {
      return false;
    }
  }

  /**
   * Make an HTTP request to the Firecracker management daemon REST API.
   * Uses fetch() with a configurable timeout via AbortSignal.
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
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
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
          `Firecracker API ${method} ${path} timed out after ${API_TIMEOUT_MS}ms`
        );
      }
      throw error;
    }
  }

  // ─── Warm pool management ────────────────────────────────────────────

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

    const targetSize = this.getTargetWarmPoolSize();
    const deficit = targetSize - this.warmPool.length;
    if (deficit <= 0) {
      return;
    }

    this.replenishing = true;
    const toCreate = Math.min(deficit, WARM_POOL_REPLENISH_CAP);

    const promises: Promise<void>[] = [];
    for (let i = 0; i < toCreate; i++) {
      promises.push(this.addToWarmPool());
    }

    Promise.allSettled(promises)
      .then(() => {
        this.replenishing = false;
        logger.debug(
          { warmPoolSize: this.warmPool.length, targetSize },
          "Warm pool replenished"
        );
      })
      .catch(() => {
        this.replenishing = false;
      });
  }

  // ─── Predictive allocation ──────────────────────────────────────────

  /**
   * Record a demand sample for the current hour.
   * Used to build time-of-day usage patterns.
   */
  private recordDemandSample(): void {
    const hour = new Date().getHours();
    const sample = this.hourlyDemand[hour];
    if (!sample) {
      return;
    }

    const currentInUse = this.vms.size;
    sample.sampleCount++;
    sample.peakInUse = Math.max(sample.peakInUse, currentInUse);
  }

  /**
   * Adjust pool size based on time-of-day demand patterns.
   * Scales up before predicted peak hours and down during low-demand periods.
   */
  private adjustPoolSize(): void {
    const nextHour = (new Date().getHours() + 1) % PREDICTION_WINDOW_HOURS;
    const nextHourSample = this.hourlyDemand[nextHour];
    if (!nextHourSample || nextHourSample.sampleCount === 0) {
      return;
    }

    // Target: predicted peak + 20% buffer, clamped to min/max bounds
    const predictedNeed = Math.ceil(nextHourSample.peakInUse * 1.2);
    const targetSize = Math.min(
      Math.max(predictedNeed, this.warmPoolSize),
      this.maxWarmPoolSize
    );

    if (targetSize > this.warmPool.length) {
      logger.debug(
        {
          nextHour,
          predictedNeed,
          targetSize,
          currentPoolSize: this.warmPool.length,
        },
        "Predictive scaling: increasing warm pool"
      );
      this.replenishWarmPool();
    }
  }

  /**
   * Get the target warm pool size based on current demand prediction.
   */
  private getTargetWarmPoolSize(): number {
    const nextHour = (new Date().getHours() + 1) % PREDICTION_WINDOW_HOURS;
    const sample = this.hourlyDemand[nextHour];

    if (!sample || sample.sampleCount === 0) {
      return this.warmPoolSize;
    }

    const predictedNeed = Math.ceil(sample.peakInUse * 1.2);
    return Math.min(
      Math.max(predictedNeed, this.warmPoolSize),
      this.maxWarmPoolSize
    );
  }

  // ─── Boot time tracking ──────────────────────────────────────────────

  private recordBootTime(ms: number): void {
    this.bootTimes.push(ms);
    // Keep only the last 100 measurements
    if (this.bootTimes.length > 100) {
      this.bootTimes.shift();
    }
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

    // Stop metrics collection
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = null;
    }

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
