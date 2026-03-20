/**
 * Template Pool Manager.
 *
 * Manages pre-created sandbox pools organized by language runtime template.
 * Provides fast-path acquisition from warm pools and return-to-pool for reuse.
 */
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";

const logger = createLogger("sandbox-manager:template-pools");

/** Supported runtime templates */
export type PoolTemplateType =
  | "node22"
  | "python312"
  | "rust"
  | "golang"
  | "java"
  | "multi";

/** Template-specific resource defaults */
const TEMPLATE_DEFAULTS: Record<
  PoolTemplateType,
  { cpuLimit: number; memoryMb: number; diskMb: number }
> = {
  node22: { cpuLimit: 1, memoryMb: 1024, diskMb: 2048 },
  python312: { cpuLimit: 1, memoryMb: 1024, diskMb: 2048 },
  rust: { cpuLimit: 2, memoryMb: 2048, diskMb: 4096 },
  golang: { cpuLimit: 1, memoryMb: 1024, diskMb: 2048 },
  java: { cpuLimit: 2, memoryMb: 2048, diskMb: 4096 },
  multi: { cpuLimit: 2, memoryMb: 2048, diskMb: 8192 },
};

/** A warm sandbox instance in the pool */
interface WarmInstance {
  createdAt: Date;
  id: string;
  lastUsedAt: Date;
  status: "warm" | "acquired" | "returned";
  template: PoolTemplateType;
}

/** Factory function for creating actual sandbox instances */
export type SandboxFactory = (template: PoolTemplateType) => Promise<string>;

export class TemplatePoolManager {
  private readonly pools = new Map<PoolTemplateType, WarmInstance[]>();
  private readonly acquiredInstances = new Map<string, WarmInstance>();

  constructor() {
    // Initialize empty pools for each template
    for (const template of Object.keys(
      TEMPLATE_DEFAULTS
    ) as PoolTemplateType[]) {
      this.pools.set(template, []);
    }
  }

  /**
   * Pre-create warm sandbox instances for a template.
   * Calls the factory function for each instance to be created.
   */
  async warmPool(
    template: PoolTemplateType,
    count: number,
    factory?: SandboxFactory
  ): Promise<number> {
    const pool = this.pools.get(template);
    if (!pool) {
      this.pools.set(template, []);
    }

    logger.info({ template, count }, "Warming pool");

    let created = 0;
    for (let i = 0; i < count; i++) {
      try {
        const id = factory ? await factory(template) : generateId("sbx");
        const instance: WarmInstance = {
          id,
          template,
          createdAt: new Date(),
          lastUsedAt: new Date(),
          status: "warm",
        };

        const currentPool = this.pools.get(template) ?? [];
        currentPool.push(instance);
        this.pools.set(template, currentPool);
        created++;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.warn({ template, error: msg }, "Failed to create warm instance");
        break;
      }
    }

    logger.info(
      { template, created, totalWarm: (this.pools.get(template) ?? []).length },
      "Pool warmed"
    );

    return created;
  }

  /**
   * Get the number of warm (available) instances for a template.
   */
  getWarmCount(template: PoolTemplateType): number {
    const pool = this.pools.get(template) ?? [];
    return pool.filter((i) => i.status === "warm").length;
  }

  /**
   * Request a warm instance from the pool (fast path).
   * Returns the sandbox ID or undefined if the pool is empty.
   */
  requestFromPool(template: PoolTemplateType): string | undefined {
    const pool = this.pools.get(template) ?? [];
    const index = pool.findIndex((i) => i.status === "warm");

    if (index === -1) {
      logger.debug({ template }, "No warm instances available");
      return undefined;
    }

    const instance = pool[index];
    if (!instance) {
      return undefined;
    }

    // Remove from warm pool
    pool.splice(index, 1);
    this.pools.set(template, pool);

    // Track as acquired
    instance.status = "acquired";
    instance.lastUsedAt = new Date();
    this.acquiredInstances.set(instance.id, instance);

    logger.info(
      { template, sandboxId: instance.id, remainingWarm: pool.length },
      "Instance acquired from pool"
    );

    return instance.id;
  }

  /**
   * Return a sandbox back to the warm pool for reuse.
   */
  returnToPool(sandboxId: string, template: PoolTemplateType): void {
    const acquired = this.acquiredInstances.get(sandboxId);

    const instance: WarmInstance = acquired ?? {
      id: sandboxId,
      template,
      createdAt: new Date(),
      lastUsedAt: new Date(),
      status: "warm",
    };

    instance.status = "warm";
    instance.lastUsedAt = new Date();

    this.acquiredInstances.delete(sandboxId);

    const pool = this.pools.get(template) ?? [];
    pool.push(instance);
    this.pools.set(template, pool);

    logger.info(
      { template, sandboxId, poolSize: pool.length },
      "Instance returned to pool"
    );
  }

  /**
   * Get pool statistics for all templates.
   */
  getAllStats(): Record<
    PoolTemplateType,
    {
      warm: number;
      acquired: number;
      defaults: { cpuLimit: number; memoryMb: number; diskMb: number };
    }
  > {
    const stats = {} as Record<
      PoolTemplateType,
      {
        warm: number;
        acquired: number;
        defaults: { cpuLimit: number; memoryMb: number; diskMb: number };
      }
    >;

    for (const template of Object.keys(
      TEMPLATE_DEFAULTS
    ) as PoolTemplateType[]) {
      const pool = this.pools.get(template) ?? [];
      const warmCount = pool.filter((i) => i.status === "warm").length;
      let acquiredCount = 0;
      for (const inst of this.acquiredInstances.values()) {
        if (inst.template === template) {
          acquiredCount++;
        }
      }

      stats[template] = {
        warm: warmCount,
        acquired: acquiredCount,
        defaults: TEMPLATE_DEFAULTS[template],
      };
    }

    return stats;
  }

  /**
   * Get template resource defaults.
   */
  getTemplateDefaults(template: PoolTemplateType): {
    cpuLimit: number;
    memoryMb: number;
    diskMb: number;
  } {
    return TEMPLATE_DEFAULTS[template];
  }
}
