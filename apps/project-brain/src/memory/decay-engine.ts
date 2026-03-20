/**
 * Phase 4.7: Memory Decay Engine.
 *
 * Applies exponential decay to memory importance based on time since last access.
 * Formula: importance * e^(-effectiveLambda * hours)
 * where effectiveLambda is reduced for frequently accessed memories.
 *
 * Memories below 0.1 importance are archived.
 * Designed to run as a nightly BullMQ job.
 */
import { agentMemories, db } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { and, eq, lt } from "drizzle-orm";

const logger = createLogger("project-brain:decay-engine");

const HOUR_MS = 3_600_000;

/** Base decay rate constant (per hour). */
const DEFAULT_LAMBDA = 0.001;

/** Importance threshold below which memories are archived. */
const ARCHIVE_THRESHOLD = 0.1;

/** Minimum age in days before a memory can be archived. */
const MIN_ARCHIVE_AGE_DAYS = 90;

export interface DecayableMemoryRecord {
  accessCount: number;
  createdAt: Date;
  id: string;
  importance: number;
  lastAccessedAt: Date;
  projectId: string;
}

export interface ArchivedMemory {
  archivedAt: Date;
  finalImportance: number;
  id: string;
  projectId: string;
  reason: string;
}

/**
 * MemoryDecayEngine applies exponential time-decay to memory importance scores
 * and archives stale, low-value memories.
 *
 * Frequently accessed memories resist decay through a reduced effective lambda.
 */
export class MemoryDecayEngine {
  private readonly lambda: number;
  private readonly archiveThreshold: number;
  private readonly minArchiveAgeDays: number;
  private readonly archived: ArchivedMemory[] = [];
  private readonly accessLog: Map<
    string,
    { count: number; lastAccessed: Date }
  > = new Map();

  constructor(options?: {
    archiveThreshold?: number;
    lambda?: number;
    minArchiveAgeDays?: number;
  }) {
    this.lambda = options?.lambda ?? DEFAULT_LAMBDA;
    this.archiveThreshold = options?.archiveThreshold ?? ARCHIVE_THRESHOLD;
    this.minArchiveAgeDays = options?.minArchiveAgeDays ?? MIN_ARCHIVE_AGE_DAYS;
  }

  /**
   * Compute the effective lambda for a memory.
   * Frequent access reduces the decay rate: effectiveLambda = lambda / (1 + 0.1 * accessCount)
   */
  private getEffectiveLambda(accessCount: number): number {
    return this.lambda / (1 + 0.1 * accessCount);
  }

  /**
   * Calculate the decayed importance for a memory.
   * importance * e^(-effectiveLambda * hours)
   */
  calculateDecay(memory: DecayableMemoryRecord): number {
    const now = Date.now();
    const hoursSinceAccess = (now - memory.lastAccessedAt.getTime()) / HOUR_MS;
    const effectiveLambda = this.getEffectiveLambda(memory.accessCount);

    return memory.importance * Math.exp(-effectiveLambda * hoursSinceAccess);
  }

  /**
   * Record an access to a memory, resetting its decay timer and incrementing access count.
   * Returns the updated access count.
   */
  recordAccess(memoryId: string): { accessCount: number; lastAccessed: Date } {
    const existing = this.accessLog.get(memoryId);
    const now = new Date();
    const updated = {
      count: (existing?.count ?? 0) + 1,
      lastAccessed: now,
    };
    this.accessLog.set(memoryId, updated);

    logger.debug(
      { memoryId, accessCount: updated.count },
      "Memory access recorded — decay timer reset"
    );

    return { accessCount: updated.count, lastAccessed: updated.lastAccessed };
  }

  /**
   * Get the access info for a memory, if tracked.
   */
  getAccessInfo(
    memoryId: string
  ): { count: number; lastAccessed: Date } | undefined {
    return this.accessLog.get(memoryId);
  }

  /**
   * Check if a memory should be archived (importance below threshold).
   */
  shouldArchive(memory: DecayableMemoryRecord): boolean {
    const decayedImportance = this.calculateDecay(memory);
    return decayedImportance < this.archiveThreshold;
  }

  /**
   * Archive a single memory. Adds it to the archive log.
   */
  private archiveMemory(
    memory: DecayableMemoryRecord,
    decayedImportance: number
  ): ArchivedMemory {
    const archived: ArchivedMemory = {
      id: memory.id,
      projectId: memory.projectId,
      finalImportance: decayedImportance,
      archivedAt: new Date(),
      reason: `Importance decayed to ${decayedImportance.toFixed(4)} (below ${this.archiveThreshold} threshold)`,
    };
    this.archived.push(archived);
    return archived;
  }

  /**
   * Get all archived memory records.
   */
  getArchivedMemories(): ArchivedMemory[] {
    return [...this.archived];
  }

  /**
   * Prune stale memories for a project.
   * Archives memories older than minArchiveAgeDays with decay score below threshold.
   * Returns the number of archived memories.
   */
  async pruneStale(projectId: string): Promise<number> {
    const cutoffDate = new Date(
      Date.now() - this.minArchiveAgeDays * 24 * HOUR_MS
    );

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

    let archivedCount = 0;

    for (const mem of oldMemories) {
      const accessInfo = this.accessLog.get(mem.id);
      const record: DecayableMemoryRecord = {
        id: mem.id,
        projectId: mem.projectId,
        createdAt: mem.createdAt,
        lastAccessedAt: accessInfo?.lastAccessed ?? mem.createdAt,
        importance: 0.5,
        accessCount: accessInfo?.count ?? 0,
      };

      const decayScore = this.calculateDecay(record);

      if (decayScore < this.archiveThreshold) {
        this.archiveMemory(record, decayScore);
        await db.delete(agentMemories).where(eq(agentMemories.id, mem.id));
        archivedCount++;
      }
    }

    if (archivedCount > 0) {
      logger.info(
        { projectId, archived: archivedCount, total: oldMemories.length },
        "Stale memories archived by decay engine"
      );
    } else {
      logger.debug(
        { projectId, total: oldMemories.length },
        "No stale memories to archive"
      );
    }

    return archivedCount;
  }

  /**
   * Batch calculate decay scores for multiple memories.
   * Useful for sorting/ranking by decayed relevance.
   */
  batchCalculateDecay(
    memories: DecayableMemoryRecord[]
  ): Array<{ decayScore: number; id: string }> {
    return memories
      .map((mem) => ({
        id: mem.id,
        decayScore: this.calculateDecay(mem),
      }))
      .sort((a, b) => b.decayScore - a.decayScore);
  }
}
