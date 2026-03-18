import { createLogger } from "@prometheus/logger";
import type { ContainerInfo, ContainerManager } from "./container";

const logger = createLogger("sandbox-manager:pool");

interface PooledSandbox {
  acquiredAt: Date | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
  info: ContainerInfo;
  lastUsedAt: Date;
  projectId: string | null;
  sessionId: string | null;
}

export interface PoolStats {
  active: number;
  byStatus: Record<string, number>;
  idle: number;
  maxCapacity: number;
  total: number;
  warmTarget: number;
}

export class SandboxPool {
  private readonly containerManager: ContainerManager;
  private readonly pool = new Map<string, PooledSandbox>();
  private readonly warmPoolSize: number;
  private readonly maxPoolSize: number;
  private readonly idleTtlMs: number;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    containerManager: ContainerManager,
    options?: {
      warmPoolSize?: number;
      maxPoolSize?: number;
      idleTtlMs?: number;
    }
  ) {
    this.containerManager = containerManager;
    this.warmPoolSize =
      options?.warmPoolSize ?? Number(process.env.WARM_POOL_SIZE ?? 2);
    this.maxPoolSize =
      options?.maxPoolSize ?? Number(process.env.MAX_POOL_SIZE ?? 10);
    this.idleTtlMs =
      options?.idleTtlMs ??
      Number(process.env.SANDBOX_IDLE_TTL_MS ?? 30 * 60 * 1000); // 30 min
  }

  /**
   * Initialize the pool with pre-warmed sandboxes and start the cleanup timer.
   */
  async initialize(): Promise<void> {
    logger.info(
      { warmPoolSize: this.warmPoolSize, maxPoolSize: this.maxPoolSize },
      "Initializing sandbox pool"
    );

    // Pre-warm sandboxes
    const promises: Promise<void>[] = [];
    for (let i = 0; i < this.warmPoolSize; i++) {
      promises.push(this.addWarmSandbox());
    }
    await Promise.allSettled(promises);

    // Start periodic cleanup of idle sandboxes
    this.cleanupInterval = setInterval(() => {
      this.cleanupIdleSandboxes().catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ error: msg }, "Cleanup cycle failed");
      });
    }, 60_000); // Check every minute

    logger.info({ poolSize: this.pool.size }, "Sandbox pool initialized");
  }

  /**
   * Acquire a sandbox for a project. Returns an existing idle sandbox or creates a new one.
   */
  async acquire(projectId: string, sessionId?: string): Promise<ContainerInfo> {
    // First try to find an idle sandbox already associated with this project
    for (const [, sandbox] of this.pool) {
      if (
        !sandbox.sessionId &&
        sandbox.info.status === "ready" &&
        sandbox.projectId === projectId
      ) {
        return this.markAcquired(sandbox, projectId, sessionId ?? null);
      }
    }

    // Then try any idle sandbox
    for (const [, sandbox] of this.pool) {
      if (!sandbox.sessionId && sandbox.info.status === "ready") {
        return this.markAcquired(sandbox, projectId, sessionId ?? null);
      }
    }

    // No idle sandbox available -- create a new one if under max capacity
    if (this.pool.size < this.maxPoolSize) {
      const info = await this.containerManager.create({ projectId });
      const pooled: PooledSandbox = {
        info,
        projectId,
        sessionId: sessionId ?? null,
        acquiredAt: new Date(),
        lastUsedAt: new Date(),
        idleTimer: null,
      };
      this.pool.set(info.id, pooled);

      logger.info(
        { sandboxId: info.id, projectId },
        "New sandbox created on demand"
      );
      return info;
    }

    throw new Error("No sandboxes available and pool is at maximum capacity");
  }

  /**
   * Release a sandbox back to the pool. Starts its idle timer.
   */
  async release(sandboxId: string): Promise<void> {
    const sandbox = this.pool.get(sandboxId);
    if (!sandbox) {
      // If not in pool, just destroy it directly
      await this.containerManager.destroy(sandboxId);
      return;
    }

    sandbox.sessionId = null;
    sandbox.acquiredAt = null;
    sandbox.lastUsedAt = new Date();
    sandbox.info.status = "ready";
    sandbox.info.sessionId = null;

    // Clear any existing idle timer
    if (sandbox.idleTimer) {
      clearTimeout(sandbox.idleTimer);
    }

    // Start idle TTL timer
    sandbox.idleTimer = setTimeout(() => {
      this.evictSandbox(sandboxId).catch(() => {
        /* fire-and-forget */
      });
    }, this.idleTtlMs);

    logger.info({ sandboxId }, "Sandbox released back to pool");

    // If we have more idle sandboxes than the warm pool size, evict excess
    const idleCount = this.getIdleCount();
    if (idleCount > this.warmPoolSize + 2) {
      this.evictExcess().catch(() => {
        /* fire-and-forget */
      });
    }
  }

  /**
   * Destroy a specific sandbox and remove from pool.
   */
  async destroy(sandboxId: string): Promise<void> {
    const sandbox = this.pool.get(sandboxId);
    if (sandbox?.idleTimer) {
      clearTimeout(sandbox.idleTimer);
    }

    this.pool.delete(sandboxId);
    await this.containerManager.destroy(sandboxId);

    logger.info({ sandboxId }, "Sandbox destroyed and removed from pool");

    // Replenish warm pool if needed
    this.replenishPool().catch(() => {
      /* fire-and-forget */
    });
  }

  /**
   * Get the status of a specific sandbox.
   */
  getStatus(sandboxId: string): PooledSandbox | undefined {
    return this.pool.get(sandboxId);
  }

  /**
   * Get pool statistics.
   */
  getStats(): PoolStats {
    const byStatus: Record<string, number> = {};
    let active = 0;
    let idle = 0;

    for (const [, sandbox] of this.pool) {
      const status = sandbox.info.status;
      byStatus[status] = (byStatus[status] ?? 0) + 1;

      if (sandbox.sessionId === null) {
        idle++;
      } else {
        active++;
      }
    }

    return {
      total: this.pool.size,
      active,
      idle,
      warmTarget: this.warmPoolSize,
      maxCapacity: this.maxPoolSize,
      byStatus,
    };
  }

  /**
   * Shut down the pool, destroying all sandboxes.
   */
  async shutdown(): Promise<void> {
    logger.info("Shutting down sandbox pool");

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    const destroyPromises: Promise<void>[] = [];
    for (const [sandboxId, sandbox] of this.pool) {
      if (sandbox.idleTimer) {
        clearTimeout(sandbox.idleTimer);
      }
      destroyPromises.push(this.containerManager.destroy(sandboxId));
    }

    await Promise.allSettled(destroyPromises);
    this.pool.clear();

    logger.info("Sandbox pool shut down");
  }

  // ---- Private helpers ----

  private markAcquired(
    sandbox: PooledSandbox,
    projectId: string,
    sessionId: string | null
  ): ContainerInfo {
    // Clear idle timer
    if (sandbox.idleTimer) {
      clearTimeout(sandbox.idleTimer);
      sandbox.idleTimer = null;
    }

    sandbox.projectId = projectId;
    sandbox.sessionId = sessionId;
    sandbox.acquiredAt = new Date();
    sandbox.lastUsedAt = new Date();
    sandbox.info.projectId = projectId;
    sandbox.info.sessionId = sessionId;
    sandbox.info.status = "busy";

    logger.info(
      { sandboxId: sandbox.info.id, projectId },
      "Sandbox acquired from pool"
    );

    // Replenish warm pool asynchronously
    this.replenishPool().catch(() => {
      /* fire-and-forget */
    });

    return sandbox.info;
  }

  private async addWarmSandbox(): Promise<void> {
    try {
      const info = await this.containerManager.create({
        cpuLimit: 0.5,
        memoryLimitMb: 512,
      });
      const pooled: PooledSandbox = {
        info,
        projectId: null,
        sessionId: null,
        acquiredAt: null,
        lastUsedAt: new Date(),
        idleTimer: null,
      };
      this.pool.set(info.id, pooled);
      logger.debug({ sandboxId: info.id }, "Warm sandbox added to pool");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn({ error: msg }, "Failed to add warm sandbox to pool");
    }
  }

  private async replenishPool(): Promise<void> {
    const idleCount = this.getIdleCount();
    const deficit = this.warmPoolSize - idleCount;
    if (deficit <= 0 || this.pool.size >= this.maxPoolSize) {
      return;
    }

    const toCreate = Math.min(deficit, this.maxPoolSize - this.pool.size);
    const promises: Promise<void>[] = [];
    for (let i = 0; i < toCreate; i++) {
      promises.push(this.addWarmSandbox());
    }
    await Promise.allSettled(promises);
  }

  private async evictSandbox(sandboxId: string): Promise<void> {
    const sandbox = this.pool.get(sandboxId);
    if (!sandbox || sandbox.sessionId) {
      return; // Don't evict active sandboxes
    }

    logger.info({ sandboxId }, "Evicting idle sandbox (TTL expired)");
    this.pool.delete(sandboxId);
    await this.containerManager.destroy(sandboxId);

    // Replenish if needed
    this.replenishPool().catch(() => {
      /* fire-and-forget */
    });
  }

  private async evictExcess(): Promise<void> {
    const idleSandboxes = Array.from(this.pool.entries())
      .filter(([, s]) => !s.sessionId && s.info.status === "ready")
      .sort(([, a], [, b]) => a.lastUsedAt.getTime() - b.lastUsedAt.getTime());

    const excess = idleSandboxes.length - this.warmPoolSize;
    if (excess <= 0) {
      return;
    }

    // Evict oldest idle sandboxes
    for (let i = 0; i < excess; i++) {
      const [sandboxId, sandbox] = idleSandboxes[
        i
      ] as (typeof idleSandboxes)[0];
      if (sandbox.idleTimer) {
        clearTimeout(sandbox.idleTimer);
      }
      this.pool.delete(sandboxId);
      await this.containerManager.destroy(sandboxId).catch(() => {
        /* fire-and-forget */
      });
      logger.info({ sandboxId }, "Excess idle sandbox evicted");
    }
  }

  private async cleanupIdleSandboxes(): Promise<void> {
    const now = Date.now();

    for (const [sandboxId, sandbox] of this.pool) {
      // Clean up sandboxes that have been idle too long
      if (!sandbox.sessionId && sandbox.info.status === "ready") {
        const idleMs = now - sandbox.lastUsedAt.getTime();
        if (idleMs > this.idleTtlMs) {
          await this.evictSandbox(sandboxId);
        }
      }

      // Clean up sandboxes stuck in non-ready states for too long
      if (
        sandbox.info.status === "creating" ||
        sandbox.info.status === "stopping"
      ) {
        const stuckMs = now - sandbox.lastUsedAt.getTime();
        if (stuckMs > 5 * 60 * 1000) {
          // 5 minutes
          logger.warn(
            { sandboxId, status: sandbox.info.status },
            "Cleaning up stuck sandbox"
          );
          this.pool.delete(sandboxId);
          await this.containerManager.destroy(sandboxId).catch(() => {
            /* fire-and-forget */
          });
        }
      }
    }
  }

  private getIdleCount(): number {
    return Array.from(this.pool.values()).filter(
      (s) => !s.sessionId && s.info.status === "ready"
    ).length;
  }
}
