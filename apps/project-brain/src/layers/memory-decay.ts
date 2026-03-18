import { createLogger } from "@prometheus/logger";

const logger = createLogger("project-brain:memory-decay");

const DAY_MS = 86_400_000;

export interface DecayableMemory {
  accessCount: number;
  createdAt: Date;
  id: string;
  lastAccessedAt: Date;
  relevance: number;
  successCount: number;
}

export interface DecayConfig {
  /** Boost per access (default: 0.1) */
  accessBoost: number;
  /** Minimum relevance before archival (default: 0.1) */
  archiveThreshold: number;
  /** Daily decay factor (default: 0.95, half-life ~14 days) */
  dailyDecay: number;
  /** Maximum memories per project (default: 500) */
  maxPerProject: number;
  /** Boost per successful outcome (default: 0.2) */
  successBoost: number;
}

const DEFAULT_CONFIG: DecayConfig = {
  dailyDecay: 0.95,
  accessBoost: 0.1,
  successBoost: 0.2,
  archiveThreshold: 0.1,
  maxPerProject: 500,
};

/**
 * MemoryDecay applies time-based decay to memory relevance scores.
 * Accessed and successful memories maintain high relevance.
 * Stale memories decay and are eventually archived.
 */
export class MemoryDecay {
  private readonly config: DecayConfig;

  constructor(config: Partial<DecayConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Calculate current relevance score for a memory.
   */
  calculateRelevance(memory: DecayableMemory): number {
    const now = Date.now();
    const ageMs = now - memory.createdAt.getTime();
    const ageDays = ageMs / DAY_MS;

    // Base decay: exponential with daily factor
    const decayedBase = memory.relevance * this.config.dailyDecay ** ageDays;

    // Access boost: recent accesses counteract decay
    const timeSinceAccess = now - memory.lastAccessedAt.getTime();
    const accessRecency = Math.max(0, 1 - timeSinceAccess / (7 * DAY_MS)); // 1.0 if accessed today, 0 if 7+ days ago
    const accessBoost =
      accessRecency *
      this.config.accessBoost *
      Math.min(memory.accessCount, 10);

    // Success boost
    const successBoost = memory.successCount * this.config.successBoost * 0.5; // Diminishing returns

    const final = Math.min(
      1,
      Math.max(0, decayedBase + accessBoost + successBoost)
    );
    return final;
  }

  /**
   * Apply boost when a memory is accessed.
   */
  onAccess(memory: DecayableMemory): DecayableMemory {
    return {
      ...memory,
      accessCount: memory.accessCount + 1,
      lastAccessedAt: new Date(),
      relevance: Math.min(1, memory.relevance + this.config.accessBoost),
    };
  }

  /**
   * Apply boost when a memory leads to a successful outcome.
   */
  onSuccess(memory: DecayableMemory): DecayableMemory {
    return {
      ...memory,
      successCount: memory.successCount + 1,
      relevance: Math.min(1, memory.relevance + this.config.successBoost),
    };
  }

  /**
   * Run decay cleanup: archive low-relevance, cap total count.
   */
  cleanup(memories: DecayableMemory[]): {
    kept: DecayableMemory[];
    archived: DecayableMemory[];
  } {
    // Calculate current relevance for all
    const scored = memories.map((m) => ({
      memory: m,
      currentRelevance: this.calculateRelevance(m),
    }));

    // Archive below threshold
    const active = scored.filter(
      (s) => s.currentRelevance >= this.config.archiveThreshold
    );
    const archived = scored.filter(
      (s) => s.currentRelevance < this.config.archiveThreshold
    );

    // Cap at max per project
    const sorted = active.sort(
      (a, b) => b.currentRelevance - a.currentRelevance
    );
    const kept = sorted.slice(0, this.config.maxPerProject).map((s) => ({
      ...s.memory,
      relevance: s.currentRelevance,
    }));
    const overflow = sorted
      .slice(this.config.maxPerProject)
      .map((s) => s.memory);

    logger.info(
      {
        total: memories.length,
        kept: kept.length,
        archived: archived.length + overflow.length,
        belowThreshold: archived.length,
        overflow: overflow.length,
      },
      "Memory decay cleanup completed"
    );

    return {
      kept,
      archived: [...archived.map((s) => s.memory), ...overflow],
    };
  }
}
