/**
 * Firecracker VM Manager.
 *
 * Manages the lifecycle of Firecracker microVMs: create, start, stop, destroy.
 * Each VM gets isolated vCPUs, memory, rootfs, and networking configured
 * through the Firecracker API.
 */
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";

const logger = createLogger("sandbox-manager:vm-manager");

const DEFAULT_API_BASE = "http://localhost:8080";

/** VM lifecycle states */
export type VMStatus = "creating" | "running" | "paused" | "stopped" | "error";

/** Configuration for creating a new Firecracker microVM */
export interface VMConfig {
  /** Enable hyperthreading */
  htEnabled?: boolean;
  /** Optional kernel boot arguments */
  kernelArgs?: string;
  /** Path to the Linux kernel image */
  kernelPath: string;
  /** Memory size in MiB (128-32768) */
  memSizeMib: number;
  /** Optional network configuration */
  networkConfig?: VMNetworkConfig;
  /** Path to the root filesystem image */
  rootDrive: string;
  /** Number of vCPUs (1-32) */
  vcpuCount: number;
}

/** Network configuration for a VM */
export interface VMNetworkConfig {
  /** Guest MAC address */
  guestMac?: string;
  /** Host device name for the TAP interface */
  hostDevName: string;
  /** Rate limiter for ingress (bytes per second) */
  rxRateLimitBps?: number;
  /** Rate limiter for egress (bytes per second) */
  txRateLimitBps?: number;
}

/** Tracked VM instance */
interface VMInstance {
  config: VMConfig;
  createdAt: Date;
  id: string;
  pid: number | null;
  socketPath: string;
  startedAt: Date | null;
  status: VMStatus;
  stoppedAt: Date | null;
}

/** VM metrics snapshot */
export interface VMMetrics {
  config: {
    vcpuCount: number;
    memSizeMib: number;
  };
  id: string;
  status: VMStatus;
  uptimeMs: number;
}

export class FirecrackerVMManager {
  private readonly apiBase: string;
  private readonly vms = new Map<string, VMInstance>();

  constructor(apiBase?: string) {
    this.apiBase =
      apiBase ?? process.env.FIRECRACKER_API_BASE ?? DEFAULT_API_BASE;
  }

  /**
   * Create a new Firecracker microVM with the given configuration.
   * The VM is configured but not yet booted.
   */
  async createVM(config: VMConfig): Promise<string> {
    const vmId = generateId("vm");

    logger.info(
      { vmId, vcpuCount: config.vcpuCount, memSizeMib: config.memSizeMib },
      "Creating Firecracker VM"
    );

    const socketPath = `/tmp/firecracker-${vmId}.sock`;

    const instance: VMInstance = {
      id: vmId,
      config,
      status: "creating",
      createdAt: new Date(),
      startedAt: null,
      stoppedAt: null,
      pid: null,
      socketPath,
    };

    this.vms.set(vmId, instance);

    try {
      // Configure machine
      await this.apiCall("PUT", `/vms/${vmId}/machine-config`, {
        vcpu_count: config.vcpuCount,
        mem_size_mib: config.memSizeMib,
        ht_enabled: config.htEnabled ?? false,
      });

      // Configure boot source
      await this.apiCall("PUT", `/vms/${vmId}/boot-source`, {
        kernel_image_path: config.kernelPath,
        boot_args:
          config.kernelArgs ?? "console=ttyS0 reboot=k panic=1 pci=off",
      });

      // Configure root drive
      await this.apiCall("PUT", `/vms/${vmId}/drives/rootfs`, {
        drive_id: "rootfs",
        path_on_host: config.rootDrive,
        is_root_device: true,
        is_read_only: false,
      });

      // Configure network if provided
      if (config.networkConfig) {
        const netConfig: Record<string, unknown> = {
          iface_id: "eth0",
          host_dev_name: config.networkConfig.hostDevName,
        };
        if (config.networkConfig.guestMac) {
          netConfig.guest_mac = config.networkConfig.guestMac;
        }
        if (config.networkConfig.rxRateLimitBps) {
          netConfig.rx_rate_limiter = {
            bandwidth: {
              size: config.networkConfig.rxRateLimitBps,
              refill_time: 1000,
            },
          };
        }
        if (config.networkConfig.txRateLimitBps) {
          netConfig.tx_rate_limiter = {
            bandwidth: {
              size: config.networkConfig.txRateLimitBps,
              refill_time: 1000,
            },
          };
        }
        await this.apiCall(
          "PUT",
          `/vms/${vmId}/network-interfaces/eth0`,
          netConfig
        );
      }

      instance.status = "stopped";
      logger.info({ vmId }, "Firecracker VM created successfully");

      return vmId;
    } catch (error) {
      instance.status = "error";
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ vmId, error: msg }, "Failed to create Firecracker VM");
      throw error;
    }
  }

  /**
   * Boot a created VM by sending the InstanceStart action.
   */
  async startVM(vmId: string): Promise<void> {
    const instance = this.requireVM(vmId);

    if (instance.status === "running") {
      logger.warn({ vmId }, "VM is already running");
      return;
    }

    logger.info({ vmId }, "Starting Firecracker VM");

    try {
      await this.apiCall("PUT", `/vms/${vmId}/actions`, {
        action_type: "InstanceStart",
      });

      instance.status = "running";
      instance.startedAt = new Date();

      logger.info({ vmId }, "Firecracker VM started");
    } catch (error) {
      instance.status = "error";
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ vmId, error: msg }, "Failed to start Firecracker VM");
      throw error;
    }
  }

  /**
   * Gracefully stop a running VM by sending SendCtrlAltDel.
   */
  async stopVM(vmId: string): Promise<void> {
    const instance = this.requireVM(vmId);

    if (instance.status === "stopped") {
      logger.warn({ vmId }, "VM is already stopped");
      return;
    }

    logger.info({ vmId }, "Stopping Firecracker VM");

    try {
      await this.apiCall("PUT", `/vms/${vmId}/actions`, {
        action_type: "SendCtrlAltDel",
      });

      instance.status = "stopped";
      instance.stoppedAt = new Date();

      logger.info({ vmId }, "Firecracker VM stopped");
    } catch (error) {
      instance.status = "error";
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ vmId, error: msg }, "Failed to stop Firecracker VM");
      throw error;
    }
  }

  /**
   * Destroy a VM completely, releasing all resources.
   */
  async destroyVM(vmId: string): Promise<void> {
    const instance = this.vms.get(vmId);
    if (!instance) {
      logger.warn({ vmId }, "VM not found for destruction");
      return;
    }

    logger.info({ vmId }, "Destroying Firecracker VM");

    try {
      // Stop the VM first if it is running
      if (instance.status === "running" || instance.status === "paused") {
        await this.apiCall("PUT", `/vms/${vmId}/actions`, {
          action_type: "SendCtrlAltDel",
        });
      }

      // Clean up resources via the management API
      await this.apiCall("DELETE", `/vms/${vmId}`, {});
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn(
        { vmId, error: msg },
        "Error during VM destruction (proceeding with cleanup)"
      );
    }

    this.vms.delete(vmId);
    logger.info({ vmId }, "Firecracker VM destroyed");
  }

  /**
   * Get the current status of a VM.
   */
  getVMStatus(vmId: string): VMStatus {
    const instance = this.vms.get(vmId);
    if (!instance) {
      throw new Error(`VM ${vmId} not found`);
    }
    return instance.status;
  }

  /**
   * List all managed VMs with their metrics.
   */
  listVMs(): VMMetrics[] {
    const now = Date.now();
    return Array.from(this.vms.values()).map((vm) => ({
      id: vm.id,
      status: vm.status,
      uptimeMs:
        vm.startedAt && vm.status === "running"
          ? now - vm.startedAt.getTime()
          : 0,
      config: {
        vcpuCount: vm.config.vcpuCount,
        memSizeMib: vm.config.memSizeMib,
      },
    }));
  }

  /**
   * Get the number of VMs by status.
   */
  getCounts(): Record<VMStatus, number> {
    const counts: Record<VMStatus, number> = {
      creating: 0,
      running: 0,
      paused: 0,
      stopped: 0,
      error: 0,
    };
    for (const vm of this.vms.values()) {
      counts[vm.status]++;
    }
    return counts;
  }

  // ─── Private helpers ───────────────────────────────────────────────

  private requireVM(vmId: string): VMInstance {
    const instance = this.vms.get(vmId);
    if (!instance) {
      throw new Error(`VM ${vmId} not found`);
    }
    return instance;
  }

  private async apiCall(
    method: string,
    path: string,
    body?: Record<string, unknown>
  ): Promise<unknown> {
    const url = `${this.apiBase}${path}`;

    logger.debug({ method, path }, "Firecracker API request");

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
}
