import { createLogger } from "@prometheus/logger";
import type {
  SandboxConfig,
  SandboxInstance,
  SandboxProvider,
} from "./sandbox-provider";

const logger = createLogger("sandbox-manager:pool-manager");

const HEALTH_CHECK_INTERVAL_MS = 30_000;
const DEFAULT_WARM_POOL_SIZE = 2;
const DEFAULT_MAX_POOL_SIZE = 20;
const DEFAULT_IDLE_TTL_MS = 30 * 60 * 1000; // 30 min

interface PooledInstance {
  acquiredAt: Date | null;
  createdAt: Date;
  idleTimer: ReturnType<typeof setTimeout> | null;
  instance: SandboxInstance;
  lastUsedAt: Date;
  projectId: string | null;
  providerName: "docker" | "firecracker" | "dev";
}

export interface PoolManagerMetrics {
  activeSandboxes: number;
  avgCreationTimeMs: number;
  byProvider: Record<string, { active: number; idle: number; total: number }>;
  idleSandboxes: number;
  maxCapacity: number;
  poolSize: number;
  warmTarget: number;
}

interface PoolManagerConfig {
  /** Idle TTL before eviction (ms) */
  idleTtlMs?: number;
  /** Maximum total sandboxes across all providers */
  maxPoolSize?: number;
  /** Target number of warm (idle, ready) sandboxes per provider */
  warmPoolSize?: number;
}

/**
 * Enhanced pool manager that works with any SandboxProvider.
 *
 * Manages a warm pool of pre-created sandboxes across multiple providers,
 * with health checks, idle eviction, and async replenishment.
 */
export class PoolManager {
  private readonly providers = new Map<string, SandboxProvider>();
  private readonly pool = new Map<string, PooledInstance>();
  private readonly warmPoolSize: number;
  private readonly maxPoolSize: number;
  private readonly idleTtlMs: number;
  private readonly creationTimes: number[] = [];
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config?: PoolManagerConfig) {
    this.warmPoolSize = config?.warmPoolSize ?? DEFAULT_WARM_POOL_SIZE;
    this.maxPoolSize = config?.maxPoolSize ?? DEFAULT_MAX_POOL_SIZE;
    this.idleTtlMs = config?.idleTtlMs ?? DEFAULT_IDLE_TTL_MS;
  }

  /** Register a provider with the pool manager */
  registerProvider(provider: SandboxProvider): void {
    this.providers.set(provider.name, provider);
    logger.info({ provider: provider.name }, "Provider registered");
  }

  /** Get a registered provider by name */
  getProvider(name: string): SandboxProvider | undefined {
    return this.providers.get(name);
  }

  /**
   * Initialize the pool: pre-warm sandboxes and start health check / cleanup timers.
   */
  async initialize(
    defaultProvider?: "docker" | "firecracker" | "dev"
  ): Promise<void> {
    const providerName = defaultProvider ?? this.getDefaultProviderName();
    const provider = this.providers.get(providerName);
    if (!provider) {
      logger.warn(
        { provider: providerName },
        "Default provider not registered, skipping warm pool"
      );
      return;
    }

    logger.info(
      {
        provider: providerName,
        warmPoolSize: this.warmPoolSize,
        maxPoolSize: this.maxPoolSize,
      },
      "Initializing pool manager"
    );

    // Pre-warm sandboxes
    const promises: Promise<void>[] = [];
    for (let i = 0; i < this.warmPoolSize; i++) {
      promises.push(this.addWarmSandbox(provider));
    }
    await Promise.allSettled(promises);

    // Start health checks every 30s
    this.healthCheckInterval = setInterval(() => {
      this.runHealthChecks().catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ error: msg }, "Health check cycle failed");
      });
    }, HEALTH_CHECK_INTERVAL_MS);

    // Start idle cleanup every 60s
    this.cleanupInterval = setInterval(() => {
      this.cleanupIdleSandboxes().catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ error: msg }, "Cleanup cycle failed");
      });
    }, 60_000);

    logger.info({ poolSize: this.pool.size }, "Pool manager initialized");
  }

  /**
   * Acquire a sandbox from the pool or create a new one.
   */
  async acquire(
    config: SandboxConfig,
    preferredProvider?: "docker" | "firecracker" | "dev"
  ): Promise<SandboxInstance> {
    const providerName = preferredProvider ?? this.getDefaultProviderName();
    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new Error(`Provider "${providerName}" is not registered`);
    }

    // Try to find an idle sandbox from the preferred provider
    for (const [, pooled] of this.pool) {
      if (
        pooled.providerName === providerName &&
        pooled.acquiredAt === null &&
        pooled.instance.status === "running"
      ) {
        return this.markAcquired(pooled, config.projectId);
      }
    }

    // No idle sandbox available — create on demand if under capacity
    if (this.pool.size >= this.maxPoolSize) {
      throw new Error("Pool at maximum capacity. No sandboxes available.");
    }

    const startTime = Date.now();
    const instance = await provider.create(config);
    const creationTime = Date.now() - startTime;
    this.recordCreationTime(creationTime);

    const pooled: PooledInstance = {
      instance,
      providerName,
      projectId: config.projectId,
      acquiredAt: new Date(),
      lastUsedAt: new Date(),
      createdAt: new Date(),
      idleTimer: null,
    };

    this.pool.set(instance.id, pooled);

    logger.info(
      {
        sandboxId: instance.id,
        provider: providerName,
        creationTimeMs: creationTime,
      },
      "Sandbox created on demand"
    );

    // Replenish warm pool asynchronously
    this.replenishPool(provider).catch(() => {
      /* fire-and-forget */
    });

    return instance;
  }

  /**
   * Release a sandbox back to the pool.
   */
  release(sandboxId: string): void {
    const pooled = this.pool.get(sandboxId);
    if (!pooled) {
      return;
    }

    pooled.acquiredAt = null;
    pooled.projectId = null;
    pooled.lastUsedAt = new Date();

    // Clear existing idle timer
    if (pooled.idleTimer) {
      clearTimeout(pooled.idleTimer);
    }

    // Start idle TTL timer
    pooled.idleTimer = setTimeout(() => {
      this.evict(sandboxId).catch(() => {
        /* fire-and-forget */
      });
    }, this.idleTtlMs);

    logger.info({ sandboxId }, "Sandbox released back to pool");
  }

  /**
   * Destroy a specific sandbox.
   */
  async destroy(sandboxId: string): Promise<void> {
    const pooled = this.pool.get(sandboxId);
    if (!pooled) {
      return;
    }

    if (pooled.idleTimer) {
      clearTimeout(pooled.idleTimer);
    }

    const provider = this.providers.get(pooled.providerName);
    if (provider) {
      await provider.destroy(sandboxId);
    }

    this.pool.delete(sandboxId);
    logger.info({ sandboxId }, "Sandbox destroyed");

    // Replenish if needed
    if (provider) {
      this.replenishPool(provider).catch(() => {
        /* fire-and-forget */
      });
    }
  }

  /**
   * Get pool metrics.
   */
  getMetrics(): PoolManagerMetrics {
    let activeSandboxes = 0;
    let idleSandboxes = 0;
    const byProvider: Record<
      string,
      { active: number; idle: number; total: number }
    > = {};

    for (const [, pooled] of this.pool) {
      const pName = pooled.providerName;
      if (!byProvider[pName]) {
        byProvider[pName] = { active: 0, idle: 0, total: 0 };
      }

      const pMetrics = byProvider[pName];
      pMetrics.total++;

      if (pooled.acquiredAt === null) {
        idleSandboxes++;
        pMetrics.idle++;
      } else {
        activeSandboxes++;
        pMetrics.active++;
      }
    }

    const avgCreationTimeMs =
      this.creationTimes.length > 0
        ? this.creationTimes.reduce((a, b) => a + b, 0) /
          this.creationTimes.length
        : 0;

    return {
      poolSize: this.pool.size,
      activeSandboxes,
      idleSandboxes,
      warmTarget: this.warmPoolSize,
      maxCapacity: this.maxPoolSize,
      avgCreationTimeMs: Math.round(avgCreationTimeMs),
      byProvider,
    };
  }

  /**
   * Shut down the pool, destroying all sandboxes and stopping timers.
   */
  async shutdown(): Promise<void> {
    logger.info("Shutting down pool manager");

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    const destroyPromises: Promise<void>[] = [];

    for (const [sandboxId, pooled] of this.pool) {
      if (pooled.idleTimer) {
        clearTimeout(pooled.idleTimer);
      }

      const provider = this.providers.get(pooled.providerName);
      if (provider) {
        destroyPromises.push(provider.destroy(sandboxId));
      }
    }

    await Promise.allSettled(destroyPromises);
    this.pool.clear();

    logger.info("Pool manager shut down");
  }

  // ─── Private helpers ───────────────────────────────────────────────

  private markAcquired(
    pooled: PooledInstance,
    projectId: string
  ): SandboxInstance {
    if (pooled.idleTimer) {
      clearTimeout(pooled.idleTimer);
      pooled.idleTimer = null;
    }

    pooled.acquiredAt = new Date();
    pooled.lastUsedAt = new Date();
    pooled.projectId = projectId;

    logger.info(
      { sandboxId: pooled.instance.id, projectId },
      "Sandbox acquired from pool"
    );

    // Replenish warm pool asynchronously
    const provider = this.providers.get(pooled.providerName);
    if (provider) {
      this.replenishPool(provider).catch(() => {
        /* fire-and-forget */
      });
    }

    return pooled.instance;
  }

  private async addWarmSandbox(provider: SandboxProvider): Promise<void> {
    try {
      const startTime = Date.now();
      const instance = await provider.create({
        projectId: "__warm_pool__",
        cpuLimit: 0.5,
        memoryMb: 512,
      });
      const creationTime = Date.now() - startTime;
      this.recordCreationTime(creationTime);

      const pooled: PooledInstance = {
        instance,
        providerName: provider.name,
        projectId: null,
        acquiredAt: null,
        lastUsedAt: new Date(),
        createdAt: new Date(),
        idleTimer: null,
      };

      this.pool.set(instance.id, pooled);
      logger.debug(
        { sandboxId: instance.id, provider: provider.name },
        "Warm sandbox added"
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn(
        { provider: provider.name, error: msg },
        "Failed to add warm sandbox"
      );
    }
  }

  private async replenishPool(provider: SandboxProvider): Promise<void> {
    const idleForProvider = Array.from(this.pool.values()).filter(
      (p) => p.providerName === provider.name && p.acquiredAt === null
    ).length;

    const deficit = this.warmPoolSize - idleForProvider;
    if (deficit <= 0 || this.pool.size >= this.maxPoolSize) {
      return;
    }

    const toCreate = Math.min(deficit, this.maxPoolSize - this.pool.size);
    const promises: Promise<void>[] = [];
    for (let i = 0; i < toCreate; i++) {
      promises.push(this.addWarmSandbox(provider));
    }
    await Promise.allSettled(promises);
  }

  private async evict(sandboxId: string): Promise<void> {
    const pooled = this.pool.get(sandboxId);
    if (!pooled || pooled.acquiredAt !== null) {
      return; // Don't evict active sandboxes
    }

    logger.info({ sandboxId }, "Evicting idle sandbox (TTL expired)");

    const provider = this.providers.get(pooled.providerName);
    if (provider) {
      await provider.destroy(sandboxId);
    }
    this.pool.delete(sandboxId);

    // Replenish if needed
    if (provider) {
      this.replenishPool(provider).catch(() => {
        /* fire-and-forget */
      });
    }
  }

  private async runHealthChecks(): Promise<void> {
    for (const [sandboxId, pooled] of this.pool) {
      // Only check idle sandboxes to avoid interfering with active work
      if (pooled.acquiredAt !== null) {
        continue;
      }

      const provider = this.providers.get(pooled.providerName);
      if (!provider) {
        continue;
      }

      const healthy = await provider.isHealthy(sandboxId);
      if (!healthy) {
        logger.warn(
          { sandboxId, provider: pooled.providerName },
          "Unhealthy sandbox detected, removing from pool"
        );

        if (pooled.idleTimer) {
          clearTimeout(pooled.idleTimer);
        }

        this.pool.delete(sandboxId);
        await provider.destroy(sandboxId).catch(() => {
          /* best-effort */
        });

        // Replenish
        this.replenishPool(provider).catch(() => {
          /* fire-and-forget */
        });
      }
    }
  }

  private async cleanupIdleSandboxes(): Promise<void> {
    const now = Date.now();

    for (const [sandboxId, pooled] of this.pool) {
      if (pooled.acquiredAt !== null) {
        continue;
      }

      const idleMs = now - pooled.lastUsedAt.getTime();
      if (idleMs > this.idleTtlMs) {
        await this.evict(sandboxId);
      }
    }
  }

  private getDefaultProviderName(): "docker" | "firecracker" | "dev" {
    // Prefer providers in order: docker > firecracker > dev
    if (this.providers.has("docker")) {
      return "docker";
    }
    if (this.providers.has("firecracker")) {
      return "firecracker";
    }
    return "dev";
  }

  private recordCreationTime(ms: number): void {
    this.creationTimes.push(ms);
    // Keep only the last 100 measurements
    if (this.creationTimes.length > 100) {
      this.creationTimes.shift();
    }
  }
}
