/**
 * Phase 7.2: Tiered Memory Manager.
 *
 * Three tiers:
 *  - hot:  frequently accessed, cached in Redis for instant retrieval
 *  - warm: recently accessed, stored in DB
 *  - cold: archived, stored in DB with lower priority
 *
 * Daily promotion/demotion based on access patterns.
 * Hot memories are pre-loaded into Redis on session start.
 */
import { agentMemories, db } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { and, desc, eq, gt, lt } from "drizzle-orm";

const logger = createLogger("project-brain:memory-tier-manager");

export type MemoryTier = "hot" | "warm" | "cold";

export interface TieredMemory {
  content: string;
  createdAt: Date;
  id: string;
  lastAccessedAt: Date;
  projectId: string;
  tier: MemoryTier;
}

interface RedisLike {
  del(key: string): Promise<number>;
  get(key: string): Promise<string | null>;
  keys(pattern: string): Promise<string[]>;
  set(key: string, value: string, options?: { EX?: number }): Promise<unknown>;
}

const HOT_ACCESS_THRESHOLD = 5;
const WARM_DAYS_THRESHOLD = 7;
const COLD_DAYS_THRESHOLD = 30;
const HOT_REDIS_TTL_SECONDS = 86_400; // 24 hours
const REDIS_PREFIX = "mem:tier:";

/**
 * MemoryTierManager manages hot/warm/cold memory tiers
 * with Redis caching for hot memories and DB-backed warm/cold storage.
 */
export class MemoryTierManager {
  private readonly redis: RedisLike | null;

  constructor(redis?: RedisLike) {
    this.redis = redis ?? null;
  }

  /**
   * Promote a memory to a higher tier.
   */
  async promote(memoryId: string, tier: MemoryTier): Promise<void> {
    const rows = await db
      .select({
        id: agentMemories.id,
        content: agentMemories.content,
        projectId: agentMemories.projectId,
      })
      .from(agentMemories)
      .where(eq(agentMemories.id, memoryId))
      .limit(1);

    if (rows.length === 0) {
      logger.warn({ memoryId }, "Memory not found for promotion");
      return;
    }

    const memory = rows[0] as (typeof rows)[0];

    if (tier === "hot" && this.redis) {
      const key = `${REDIS_PREFIX}${memory.projectId}:${memoryId}`;
      await this.redis.set(key, memory.content, {
        EX: HOT_REDIS_TTL_SECONDS,
      });
      logger.debug({ memoryId, tier }, "Memory promoted to hot tier (Redis)");
    }

    logger.info({ memoryId, tier }, "Memory promoted");
  }

  /**
   * Demote a memory to a lower tier.
   * Removes from Redis if demoted from hot.
   */
  async demote(memoryId: string): Promise<void> {
    if (this.redis) {
      const keys = await this.redis.keys(`${REDIS_PREFIX}*:${memoryId}`);
      for (const key of keys) {
        await this.redis.del(key);
      }
    }

    logger.info({ memoryId }, "Memory demoted (removed from hot cache)");
  }

  /**
   * Retrieve memories for a project filtered by tier.
   */
  async getTieredMemories(
    projectId: string,
    tier: MemoryTier
  ): Promise<TieredMemory[]> {
    const now = new Date();

    if (tier === "hot" && this.redis) {
      return this.getHotMemories(projectId);
    }

    const warmCutoff = new Date(
      now.getTime() - WARM_DAYS_THRESHOLD * 86_400_000
    );
    const coldCutoff = new Date(
      now.getTime() - COLD_DAYS_THRESHOLD * 86_400_000
    );

    const condition =
      tier === "warm"
        ? gt(agentMemories.createdAt, warmCutoff)
        : lt(agentMemories.createdAt, coldCutoff);

    const rows = await db
      .select({
        id: agentMemories.id,
        content: agentMemories.content,
        projectId: agentMemories.projectId,
        createdAt: agentMemories.createdAt,
      })
      .from(agentMemories)
      .where(and(eq(agentMemories.projectId, projectId), condition))
      .orderBy(desc(agentMemories.createdAt))
      .limit(100);

    return rows.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      content: r.content,
      tier,
      createdAt: r.createdAt,
      lastAccessedAt: r.createdAt,
    }));
  }

  /**
   * Pre-load hot memories into Redis for a session.
   * Called on session start to reduce cold-start latency.
   */
  async preloadHotMemories(projectId: string): Promise<number> {
    if (!this.redis) {
      logger.debug("Redis not available, skipping hot memory preload");
      return 0;
    }

    // Fetch frequently accessed memories
    const rows = await db
      .select({
        id: agentMemories.id,
        content: agentMemories.content,
        projectId: agentMemories.projectId,
      })
      .from(agentMemories)
      .where(eq(agentMemories.projectId, projectId))
      .orderBy(desc(agentMemories.createdAt))
      .limit(50);

    let loaded = 0;
    for (const row of rows) {
      const key = `${REDIS_PREFIX}${projectId}:${row.id}`;
      await this.redis.set(key, row.content, { EX: HOT_REDIS_TTL_SECONDS });
      loaded++;
    }

    logger.info({ projectId, loaded }, "Hot memories pre-loaded into Redis");

    return loaded;
  }

  /**
   * Run daily tier promotion/demotion based on access patterns.
   * Designed to be called as a BullMQ scheduled job.
   */
  async runDailyTierManagement(projectId: string): Promise<{
    demoted: number;
    promoted: number;
  }> {
    let promoted = 0;
    let demoted = 0;

    const now = new Date();
    const warmCutoff = new Date(
      now.getTime() - WARM_DAYS_THRESHOLD * 86_400_000
    );

    // Find warm memories that should be promoted to hot
    // (based on recent creation as a proxy for access frequency)
    const recentMemories = await db
      .select({
        id: agentMemories.id,
        projectId: agentMemories.projectId,
        content: agentMemories.content,
      })
      .from(agentMemories)
      .where(
        and(
          eq(agentMemories.projectId, projectId),
          gt(agentMemories.createdAt, warmCutoff)
        )
      )
      .limit(HOT_ACCESS_THRESHOLD * 10);

    for (const mem of recentMemories.slice(0, HOT_ACCESS_THRESHOLD)) {
      await this.promote(mem.id, "hot");
      promoted++;
    }

    // Demote old hot memories from Redis
    if (this.redis) {
      const hotKeys = await this.redis.keys(`${REDIS_PREFIX}${projectId}:*`);
      const maxHot = HOT_ACCESS_THRESHOLD * 5;
      if (hotKeys.length > maxHot) {
        const toDemote = hotKeys.slice(maxHot);
        for (const key of toDemote) {
          await this.redis.del(key);
          demoted++;
        }
      }
    }

    logger.info(
      { projectId, promoted, demoted },
      "Daily tier management completed"
    );

    return { promoted, demoted };
  }

  private async getHotMemories(projectId: string): Promise<TieredMemory[]> {
    if (!this.redis) {
      return [];
    }

    const keys = await this.redis.keys(`${REDIS_PREFIX}${projectId}:*`);
    const memories: TieredMemory[] = [];

    for (const key of keys) {
      const content = await this.redis.get(key);
      if (!content) {
        continue;
      }

      const memoryId = key.split(":").pop() ?? "";
      memories.push({
        id: memoryId,
        projectId,
        content,
        tier: "hot",
        createdAt: new Date(),
        lastAccessedAt: new Date(),
      });
    }

    return memories;
  }
}
