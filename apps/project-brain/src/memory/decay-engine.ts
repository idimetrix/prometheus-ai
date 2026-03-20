/**
 * Phase 7.5: Memory Decay Engine.
 *
 * Applies exponential decay to memory scores based on time since last access.
 * Formula: score = usefulness * Math.exp(-lambda * daysSinceAccess)
 * where lambda = 0.023 (half-life ~30 days).
 *
 * Memories below 0.05 after 90 days are pruned.
 * Designed to run as a nightly BullMQ job.
 */
import { agentMemories, db } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { and, eq, lt } from "drizzle-orm";

const logger = createLogger("project-brain:decay-engine");

const DAY_MS = 86_400_000;

/** Decay rate constant. With lambda=0.023, half-life is ~30 days. */
const LAMBDA = 0.023;

/** Minimum score threshold before pruning. */
const PRUNE_THRESHOLD = 0.05;

/** Minimum age in days before a memory can be pruned. */
const MIN_PRUNE_AGE_DAYS = 90;

export interface DecayableMemoryRecord {
  createdAt: Date;
  id: string;
  lastAccessedAt: Date;
  projectId: string;
  usefulness: number;
}

/**
 * MemoryDecayEngine applies exponential time-decay to memory scores
 * and prunes stale, low-value memories.
 */
export class MemoryDecayEngine {
  private readonly lambda: number;
  private readonly pruneThreshold: number;
  private readonly minPruneAgeDays: number;

  constructor(options?: {
    lambda?: number;
    minPruneAgeDays?: number;
    pruneThreshold?: number;
  }) {
    this.lambda = options?.lambda ?? LAMBDA;
    this.pruneThreshold = options?.pruneThreshold ?? PRUNE_THRESHOLD;
    this.minPruneAgeDays = options?.minPruneAgeDays ?? MIN_PRUNE_AGE_DAYS;
  }

  /**
   * Calculate the decayed score for a memory.
   * score = usefulness * exp(-lambda * daysSinceAccess)
   */
  calculateDecay(memory: DecayableMemoryRecord): number {
    const now = Date.now();
    const daysSinceAccess = (now - memory.lastAccessedAt.getTime()) / DAY_MS;

    return memory.usefulness * Math.exp(-this.lambda * daysSinceAccess);
  }

  /**
   * Prune stale memories for a project.
   * Removes memories older than minPruneAgeDays with decay score below threshold.
   * Returns the number of pruned memories.
   */
  async pruneStale(projectId: string): Promise<number> {
    const cutoffDate = new Date(Date.now() - this.minPruneAgeDays * DAY_MS);

    // Fetch old memories
    const oldMemories = await db
      .select({
        id: agentMemories.id,
        projectId: agentMemories.projectId,
        content: agentMemories.content,
        createdAt: agentMemories.createdAt,
      })
      .from(agentMemories)
      .where(
        and(
          eq(agentMemories.projectId, projectId),
          lt(agentMemories.createdAt, cutoffDate)
        )
      );

    let pruned = 0;

    for (const mem of oldMemories) {
      const record: DecayableMemoryRecord = {
        id: mem.id,
        projectId: mem.projectId,
        createdAt: mem.createdAt,
        lastAccessedAt: mem.createdAt, // Use createdAt as proxy if no lastAccessedAt
        usefulness: 0.5, // Default usefulness
      };

      const decayScore = this.calculateDecay(record);

      if (decayScore < this.pruneThreshold) {
        await db.delete(agentMemories).where(eq(agentMemories.id, mem.id));
        pruned++;
      }
    }

    if (pruned > 0) {
      logger.info(
        { projectId, pruned, total: oldMemories.length },
        "Stale memories pruned by decay engine"
      );
    } else {
      logger.debug(
        { projectId, total: oldMemories.length },
        "No stale memories to prune"
      );
    }

    return pruned;
  }

  /**
   * Batch calculate decay scores for multiple memories.
   * Useful for sorting/ranking by decayed relevance.
   */
  batchCalculateDecay(
    memories: DecayableMemoryRecord[]
  ): Array<{ id: string; decayScore: number }> {
    return memories
      .map((mem) => ({
        id: mem.id,
        decayScore: this.calculateDecay(mem),
      }))
      .sort((a, b) => b.decayScore - a.decayScore);
  }
}
