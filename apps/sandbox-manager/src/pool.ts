import { createLogger } from "@prometheus/logger";
import { ContainerManager, type ContainerInfo } from "./container";

const logger = createLogger("sandbox-manager:pool");

interface PooledSandbox {
  info: ContainerInfo;
  sessionId: string | null;
  acquiredAt: Date | null;
  lastUsedAt: Date;
}

export class SandboxPool {
  private readonly containerManager: ContainerManager;
  private readonly pool = new Map<string, PooledSandbox>();
  private readonly warmPoolSize: number;
  private readonly maxPoolSize: number;

  constructor(containerManager: ContainerManager) {
    this.containerManager = containerManager;
    this.warmPoolSize = Number(process.env.WARM_POOL_SIZE ?? 5);
    this.maxPoolSize = Number(process.env.MAX_POOL_SIZE ?? 16);
  }

  async initialize(): Promise<void> {
    logger.info({ warmPoolSize: this.warmPoolSize }, "Initializing sandbox pool");
    const promises = [];
    for (let i = 0; i < this.warmPoolSize; i++) {
      promises.push(this.addToPool());
    }
    await Promise.allSettled(promises);
    logger.info({ poolSize: this.pool.size }, "Sandbox pool initialized");
  }

  async acquire(sessionId: string, projectId: string): Promise<ContainerInfo> {
    // Find an available sandbox from the warm pool
    for (const [id, sandbox] of this.pool) {
      if (!sandbox.sessionId && sandbox.info.status === "ready") {
        sandbox.sessionId = sessionId;
        sandbox.acquiredAt = new Date();
        sandbox.lastUsedAt = new Date();
        sandbox.info.sessionId = sessionId;
        sandbox.info.status = "busy";

        logger.info({ sandboxId: id, sessionId }, "Sandbox acquired from pool");

        // Replenish the warm pool asynchronously
        this.replenishPool().catch(() => {});

        return sandbox.info;
      }
    }

    // No warm sandbox available - create a new one if under max
    if (this.pool.size < this.maxPoolSize) {
      const info = await this.containerManager.createContainer();
      info.sessionId = sessionId;
      info.status = "busy";

      const pooled: PooledSandbox = {
        info,
        sessionId,
        acquiredAt: new Date(),
        lastUsedAt: new Date(),
      };
      this.pool.set(info.id, pooled);

      logger.info({ sandboxId: info.id, sessionId }, "New sandbox created for session");
      return info;
    }

    throw new Error("No sandboxes available and pool is at maximum capacity");
  }

  async release(sandboxId: string): Promise<void> {
    const sandbox = this.pool.get(sandboxId);
    if (!sandbox) return;

    sandbox.sessionId = null;
    sandbox.acquiredAt = null;
    sandbox.lastUsedAt = new Date();
    sandbox.info.sessionId = null;
    sandbox.info.status = "ready";

    logger.info({ sandboxId }, "Sandbox released back to pool");

    // If pool is over warm size, destroy excess
    const idleCount = Array.from(this.pool.values()).filter((s) => !s.sessionId).length;
    if (idleCount > this.warmPoolSize) {
      await this.containerManager.destroyContainer(sandboxId);
      this.pool.delete(sandboxId);
      logger.info({ sandboxId }, "Excess sandbox destroyed");
    }
  }

  getStatus(sandboxId: string): PooledSandbox | undefined {
    return this.pool.get(sandboxId);
  }

  getStats(): {
    total: number;
    active: number;
    idle: number;
    warmTarget: number;
    maxCapacity: number;
  } {
    const active = Array.from(this.pool.values()).filter((s) => s.sessionId !== null).length;
    return {
      total: this.pool.size,
      active,
      idle: this.pool.size - active,
      warmTarget: this.warmPoolSize,
      maxCapacity: this.maxPoolSize,
    };
  }

  private async addToPool(): Promise<void> {
    try {
      const info = await this.containerManager.createContainer({
        cpuLimit: 0.25,
        memoryLimitMb: 256,
      });
      this.pool.set(info.id, {
        info,
        sessionId: null,
        acquiredAt: null,
        lastUsedAt: new Date(),
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn({ error: msg }, "Failed to add warm sandbox to pool");
    }
  }

  private async replenishPool(): Promise<void> {
    const idleCount = Array.from(this.pool.values()).filter((s) => !s.sessionId).length;
    const deficit = this.warmPoolSize - idleCount;
    if (deficit > 0) {
      const promises = [];
      for (let i = 0; i < deficit; i++) {
        promises.push(this.addToPool());
      }
      await Promise.allSettled(promises);
    }
  }
}
