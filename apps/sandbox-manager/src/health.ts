import { freemem, loadavg, totalmem } from "node:os";
import { createLogger } from "@prometheus/logger";
import type { ContainerManager } from "./container";
import type { SandboxPool } from "./pool";

const logger = createLogger("sandbox-manager:health");

const WHITESPACE_RE = /\s+/;

export interface HealthStatus {
  checks: Record<string, boolean>;
  docker: {
    available: boolean;
    activeContainers: number;
  };
  mode: "docker" | "dev";
  pool: {
    total: number;
    active: number;
    idle: number;
    warmTarget: number;
    maxCapacity: number;
  };
  status: "healthy" | "degraded" | "unhealthy";
  system: {
    memoryUsedMb: number;
    memoryTotalMb: number;
    memoryUsagePercent: number;
    loadAverage: number[];
    diskUsagePercent: number | null;
    diskFreeMb: number | null;
  };
  timestamp: string;
  uptime: number;
  version: string;
}

const startTime = Date.now();

/**
 * Create a health check function that inspects Docker, pool, and system resources.
 */
export function createHealthChecker(
  containerManager: ContainerManager,
  pool: SandboxPool
) {
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: complex but well-structured logic
  return async (): Promise<HealthStatus> => {
    const poolStats = pool.getStats();

    // Check Docker connectivity
    let dockerAvailable = false;
    try {
      dockerAvailable = await containerManager.checkDockerConnectivity();
    } catch {
      dockerAvailable = false;
    }

    // System memory info
    const totalMem = totalmem();
    const freeMem = freemem();
    const usedMem = totalMem - freeMem;
    const memoryUsagePercent = Math.round((usedMem / totalMem) * 100);

    // Disk usage for sandbox directory
    let diskUsagePercent: number | null = null;
    let diskFreeMb: number | null = null;
    try {
      const diskInfo = await getDiskUsage();
      diskUsagePercent = diskInfo.usagePercent;
      diskFreeMb = diskInfo.freeMb;
    } catch {
      logger.debug("Could not determine disk usage");
    }

    // Determine overall health status
    let status: "healthy" | "degraded" | "unhealthy" = "healthy";

    if (
      memoryUsagePercent > 95 ||
      (diskUsagePercent !== null && diskUsagePercent > 95)
    ) {
      status = "unhealthy";
    } else if (
      memoryUsagePercent > 85 ||
      (diskUsagePercent !== null && diskUsagePercent > 85) ||
      (process.env.NODE_ENV === "production" && !dockerAvailable)
    ) {
      status = "degraded";
    }

    if (poolStats.total >= poolStats.maxCapacity && poolStats.idle === 0) {
      status = status === "unhealthy" ? "unhealthy" : "degraded";
    }

    // Check Redis connectivity
    let redisOk = false;
    try {
      const { redis } = await import("@prometheus/queue");
      const pong = await redis.ping();
      redisOk = pong === "PONG";
    } catch {
      redisOk = false;
    }

    return {
      status,
      checks: {
        docker: dockerAvailable,
        redis: redisOk,
      },
      version: "0.1.0",
      mode: containerManager.getMode(),
      uptime: Math.floor((Date.now() - startTime) / 1000),
      pool: {
        total: poolStats.total,
        active: poolStats.active,
        idle: poolStats.idle,
        warmTarget: poolStats.warmTarget,
        maxCapacity: poolStats.maxCapacity,
      },
      docker: {
        available: dockerAvailable,
        activeContainers: containerManager.getActiveCount(),
      },
      system: {
        memoryUsedMb: Math.round(usedMem / 1024 / 1024),
        memoryTotalMb: Math.round(totalMem / 1024 / 1024),
        memoryUsagePercent,
        loadAverage: loadavg().map((v) => Math.round(v * 100) / 100),
        diskUsagePercent,
        diskFreeMb,
      },
      timestamp: new Date().toISOString(),
    };
  };
}

/**
 * Get disk usage for the partition containing the sandbox base directory.
 */
async function getDiskUsage(): Promise<{
  usagePercent: number;
  freeMb: number;
}> {
  const { spawn } = await import("node:child_process");

  return new Promise((resolve, reject) => {
    const sandboxDir = process.env.SANDBOX_BASE_DIR ?? "/tmp";
    const child = spawn("df", ["-P", sandboxDir], { timeout: 5000 });

    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error("df command failed"));
        return;
      }

      const lines = output.trim().split("\n");
      if (lines.length < 2) {
        reject(new Error("Unexpected df output"));
        return;
      }

      // Parse df output: Filesystem 1024-blocks Used Available Capacity Mounted
      const parts = lines[1]?.split(WHITESPACE_RE);
      if (!parts || parts.length < 5) {
        reject(new Error("Could not parse df output"));
        return;
      }

      const usedKb = Number.parseInt(parts[2] as string, 10);
      const availKb = Number.parseInt(parts[3] as string, 10);
      const totalKb = usedKb + availKb;
      const usagePercent =
        totalKb > 0 ? Math.round((usedKb / totalKb) * 100) : 0;
      const freeMb = Math.round(availKb / 1024);

      resolve({ usagePercent, freeMb });
    });

    child.on("error", reject);
  });
}
