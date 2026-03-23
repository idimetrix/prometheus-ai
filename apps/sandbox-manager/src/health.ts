import { freemem, loadavg, totalmem } from "node:os";
import { createLogger } from "@prometheus/logger";
import type { ContainerManager } from "./container";
import type { SandboxPool } from "./pool";

const logger = createLogger("sandbox-manager:health");

const WHITESPACE_RE = /\s+/;

/** OOM detection thresholds */
const OOM_WARNING_THRESHOLD = 90;
const OOM_CRITICAL_THRESHOLD = 95;

/** Zombie container detection: containers stuck for more than 10 minutes */
const ZOMBIE_TIMEOUT_MS = 10 * 60 * 1000;

/** Maximum heartbeat history entries to keep */
const MAX_HEARTBEAT_HISTORY = 100;

export interface HealthStatus {
  checks: Record<string, boolean>;
  docker: {
    available: boolean;
    activeContainers: number;
  };
  mode: "docker" | "firecracker" | "dev" | "e2b";
  oom: {
    lastOomAt: string | null;
    memoryWarning: boolean;
    memoryCritical: boolean;
    oomCount: number;
  };
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
  zombies: {
    zombiesDetected: number;
    zombiesCleaned: number;
  };
}

/** Heartbeat entry for tracking health check history */
interface HeartbeatEntry {
  memoryUsagePercent: number;
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
}

const startTime = Date.now();

/** OOM and zombie tracking state */
let oomCount = 0;
let lastOomAt: string | null = null;
let totalZombiesDetected = 0;
let totalZombiesCleaned = 0;
const heartbeatHistory: HeartbeatEntry[] = [];

/**
 * Create a health check function that inspects Docker, pool, and system resources.
 * Includes OOM detection, zombie container cleanup, and heartbeat tracking.
 */
export function createHealthChecker(
  containerManager: ContainerManager,
  pool: SandboxPool
) {
  return async (): Promise<HealthStatus> => {
    const poolStats = pool.getStats();
    const dockerAvailable = await checkDocker(containerManager);
    const memInfo = getMemoryInfo();
    handleOomDetection(memInfo);
    const diskInfo = await checkDisk();
    const zombieResult = detectAndCleanZombies(containerManager);
    totalZombiesDetected += zombieResult.detected;
    totalZombiesCleaned += zombieResult.cleaned;

    const status = determineHealthStatus(
      memInfo,
      diskInfo,
      dockerAvailable,
      poolStats
    );
    const redisOk = await checkRedis();

    const timestamp = new Date().toISOString();
    heartbeatHistory.push({
      status,
      memoryUsagePercent: memInfo.usagePercent,
      timestamp,
    });
    if (heartbeatHistory.length > MAX_HEARTBEAT_HISTORY) {
      heartbeatHistory.shift();
    }

    return {
      status,
      checks: { docker: dockerAvailable, redis: redisOk },
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
        memoryUsedMb: Math.round(memInfo.usedMem / 1024 / 1024),
        memoryTotalMb: Math.round(memInfo.totalMem / 1024 / 1024),
        memoryUsagePercent: memInfo.usagePercent,
        loadAverage: loadavg().map((v) => Math.round(v * 100) / 100),
        diskUsagePercent: diskInfo.usagePercent,
        diskFreeMb: diskInfo.freeMb,
      },
      oom: {
        oomCount,
        lastOomAt,
        memoryWarning: memInfo.warning,
        memoryCritical: memInfo.critical,
      },
      zombies: {
        zombiesDetected: totalZombiesDetected,
        zombiesCleaned: totalZombiesCleaned,
      },
      timestamp,
    };
  };
}

async function checkDocker(
  containerManager: ContainerManager
): Promise<boolean> {
  try {
    return await containerManager.checkDockerConnectivity();
  } catch {
    return false;
  }
}

function getMemoryInfo(): {
  totalMem: number;
  usedMem: number;
  usagePercent: number;
  warning: boolean;
  critical: boolean;
} {
  const totalMem = totalmem();
  const usedMem = totalMem - freemem();
  const usagePercent = Math.round((usedMem / totalMem) * 100);
  return {
    totalMem,
    usedMem,
    usagePercent,
    warning: usagePercent >= OOM_WARNING_THRESHOLD,
    critical: usagePercent >= OOM_CRITICAL_THRESHOLD,
  };
}

function handleOomDetection(memInfo: {
  usagePercent: number;
  warning: boolean;
  critical: boolean;
}): void {
  if (memInfo.critical) {
    oomCount++;
    lastOomAt = new Date().toISOString();
    logger.error(
      { memoryUsagePercent: memInfo.usagePercent, oomCount },
      "OOM critical threshold reached"
    );
  } else if (memInfo.warning) {
    logger.warn(
      { memoryUsagePercent: memInfo.usagePercent },
      "OOM warning threshold reached"
    );
  }
}

async function checkDisk(): Promise<{
  usagePercent: number | null;
  freeMb: number | null;
}> {
  try {
    const diskInfo = await getDiskUsage();
    return { usagePercent: diskInfo.usagePercent, freeMb: diskInfo.freeMb };
  } catch {
    logger.debug("Could not determine disk usage");
    return { usagePercent: null, freeMb: null };
  }
}

function determineHealthStatus(
  memInfo: { warning: boolean; critical: boolean },
  diskInfo: { usagePercent: number | null },
  dockerAvailable: boolean,
  poolStats: { total: number; maxCapacity: number; idle: number }
): "healthy" | "degraded" | "unhealthy" {
  if (
    memInfo.critical ||
    (diskInfo.usagePercent !== null && diskInfo.usagePercent > 95)
  ) {
    return "unhealthy";
  }

  let status: "healthy" | "degraded" | "unhealthy" = "healthy";
  if (
    memInfo.warning ||
    (diskInfo.usagePercent !== null && diskInfo.usagePercent > 85) ||
    (process.env.NODE_ENV === "production" && !dockerAvailable)
  ) {
    status = "degraded";
  }

  if (
    poolStats.total >= poolStats.maxCapacity &&
    poolStats.idle === 0 &&
    status === "healthy"
  ) {
    status = "degraded";
  }

  return status;
}

async function checkRedis(): Promise<boolean> {
  try {
    const { redis } = await import("@prometheus/queue");
    const pong = await redis.ping();
    return pong === "PONG";
  } catch {
    return false;
  }
}

/**
 * Get the heartbeat history (bounded to MAX_HEARTBEAT_HISTORY entries).
 */
export function getHeartbeatHistory(): HeartbeatEntry[] {
  return [...heartbeatHistory];
}

/**
 * Detect and clean up zombie containers that are stuck in
 * "creating" or "stopping" status for more than ZOMBIE_TIMEOUT_MS.
 */
function detectAndCleanZombies(containerManager: ContainerManager): {
  detected: number;
  cleaned: number;
} {
  const now = Date.now();
  let detected = 0;
  let cleaned = 0;

  for (const container of containerManager.getAllContainers()) {
    if (
      (container.status === "creating" || container.status === "stopping") &&
      now - container.createdAt.getTime() > ZOMBIE_TIMEOUT_MS
    ) {
      detected++;

      logger.warn(
        {
          sandboxId: container.id,
          status: container.status,
          ageMs: now - container.createdAt.getTime(),
        },
        "Zombie container detected"
      );

      // Attempt async cleanup - fire and forget
      containerManager.destroy(container.id).then(
        () => {
          logger.info(
            { sandboxId: container.id },
            "Zombie container cleaned up"
          );
        },
        (error) => {
          const msg = error instanceof Error ? error.message : String(error);
          logger.error(
            { sandboxId: container.id, error: msg },
            "Failed to clean up zombie container"
          );
        }
      );

      cleaned++;
    }
  }

  if (detected > 0) {
    logger.info({ detected, cleaned }, "Zombie container detection completed");
  }

  return { detected, cleaned };
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
