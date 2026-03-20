/**
 * Phase 4.11: Conversation Tracker.
 *
 * Tracks conversation topics through their lifecycle, manages open questions,
 * and provides context summaries for prompt assembly.
 *
 * Topic lifecycle: addTopic(new) → activateTopic(active) → resolveTopic(resolved)
 * Topics can be reopened via reopenTopic().
 */
import { createLogger } from "@prometheus/logger";

const logger = createLogger("project-brain:conversation-tracker");

export type TopicStatus = "new" | "active" | "resolved";

export interface Topic {
  activatedAt?: Date;
  createdAt: Date;
  id: string;
  resolvedAt?: Date;
  status: TopicStatus;
  title: string;
}

export interface OpenQuestion {
  answer?: string;
  askedAt: Date;
  id: string;
  question: string;
  resolvedAt?: Date;
  topicId?: string;
}

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

export interface ContextSummary {
  activeTopics: Topic[];
  openQuestions: OpenQuestion[];
  recentlyResolved: Topic[];
}

/**
 * ConversationTracker records which context items have been provided
 * to the agent in the current session, tracks topic lifecycle and
 * open questions, and provides context summaries for prompt assembly.
 */
export class ConversationTracker {
  private readonly knownContext: Map<string, ContextItem> = new Map();
  private readonly topics: Map<string, Topic> = new Map();
  private readonly questions: Map<string, OpenQuestion> = new Map();
  private readonly sessionId: string;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  // ---------------------------------------------------------------------------
  // Context tracking
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Topic lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Add a new topic. Status starts as "new".
   */
  addTopic(id: string, title: string): Topic {
    const topic: Topic = {
      id,
      title,
      status: "new",
      createdAt: new Date(),
    };
    this.topics.set(id, topic);

    logger.debug(
      { sessionId: this.sessionId, topicId: id, title },
      "Topic added"
    );

    return topic;
  }

  /**
   * Activate a topic, transitioning it from "new" to "active".
   */
  activateTopic(id: string): Topic {
    const topic = this.topics.get(id);
    if (!topic) {
      throw new Error(`Topic not found: ${id}`);
    }

    topic.status = "active";
    topic.activatedAt = new Date();

    logger.debug({ sessionId: this.sessionId, topicId: id }, "Topic activated");

    return topic;
  }

  /**
   * Resolve a topic, transitioning it from "active" to "resolved".
   */
  resolveTopic(id: string): Topic {
    const topic = this.topics.get(id);
    if (!topic) {
      throw new Error(`Topic not found: ${id}`);
    }

    topic.status = "resolved";
    topic.resolvedAt = new Date();

    logger.debug({ sessionId: this.sessionId, topicId: id }, "Topic resolved");

    return topic;
  }

  /**
   * Reopen a resolved topic, transitioning it back to "active".
   */
  reopenTopic(id: string): Topic {
    const topic = this.topics.get(id);
    if (!topic) {
      throw new Error(`Topic not found: ${id}`);
    }

    topic.status = "active";
    topic.activatedAt = new Date();
    topic.resolvedAt = undefined;

    logger.debug({ sessionId: this.sessionId, topicId: id }, "Topic reopened");

    return topic;
  }

  /**
   * Get a topic by ID.
   */
  getTopic(id: string): Topic | undefined {
    return this.topics.get(id);
  }

  /**
   * Get all topics filtered by status.
   */
  getTopicsByStatus(status: TopicStatus): Topic[] {
    return Array.from(this.topics.values()).filter((t) => t.status === status);
  }

  // ---------------------------------------------------------------------------
  // Open question tracking
  // ---------------------------------------------------------------------------

  /**
   * Add an open question.
   */
  addQuestion(id: string, question: string, topicId?: string): OpenQuestion {
    const q: OpenQuestion = {
      id,
      question,
      topicId,
      askedAt: new Date(),
    };
    this.questions.set(id, q);

    logger.debug(
      { sessionId: this.sessionId, questionId: id, topicId },
      "Question added"
    );

    return q;
  }

  /**
   * Resolve an open question with an answer.
   */
  resolveQuestion(id: string, answer: string): OpenQuestion {
    const q = this.questions.get(id);
    if (!q) {
      throw new Error(`Question not found: ${id}`);
    }

    q.resolvedAt = new Date();
    q.answer = answer;

    logger.debug(
      { sessionId: this.sessionId, questionId: id },
      "Question resolved"
    );

    return q;
  }

  /**
   * Get all open (unresolved) questions.
   */
  getOpenQuestions(): OpenQuestion[] {
    return Array.from(this.questions.values()).filter((q) => !q.resolvedAt);
  }

  // ---------------------------------------------------------------------------
  // Context summary
  // ---------------------------------------------------------------------------

  /**
   * Get a structured context summary with active topics, open questions,
   * and recently resolved topics.
   */
  getContextSummary(): ContextSummary {
    const activeTopics = this.getTopicsByStatus("active");
    const openQuestions = this.getOpenQuestions();
    const recentlyResolved = this.getTopicsByStatus("resolved");

    return {
      activeTopics,
      openQuestions,
      recentlyResolved,
    };
  }

  /**
   * Format the context summary as markdown for prompt injection.
   */
  formatContextForPrompt(): string {
    const summary = this.getContextSummary();
    const sections: string[] = [];

    if (summary.activeTopics.length > 0) {
      const topicLines = summary.activeTopics.map(
        (t) =>
          `- **${t.title}** (since ${t.activatedAt?.toISOString() ?? t.createdAt.toISOString()})`
      );
      sections.push(`## Active Topics\n${topicLines.join("\n")}`);
    }

    if (summary.openQuestions.length > 0) {
      const questionLines = summary.openQuestions.map(
        (q) => `- ${q.question}${q.topicId ? ` (topic: ${q.topicId})` : ""}`
      );
      sections.push(`## Open Questions\n${questionLines.join("\n")}`);
    }

    if (summary.recentlyResolved.length > 0) {
      const resolvedLines = summary.recentlyResolved.map(
        (t) =>
          `- ~~${t.title}~~ (resolved ${t.resolvedAt?.toISOString() ?? "unknown"})`
      );
      sections.push(`## Recently Resolved\n${resolvedLines.join("\n")}`);
    }

    if (sections.length === 0) {
      return "No active conversation context.";
    }

    return sections.join("\n\n");
  }

  // ---------------------------------------------------------------------------
  // Session management
  // ---------------------------------------------------------------------------

  /**
   * Clear all tracked context for the session.
   */
  reset(): void {
    this.knownContext.clear();
    this.topics.clear();
    this.questions.clear();
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
    topicCount: number;
    openQuestionCount: number;
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
      topicCount: this.topics.size,
      openQuestionCount: this.getOpenQuestions().length,
    };
  }
}
