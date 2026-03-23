import { createLogger } from "@prometheus/logger";
import type { WorkflowStatus } from "@prometheus/types";

const logger = createLogger("orchestrator:workflow:status-aggregator");

/** Cache entry for workflow status */
interface CachedStatus {
  cachedAt: number;
  data: WorkflowStatus[];
}

/** Cache TTL in milliseconds (5 seconds) */
const CACHE_TTL_MS = 5000;

/**
 * WorkflowStatusAggregator collects and caches the status of all
 * active workflows for an organization.
 *
 * Results are cached in Redis for 5 seconds to reduce database load.
 */
export class WorkflowStatusAggregator {
  private readonly cache = new Map<string, CachedStatus>();
  private readonly getRedis: () => Promise<{
    get: (key: string) => Promise<string | null>;
    setex: (key: string, ttl: number, value: string) => Promise<void>;
  }>;
  private readonly fetchWorkflows: (orgId: string) => Promise<WorkflowStatus[]>;

  constructor(opts: {
    getRedis?: () => Promise<{
      get: (key: string) => Promise<string | null>;
      setex: (key: string, ttl: number, value: string) => Promise<void>;
    }>;
    fetchWorkflows: (orgId: string) => Promise<WorkflowStatus[]>;
  }) {
    this.getRedis =
      opts.getRedis ??
      (() => {
        return Promise.reject(new Error("Redis not configured"));
      });
    this.fetchWorkflows = opts.fetchWorkflows;
  }

  /**
   * Get all active workflows for an organization.
   * Results are cached in Redis for 5 seconds.
   */
  async getActiveWorkflows(orgId: string): Promise<WorkflowStatus[]> {
    const cacheKey = `workflow:status:${orgId}`;

    // Check in-memory cache first
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      logger.debug({ orgId }, "Returning in-memory cached workflow status");
      return cached.data;
    }

    // Check Redis cache
    try {
      const redis = await this.getRedis();
      const redisData = await redis.get(cacheKey);
      if (redisData) {
        const parsed = JSON.parse(redisData) as WorkflowStatus[];
        this.cache.set(cacheKey, { data: parsed, cachedAt: Date.now() });
        logger.debug({ orgId }, "Returning Redis cached workflow status");
        return parsed;
      }
    } catch (error) {
      logger.warn(
        { error, orgId },
        "Failed to read Redis cache, falling back to database"
      );
    }

    // Fetch from database
    const workflows = await this.fetchWorkflows(orgId);

    // Cache in Redis
    try {
      const redis = await this.getRedis();
      await redis.setex(
        cacheKey,
        Math.ceil(CACHE_TTL_MS / 1000),
        JSON.stringify(workflows)
      );
    } catch (error) {
      logger.warn({ error, orgId }, "Failed to write Redis cache");
    }

    // Cache in memory
    this.cache.set(cacheKey, { data: workflows, cachedAt: Date.now() });

    logger.info(
      { orgId, workflowCount: workflows.length },
      "Fetched active workflows"
    );

    return workflows;
  }

  /**
   * Invalidate the cache for an organization.
   */
  invalidate(orgId: string): void {
    const cacheKey = `workflow:status:${orgId}`;
    this.cache.delete(cacheKey);
    logger.debug({ orgId }, "Cache invalidated");
  }
}
