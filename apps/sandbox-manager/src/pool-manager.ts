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
const AFFINITY_HOLD_MS = 5 * 60 * 1000; // 5 min affinity hold after release

/** Supported template types for pre-created sandbox pools */
export type PoolTemplate = "node18" | "python3.12" | "rust";

/** Template-specific sandbox configuration */
const TEMPLATE_CONFIGS: Record<PoolTemplate, Partial<SandboxConfig>> = {
  node18: { cpuLimit: 1, memoryMb: 1024, diskMb: 2048 },
  "python3.12": { cpuLimit: 1, memoryMb: 1024, diskMb: 2048 },
  rust: { cpuLimit: 2, memoryMb: 2048, diskMb: 4096 },
};

interface PooledInstance {
  acquiredAt: Date | null;
  /** When affinity hold expires */
  affinityExpiresAt: Date | null;
  /** Session ID for affinity tracking */
  affinitySessionId: string | null;
  createdAt: Date;
  idleTimer: ReturnType<typeof setTimeout> | null;
  instance: SandboxInstance;
  lastUsedAt: Date;
  projectId: string | null;
  providerName: "docker" | "firecracker" | "dev" | "gvisor" | "e2b";
  /** Template this instance was created from */
  template: PoolTemplate | null;
}

export interface PoolManagerMetrics {
  activeSandboxes: number;
  avgCreationTimeMs: number;
  byProvider: Record<string, { active: number; idle: number; total: number }>;
  byTemplate: Record<string, { active: number; idle: number; total: number }>;
  idleSandboxes: number;
  maxCapacity: number;
  poolSize: number;
  warmTarget: number;
}

/** Hourly usage statistics for predictive scaling */
interface HourlyUsageStats {
  /** Average active sandboxes during this hour */
  avgActive: number;
  /** Peak active sandboxes during this hour */
  peakActive: number;
  /** Number of data points collected */
  sampleCount: number;
}

interface PoolManagerConfig {
  /** Enable affinity-based reuse (default: true) */
  affinityEnabled?: boolean;
  /** Idle TTL before eviction (ms) */
  idleTtlMs?: number;
  /** Maximum total sandboxes across all providers */
  maxPoolSize?: number;
  /** Enable predictive scaling (default: true) */
  predictiveScalingEnabled?: boolean;
  /** Template pool sizes (overrides warmPoolSize for specific templates) */
  templatePoolSizes?: Partial<Record<PoolTemplate, number>>;
  /** Target number of warm (idle, ready) sandboxes per provider */
  warmPoolSize?: number;
}

/**
 * Enhanced pool manager that works with any SandboxProvider.
 *
 * Manages a warm pool of pre-created sandboxes across multiple providers,
 * with health checks, idle eviction, async replenishment, template-based
 * pools, predictive scaling, and affinity-based reuse.
 */
export class PoolManager {
  private readonly providers = new Map<string, SandboxProvider>();
  private readonly pool = new Map<string, PooledInstance>();
  private readonly warmPoolSize: number;
  private readonly maxPoolSize: number;
  private readonly idleTtlMs: number;
  private readonly creationTimes: number[] = [];
  private readonly affinityEnabled: boolean;
  private readonly predictiveScalingEnabled: boolean;
  private readonly templatePoolSizes: Partial<Record<PoolTemplate, number>>;
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private predictiveScalingInterval: ReturnType<typeof setInterval> | null =
    null;

  /** Track template usage statistics */
  private readonly templateUsageStats = new Map<
    PoolTemplate,
    { acquireCount: number; lastAcquiredAt: Date | null }
  >();

  /** Hourly usage patterns for predictive scaling (0-23 indexed) */
  private readonly hourlyUsage: HourlyUsageStats[] = Array.from(
    { length: 24 },
    () => ({
      avgActive: 0,
      sampleCount: 0,
      peakActive: 0,
    })
  );

  constructor(config?: PoolManagerConfig) {
    this.warmPoolSize = config?.warmPoolSize ?? DEFAULT_WARM_POOL_SIZE;
    this.maxPoolSize = config?.maxPoolSize ?? DEFAULT_MAX_POOL_SIZE;
    this.idleTtlMs = config?.idleTtlMs ?? DEFAULT_IDLE_TTL_MS;
    this.affinityEnabled = config?.affinityEnabled ?? true;
    this.predictiveScalingEnabled = config?.predictiveScalingEnabled ?? true;
    this.templatePoolSizes = config?.templatePoolSizes ?? {};

    // Initialize template stats
    for (const template of Object.keys(TEMPLATE_CONFIGS) as PoolTemplate[]) {
      this.templateUsageStats.set(template, {
        acquireCount: 0,
        lastAcquiredAt: null,
      });
    }
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
    defaultProvider?: "docker" | "firecracker" | "dev" | "gvisor" | "e2b"
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
        affinityEnabled: this.affinityEnabled,
        predictiveScaling: this.predictiveScalingEnabled,
      },
      "Initializing pool manager"
    );

    // Pre-warm generic sandboxes
    const promises: Promise<void>[] = [];
    for (let i = 0; i < this.warmPoolSize; i++) {
      promises.push(this.addWarmSandbox(provider));
    }
    await Promise.allSettled(promises);

    // Pre-warm template-based pools
    await this.initializeTemplatePools(provider);

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

    // Start predictive scaling check every 5 minutes
    if (this.predictiveScalingEnabled) {
      this.predictiveScalingInterval = setInterval(() => {
        this.runPredictiveScaling().catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error({ error: msg }, "Predictive scaling cycle failed");
        });
      }, 5 * 60_000);
    }

    logger.info({ poolSize: this.pool.size }, "Pool manager initialized");
  }

  /**
   * Select the appropriate provider based on trust level.
   */
  private resolveProviderFromTrustLevel(
    trustLevel?: "untrusted" | "semi-trusted" | "lightweight" | "dev"
  ): "docker" | "firecracker" | "dev" | "gvisor" | "e2b" | undefined {
    if (!trustLevel) {
      return undefined;
    }
    const trustMap: Record<
      string,
      "docker" | "firecracker" | "dev" | "gvisor" | "e2b"
    > = {
      untrusted: "firecracker",
      "semi-trusted": "gvisor",
      lightweight: "docker",
      dev: "dev",
    };
    return trustMap[trustLevel];
  }

  /**
   * Acquire a sandbox from the pool or create a new one.
   * Supports template preference and session affinity.
   */
  async acquire(
    config: SandboxConfig,
    preferredProvider?: "docker" | "firecracker" | "dev" | "gvisor" | "e2b",
    options?: { sessionId?: string; template?: PoolTemplate }
  ): Promise<SandboxInstance> {
    const providerName =
      preferredProvider ??
      this.resolveProviderFromTrustLevel(config.trustLevel) ??
      this.getDefaultProviderName();
    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new Error(`Provider "${providerName}" is not registered`);
    }

    const sessionId = options?.sessionId;
    const template = options?.template;

    // Track template usage
    if (template) {
      const stats = this.templateUsageStats.get(template);
      if (stats) {
        stats.acquireCount++;
        stats.lastAcquiredAt = new Date();
      }
    }

    // Record current usage for predictive scaling
    this.recordHourlyUsage();

    // 1. Try affinity-based reuse: find a sandbox that was recently used
    //    by the same session and is still in the affinity hold period
    if (this.affinityEnabled && sessionId) {
      const affinityMatch = this.findAffinitySandbox(
        providerName,
        sessionId,
        template
      );
      if (affinityMatch) {
        logger.info(
          { sandboxId: affinityMatch.instance.id, sessionId },
          "Sandbox reused via session affinity"
        );
        return this.markAcquired(affinityMatch, config.projectId, sessionId);
      }
    }

    // 2. Try to find an idle sandbox from the preferred provider with matching template
    for (const [, pooled] of this.pool) {
      if (
        pooled.providerName === providerName &&
        pooled.acquiredAt === null &&
        pooled.instance.status === "running" &&
        pooled.affinitySessionId === null &&
        (template === undefined || pooled.template === template)
      ) {
        return this.markAcquired(pooled, config.projectId, sessionId);
      }
    }

    // 3. Fallback: try any idle sandbox from the same provider (no template match)
    if (template) {
      for (const [, pooled] of this.pool) {
        if (
          pooled.providerName === providerName &&
          pooled.acquiredAt === null &&
          pooled.instance.status === "running" &&
          pooled.affinitySessionId === null
        ) {
          return this.markAcquired(pooled, config.projectId, sessionId);
        }
      }
    }

    // 4. No idle sandbox available — create on demand if under capacity
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
      template: template ?? null,
      affinitySessionId: sessionId ?? null,
      affinityExpiresAt: null,
    };

    this.pool.set(instance.id, pooled);

    logger.info(
      {
        sandboxId: instance.id,
        provider: providerName,
        template,
        creationTimeMs: creationTime,
      },
      "Sandbox created on demand"
    );

    // Replenish warm pool asynchronously
    this.replenishPool(provider, template).catch(() => {
      /* fire-and-forget */
    });

    return instance;
  }

  /**
   * Release a sandbox back to the pool.
   * If affinity is enabled, holds the sandbox for the session for 5 minutes.
   */
  release(sandboxId: string, sessionId?: string): void {
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

    // Set up affinity hold if enabled
    if (this.affinityEnabled && sessionId) {
      pooled.affinitySessionId = sessionId;
      pooled.affinityExpiresAt = new Date(Date.now() + AFFINITY_HOLD_MS);

      logger.debug(
        { sandboxId, sessionId, holdMs: AFFINITY_HOLD_MS },
        "Sandbox held for session affinity"
      );

      // Set a timer to clear affinity after the hold period
      pooled.idleTimer = setTimeout(() => {
        pooled.affinitySessionId = null;
        pooled.affinityExpiresAt = null;

        // Start the normal idle TTL after affinity expires
        pooled.idleTimer = setTimeout(() => {
          this.evict(sandboxId).catch(() => {
            /* fire-and-forget */
          });
        }, this.idleTtlMs);
      }, AFFINITY_HOLD_MS);
    } else {
      pooled.affinitySessionId = null;
      pooled.affinityExpiresAt = null;

      // Start idle TTL timer
      pooled.idleTimer = setTimeout(() => {
        this.evict(sandboxId).catch(() => {
          /* fire-and-forget */
        });
      }, this.idleTtlMs);
    }

    logger.info({ sandboxId, sessionId }, "Sandbox released back to pool");
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
      this.replenishPool(provider, pooled.template).catch(() => {
        /* fire-and-forget */
      });
    }
  }

  /**
   * Get pool metrics including template breakdown.
   */
  getMetrics(): PoolManagerMetrics {
    let activeSandboxes = 0;
    let idleSandboxes = 0;
    const byProvider: Record<
      string,
      { active: number; idle: number; total: number }
    > = {};
    const byTemplate: Record<
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

      // Track by template
      const tName = pooled.template ?? "generic";
      if (!byTemplate[tName]) {
        byTemplate[tName] = { active: 0, idle: 0, total: 0 };
      }
      const tMetrics = byTemplate[tName];
      tMetrics.total++;

      if (pooled.acquiredAt === null) {
        idleSandboxes++;
        pMetrics.idle++;
        tMetrics.idle++;
      } else {
        activeSandboxes++;
        pMetrics.active++;
        tMetrics.active++;
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
      byTemplate,
    };
  }

  /** Get template usage statistics */
  getTemplateStats(): Record<
    string,
    { acquireCount: number; lastAcquiredAt: Date | null }
  > {
    const stats: Record<
      string,
      { acquireCount: number; lastAcquiredAt: Date | null }
    > = {};

    for (const [template, usage] of this.templateUsageStats) {
      stats[template] = { ...usage };
    }

    return stats;
  }

  /** Get hourly usage patterns for predictive scaling insights */
  getHourlyUsagePatterns(): HourlyUsageStats[] {
    return [...this.hourlyUsage];
  }

  /**
   * Acquire multiple sandboxes at once for parallel agent execution (swarm sessions).
   */
  async acquireMultiple(
    count: number,
    config?: Partial<SandboxConfig>,
    options?: { sessionId?: string; template?: PoolTemplate }
  ): Promise<SandboxInstance[]> {
    const sandboxConfig = {
      projectId: "batch",
      cpuLimit: 1,
      memoryMb: 1024,
      diskMb: 2048,
      ...config,
    } satisfies SandboxConfig;
    const instances: SandboxInstance[] = [];
    for (let i = 0; i < count; i++) {
      if (this.pool.size >= this.maxPoolSize) {
        logger.warn(
          { requested: count, acquired: instances.length },
          "Pool capacity reached during batch acquire"
        );
        break;
      }
      try {
        const instance = await this.acquire(sandboxConfig, undefined, options);
        instances.push(instance);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error(
          { index: i, count, error: msg },
          "Failed to acquire sandbox in batch"
        );
        break;
      }
    }
    logger.info(
      {
        requested: count,
        acquired: instances.length,
        sessionId: options?.sessionId,
      },
      "Batch sandbox acquisition complete"
    );
    return instances;
  }

  /**
   * Shut down the pool, destroying all sandboxes and stopping timers.
   */
  async shutdown(): Promise<void> {
    logger.info("Shutting down pool manager");

    // Persist state before destroying so next startup can reconcile
    await this.persistPoolState();

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    if (this.predictiveScalingInterval) {
      clearInterval(this.predictiveScalingInterval);
      this.predictiveScalingInterval = null;
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

  /**
   * Persist current pool state to Redis for recovery on restart.
   * Called periodically or before graceful shutdown.
   */
  async persistPoolState(): Promise<void> {
    try {
      const { redis } = await import("@prometheus/queue");
      const state = Array.from(this.pool.entries()).map(([id, pooled]) => ({
        sandboxId: id,
        providerName: pooled.providerName,
        projectId: pooled.projectId,
        template: pooled.template,
        affinitySessionId: pooled.affinitySessionId,
        createdAt: pooled.createdAt.toISOString(),
        lastUsedAt: pooled.lastUsedAt.toISOString(),
        acquired: pooled.acquiredAt !== null,
        status: pooled.instance.status,
      }));
      await redis.set("sandbox-pool:state", JSON.stringify(state), "EX", 3600);
      logger.debug({ count: state.length }, "Pool state persisted to Redis");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ error: msg }, "Failed to persist pool state");
    }
  }

  /**
   * Recover pool state from Redis on startup. Returns sandbox IDs that
   * were previously tracked so the caller can reconcile with actual
   * container state (e.g., Docker ps).
   */
  async recoverPoolState(): Promise<
    Array<{ sandboxId: string; providerName: string; projectId: string | null }>
  > {
    try {
      const { redis } = await import("@prometheus/queue");
      const raw = await redis.get("sandbox-pool:state");
      if (!raw) {
        return [];
      }
      const state = JSON.parse(raw) as Array<{
        sandboxId: string;
        providerName: string;
        projectId: string | null;
      }>;
      logger.info({ count: state.length }, "Recovered pool state from Redis");
      return state;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ error: msg }, "Failed to recover pool state");
      return [];
    }
  }

  // ─── Private helpers ───────────────────────────────────────────────

  /**
   * Find a sandbox held by affinity for a specific session.
   */
  private findAffinitySandbox(
    providerName: string,
    sessionId: string,
    template?: PoolTemplate | null
  ): PooledInstance | undefined {
    const now = new Date();

    for (const [, pooled] of this.pool) {
      if (
        pooled.providerName === providerName &&
        pooled.acquiredAt === null &&
        pooled.instance.status === "running" &&
        pooled.affinitySessionId === sessionId &&
        pooled.affinityExpiresAt &&
        pooled.affinityExpiresAt > now &&
        (template === undefined || pooled.template === template)
      ) {
        return pooled;
      }
    }

    return undefined;
  }

  private markAcquired(
    pooled: PooledInstance,
    projectId: string,
    sessionId?: string
  ): SandboxInstance {
    if (pooled.idleTimer) {
      clearTimeout(pooled.idleTimer);
      pooled.idleTimer = null;
    }

    pooled.acquiredAt = new Date();
    pooled.lastUsedAt = new Date();
    pooled.projectId = projectId;
    pooled.affinitySessionId = sessionId ?? null;
    pooled.affinityExpiresAt = null;

    logger.info(
      {
        sandboxId: pooled.instance.id,
        projectId,
        sessionId,
        template: pooled.template,
      },
      "Sandbox acquired from pool"
    );

    // Replenish warm pool asynchronously
    const provider = this.providers.get(pooled.providerName);
    if (provider) {
      this.replenishPool(provider, pooled.template).catch(() => {
        /* fire-and-forget */
      });
    }

    return pooled.instance;
  }

  private async addWarmSandbox(
    provider: SandboxProvider,
    template?: PoolTemplate | null
  ): Promise<void> {
    try {
      const templateConfig = template ? TEMPLATE_CONFIGS[template] : {};
      const startTime = Date.now();
      const instance = await provider.create({
        projectId: "__warm_pool__",
        cpuLimit: 0.5,
        memoryMb: 512,
        ...templateConfig,
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
        template: template ?? null,
        affinitySessionId: null,
        affinityExpiresAt: null,
      };

      this.pool.set(instance.id, pooled);
      logger.debug(
        { sandboxId: instance.id, provider: provider.name, template },
        "Warm sandbox added"
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn(
        { provider: provider.name, template, error: msg },
        "Failed to add warm sandbox"
      );
    }
  }

  private async replenishPool(
    provider: SandboxProvider,
    template?: PoolTemplate | null
  ): Promise<void> {
    const targetSize = template
      ? (this.templatePoolSizes[template] ?? 1)
      : this.warmPoolSize;

    const idleForTarget = Array.from(this.pool.values()).filter(
      (p) =>
        p.providerName === provider.name &&
        p.acquiredAt === null &&
        (template === undefined || p.template === template)
    ).length;

    const deficit = targetSize - idleForTarget;
    if (deficit <= 0 || this.pool.size >= this.maxPoolSize) {
      return;
    }

    const toCreate = Math.min(deficit, this.maxPoolSize - this.pool.size);
    const promises: Promise<void>[] = [];
    for (let i = 0; i < toCreate; i++) {
      promises.push(this.addWarmSandbox(provider, template));
    }
    await Promise.allSettled(promises);
  }

  /**
   * Initialize template-based warm pools.
   */
  private async initializeTemplatePools(
    provider: SandboxProvider
  ): Promise<void> {
    const templates = Object.keys(TEMPLATE_CONFIGS) as PoolTemplate[];

    for (const template of templates) {
      const poolSize = this.templatePoolSizes[template] ?? 0;
      if (poolSize <= 0) {
        continue;
      }

      logger.info({ template, poolSize }, "Pre-warming template pool");

      const promises: Promise<void>[] = [];
      for (let i = 0; i < poolSize; i++) {
        promises.push(this.addWarmSandbox(provider, template));
      }
      await Promise.allSettled(promises);
    }
  }

  /**
   * Predictive scaling: analyze hourly usage patterns and pre-scale
   * during predicted peak hours.
   */
  private async runPredictiveScaling(): Promise<void> {
    const currentHour = new Date().getHours();
    const nextHour = (currentHour + 1) % 24;
    const nextHourStats = this.hourlyUsage[nextHour];

    if (!nextHourStats || nextHourStats.sampleCount === 0) {
      return;
    }

    // If the next hour typically has higher usage, pre-scale now
    const currentActive = this.getActiveCount();
    const predictedPeak = Math.ceil(nextHourStats.peakActive * 1.2); // 20% buffer

    if (predictedPeak <= currentActive + this.getIdleCount()) {
      return; // Already have enough capacity
    }

    const deficit = predictedPeak - (currentActive + this.getIdleCount());
    if (deficit <= 0 || this.pool.size + deficit > this.maxPoolSize) {
      return;
    }

    const providerName = this.getDefaultProviderName();
    const provider = this.providers.get(providerName);
    if (!provider) {
      return;
    }

    logger.info(
      {
        currentHour,
        nextHour,
        predictedPeak,
        currentCapacity: currentActive + this.getIdleCount(),
        deficit,
      },
      "Predictive scaling: pre-warming for upcoming peak"
    );

    const promises: Promise<void>[] = [];
    for (let i = 0; i < Math.min(deficit, 3); i++) {
      // Cap at 3 per cycle
      promises.push(this.addWarmSandbox(provider));
    }
    await Promise.allSettled(promises);
  }

  /**
   * Record current usage for the current hour's statistics.
   */
  private recordHourlyUsage(): void {
    const hour = new Date().getHours();
    const stats = this.hourlyUsage[hour];
    if (!stats) {
      return;
    }

    const activeCount = this.getActiveCount();

    stats.sampleCount++;
    stats.avgActive += (activeCount - stats.avgActive) / stats.sampleCount;
    stats.peakActive = Math.max(stats.peakActive, activeCount);
  }

  private getActiveCount(): number {
    let count = 0;
    for (const [, pooled] of this.pool) {
      if (pooled.acquiredAt !== null) {
        count++;
      }
    }
    return count;
  }

  private getIdleCount(): number {
    let count = 0;
    for (const [, pooled] of this.pool) {
      if (pooled.acquiredAt === null) {
        count++;
      }
    }
    return count;
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
      this.replenishPool(provider, pooled.template).catch(() => {
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
          {
            sandboxId,
            provider: pooled.providerName,
            template: pooled.template,
          },
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
        this.replenishPool(provider, pooled.template).catch(() => {
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

  private getDefaultProviderName():
    | "docker"
    | "firecracker"
    | "dev"
    | "gvisor"
    | "e2b" {
    // Prefer providers in order: docker > e2b > firecracker > dev
    if (this.providers.has("docker")) {
      return "docker";
    }
    if (this.providers.has("e2b")) {
      return "e2b";
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
