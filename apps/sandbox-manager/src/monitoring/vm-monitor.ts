/**
 * VM Monitor.
 *
 * Collects and tracks resource metrics (CPU, memory, disk I/O, network I/O)
 * for Firecracker microVMs. Supports configurable alert thresholds that
 * trigger callbacks when exceeded.
 */
import { createLogger } from "@prometheus/logger";

const logger = createLogger("sandbox-manager:vm-monitor");

const DEFAULT_API_BASE = "http://localhost:8080";
const DEFAULT_POLL_INTERVAL_MS = 5000;

/** Resource metrics for a single VM */
export interface VMResourceMetrics {
  collectedAt: Date;
  cpuUsage: number; // 0-100 percentage
  diskIO: { readBytes: number; writeBytes: number };
  memoryUsage: number; // 0-100 percentage
  networkIO: { rxBytes: number; txBytes: number };
  vmId: string;
}

/** Alert threshold configuration */
export interface AlertThresholds {
  cpuPercent?: number;
  diskIOReadBytesPerSec?: number;
  diskIOWriteBytesPerSec?: number;
  memoryPercent?: number;
  networkRxBytesPerSec?: number;
  networkTxBytesPerSec?: number;
}

/** Alert event fired when a threshold is exceeded */
export interface VMAlert {
  metric: string;
  threshold: number;
  triggeredAt: Date;
  value: number;
  vmId: string;
}

type AlertCallback = (alert: VMAlert) => void;

/** Internal per-VM monitoring state */
interface MonitoredVM {
  lastMetrics: VMResourceMetrics | null;
  pollInterval: ReturnType<typeof setInterval> | null;
  previousMetrics: VMResourceMetrics | null;
  thresholds: AlertThresholds;
  vmId: string;
}

export class VMMonitor {
  private readonly apiBase: string;
  private readonly pollIntervalMs: number;
  private readonly monitored = new Map<string, MonitoredVM>();
  private readonly alertCallbacks: AlertCallback[] = [];

  constructor(options?: { apiBase?: string; pollIntervalMs?: number }) {
    this.apiBase =
      options?.apiBase ?? process.env.FIRECRACKER_API_BASE ?? DEFAULT_API_BASE;
    this.pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  }

  /**
   * Start monitoring a VM. Begins polling for metrics at the configured interval.
   */
  startMonitoring(vmId: string, thresholds?: AlertThresholds): void {
    if (this.monitored.has(vmId)) {
      logger.warn({ vmId }, "VM is already being monitored");
      return;
    }

    const state: MonitoredVM = {
      vmId,
      thresholds: thresholds ?? {},
      pollInterval: null,
      lastMetrics: null,
      previousMetrics: null,
    };

    state.pollInterval = setInterval(() => {
      this.collectMetrics(vmId).catch((error) => {
        const msg = error instanceof Error ? error.message : String(error);
        logger.debug({ vmId, error: msg }, "Failed to collect VM metrics");
      });
    }, this.pollIntervalMs);

    this.monitored.set(vmId, state);
    logger.info(
      { vmId, pollIntervalMs: this.pollIntervalMs },
      "Started monitoring VM"
    );
  }

  /**
   * Stop monitoring a VM.
   */
  stopMonitoring(vmId: string): void {
    const state = this.monitored.get(vmId);
    if (!state) {
      return;
    }

    if (state.pollInterval) {
      clearInterval(state.pollInterval);
    }

    this.monitored.delete(vmId);
    logger.info({ vmId }, "Stopped monitoring VM");
  }

  /**
   * Get the latest collected metrics for a VM.
   */
  getMetrics(vmId: string): VMResourceMetrics | null {
    const state = this.monitored.get(vmId);
    return state?.lastMetrics ?? null;
  }

  /**
   * Set or update alert thresholds for a VM.
   */
  setAlertThresholds(vmId: string, thresholds: AlertThresholds): void {
    const state = this.monitored.get(vmId);
    if (!state) {
      throw new Error(`VM ${vmId} is not being monitored`);
    }

    state.thresholds = { ...state.thresholds, ...thresholds };
    logger.info(
      { vmId, thresholds: state.thresholds },
      "Alert thresholds updated"
    );
  }

  /**
   * Register a callback to be fired when any alert threshold is exceeded.
   */
  onAlert(callback: AlertCallback): void {
    this.alertCallbacks.push(callback);
  }

  /**
   * Stop monitoring all VMs and clean up.
   */
  shutdown(): void {
    for (const [vmId, state] of this.monitored) {
      if (state.pollInterval) {
        clearInterval(state.pollInterval);
      }
      logger.debug({ vmId }, "Stopped monitoring on shutdown");
    }
    this.monitored.clear();
    logger.info("VM monitor shut down");
  }

  /**
   * Get a list of all monitored VM IDs.
   */
  getMonitoredVMs(): string[] {
    return Array.from(this.monitored.keys());
  }

  // ─── Private helpers ───────────────────────────────────────────────

  private async collectMetrics(vmId: string): Promise<void> {
    const state = this.monitored.get(vmId);
    if (!state) {
      return;
    }

    try {
      const raw = await this.fetchRawMetrics(vmId);

      const metrics: VMResourceMetrics = {
        vmId,
        cpuUsage: raw.cpuUsage ?? 0,
        memoryUsage: raw.memoryUsage ?? 0,
        diskIO: {
          readBytes: raw.diskReadBytes ?? 0,
          writeBytes: raw.diskWriteBytes ?? 0,
        },
        networkIO: {
          rxBytes: raw.netRxBytes ?? 0,
          txBytes: raw.netTxBytes ?? 0,
        },
        collectedAt: new Date(),
      };

      state.previousMetrics = state.lastMetrics;
      state.lastMetrics = metrics;

      // Check thresholds
      this.checkThresholds(state, metrics);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.debug({ vmId, error: msg }, "Metrics collection failed");
    }
  }

  private checkThresholds(
    state: MonitoredVM,
    metrics: VMResourceMetrics
  ): void {
    const { thresholds, vmId } = state;

    const checks: Array<{
      metric: string;
      value: number;
      threshold: number | undefined;
    }> = [
      {
        metric: "cpu",
        value: metrics.cpuUsage,
        threshold: thresholds.cpuPercent,
      },
      {
        metric: "memory",
        value: metrics.memoryUsage,
        threshold: thresholds.memoryPercent,
      },
      {
        metric: "diskReadBytes",
        value: metrics.diskIO.readBytes,
        threshold: thresholds.diskIOReadBytesPerSec,
      },
      {
        metric: "diskWriteBytes",
        value: metrics.diskIO.writeBytes,
        threshold: thresholds.diskIOWriteBytesPerSec,
      },
      {
        metric: "networkRx",
        value: metrics.networkIO.rxBytes,
        threshold: thresholds.networkRxBytesPerSec,
      },
      {
        metric: "networkTx",
        value: metrics.networkIO.txBytes,
        threshold: thresholds.networkTxBytesPerSec,
      },
    ];

    for (const check of checks) {
      if (check.threshold !== undefined && check.value > check.threshold) {
        const alert: VMAlert = {
          vmId,
          metric: check.metric,
          value: check.value,
          threshold: check.threshold,
          triggeredAt: new Date(),
        };

        logger.warn(
          {
            vmId,
            metric: check.metric,
            value: check.value,
            threshold: check.threshold,
          },
          "VM alert threshold exceeded"
        );

        for (const cb of this.alertCallbacks) {
          try {
            cb(alert);
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            logger.error({ error: msg }, "Alert callback failed");
          }
        }
      }
    }
  }

  private async fetchRawMetrics(vmId: string): Promise<{
    cpuUsage?: number;
    memoryUsage?: number;
    diskReadBytes?: number;
    diskWriteBytes?: number;
    netRxBytes?: number;
    netTxBytes?: number;
  }> {
    const url = `${this.apiBase}/vms/${vmId}/metrics`;

    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch metrics for VM ${vmId}: ${response.status}`
      );
    }

    return (await response.json()) as {
      cpuUsage?: number;
      memoryUsage?: number;
      diskReadBytes?: number;
      diskWriteBytes?: number;
      netRxBytes?: number;
      netTxBytes?: number;
    };
  }
}
