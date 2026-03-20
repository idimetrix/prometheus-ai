/**
 * Phase 7.6: Conversation Tracker.
 *
 * Tracks what context items the agent already has in the current session.
 * Deprioritizes known context on re-assembly to avoid redundancy
 * and maximize new information density.
 */
import { createLogger } from "@prometheus/logger";

const logger = createLogger("project-brain:conversation-tracker");

export interface ContextItem {
  /** Content hash or ID for deduplication */
  id: string;
  /** When this context was provided */
  providedAt: Date;
  /** Source layer (semantic, episodic, procedural, etc.) */
  source: string;
  /** Summary of the content for logging */
  summary?: string;
}

/**
 * ConversationTracker records which context items have been provided
 * to the agent in the current session, enabling smart deduplication
 * of context on re-assembly.
 */
export class ConversationTracker {
  private readonly knownContext: Map<string, ContextItem> = new Map();
  private readonly sessionId: string;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  /**
   * Record that context items have been provided to the agent.
   */
  recordContextProvided(items: ContextItem[]): void {
    for (const item of items) {
      this.knownContext.set(item.id, {
        ...item,
        providedAt: new Date(),
      });
    }

    logger.debug(
      {
        sessionId: this.sessionId,
        itemsRecorded: items.length,
        totalKnown: this.knownContext.size,
      },
      "Context items recorded as provided"
    );
  }

  /**
   * Get all known context items for the current session.
   */
  getKnownContext(): ContextItem[] {
    return Array.from(this.knownContext.values());
  }

  /**
   * Determine whether a context item should be included in the next assembly.
   * Returns false if the item was recently provided (within the freshness window).
   */
  shouldInclude(item: { id: string; source?: string }): boolean {
    const known = this.knownContext.get(item.id);
    if (!known) {
      return true;
    }

    // Items older than 10 minutes may need re-inclusion
    const FRESHNESS_WINDOW_MS = 10 * 60 * 1000;
    const age = Date.now() - known.providedAt.getTime();

    if (age > FRESHNESS_WINDOW_MS) {
      return true;
    }

    return false;
  }

  /**
   * Filter a list of candidate context items, removing those already known.
   * Returns items ordered by novelty (unknown items first).
   */
  filterForNovelty<T extends { id: string }>(candidates: T[]): T[] {
    const unknown: T[] = [];
    const stale: T[] = [];

    for (const candidate of candidates) {
      if (this.shouldInclude(candidate)) {
        if (this.knownContext.has(candidate.id)) {
          stale.push(candidate);
        } else {
          unknown.push(candidate);
        }
      }
    }

    // Unknown first, then stale (re-included due to age)
    return [...unknown, ...stale];
  }

  /**
   * Clear all tracked context for the session.
   */
  reset(): void {
    this.knownContext.clear();
    logger.debug({ sessionId: this.sessionId }, "Conversation tracker reset");
  }

  /**
   * Get statistics about tracked context.
   */
  getStats(): {
    totalItems: number;
    bySource: Record<string, number>;
    oldestItem: Date | null;
    newestItem: Date | null;
  } {
    const bySource: Record<string, number> = {};
    let oldestItem: Date | null = null;
    let newestItem: Date | null = null;

    for (const item of this.knownContext.values()) {
      bySource[item.source] = (bySource[item.source] ?? 0) + 1;

      if (!oldestItem || item.providedAt < oldestItem) {
        oldestItem = item.providedAt;
      }
      if (!newestItem || item.providedAt > newestItem) {
        newestItem = item.providedAt;
      }
    }

    return {
      totalItems: this.knownContext.size,
      bySource,
      oldestItem,
      newestItem,
    };
  }
}
