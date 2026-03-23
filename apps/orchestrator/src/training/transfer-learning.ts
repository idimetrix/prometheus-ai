const WHITESPACE_RE = /\s+/;

/**
 * Cross-agent knowledge transfer system.
 *
 * Learns from one agent's experience and applies insights to others.
 * For example, when SecurityAuditor discovers a SQL injection pattern,
 * that insight is stored and later included in BackendCoder's prompt
 * context so it can proactively avoid raw SQL queries.
 */
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";

const logger = createLogger("orchestrator:transfer-learning");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InsightCategory =
  | "security_patterns"
  | "performance_antipatterns"
  | "test_failures"
  | "code_conventions";

export interface LearningInsight {
  /** Classification category */
  category: InsightCategory;
  /** Additional context (task description, file path, etc.) */
  context: Record<string, string>;
  /** ISO timestamp when the insight was recorded */
  createdAt: string;
  /** Agent that produced the insight */
  fromAgent: string;
  /** Unique insight identifier */
  id: string;
  /** Human-readable insight text */
  insight: string;
  /** How many times this insight has been retrieved */
  retrievalCount: number;
}

export interface TransferResult {
  /** Number of insights transferred */
  count: number;
  /** Source agent */
  fromAgent: string;
  /** Insight IDs that were transferred */
  insightIds: string[];
  /** Destination agent */
  toAgent: string;
}

// ---------------------------------------------------------------------------
// SharedLearningStore
// ---------------------------------------------------------------------------

export class SharedLearningStore {
  /** Insights keyed by ID for fast lookup */
  private readonly insights = new Map<string, LearningInsight>();

  /** Secondary index: agent -> set of insight IDs */
  private readonly byAgent = new Map<string, Set<string>>();

  /** Secondary index: category -> set of insight IDs */
  private readonly byCategory = new Map<InsightCategory, Set<string>>();

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Store a learning insight produced by an agent.
   */
  recordInsight(
    fromAgent: string,
    category: InsightCategory,
    insight: string,
    context: Record<string, string> = {}
  ): LearningInsight {
    const record: LearningInsight = {
      id: generateId("ins"),
      fromAgent,
      category,
      insight,
      context,
      createdAt: new Date().toISOString(),
      retrievalCount: 0,
    };

    this.insights.set(record.id, record);

    // Update agent index
    const agentSet = this.byAgent.get(fromAgent) ?? new Set();
    agentSet.add(record.id);
    this.byAgent.set(fromAgent, agentSet);

    // Update category index
    const catSet = this.byCategory.get(category) ?? new Set();
    catSet.add(record.id);
    this.byCategory.set(category, catSet);

    logger.info(
      { id: record.id, fromAgent, category },
      "Recorded learning insight"
    );

    return record;
  }

  /**
   * Retrieve insights relevant to a given agent and task context.
   *
   * Relevance is scored by:
   *   1. Category match with the agent's likely concerns
   *   2. Context keyword overlap with the task description
   *   3. Recency (newer insights rank higher)
   */
  getRelevantInsights(
    forAgent: string,
    taskContext: Record<string, string>,
    limit = 10
  ): LearningInsight[] {
    const allInsights = Array.from(this.insights.values());

    // Exclude insights the agent produced itself — we want cross-agent transfer
    const candidates = allInsights.filter((i) => i.fromAgent !== forAgent);

    if (candidates.length === 0) {
      return [];
    }

    // Build a set of keywords from the task context for matching
    const contextWords = new Set<string>();
    for (const value of Object.values(taskContext)) {
      for (const word of value.toLowerCase().split(WHITESPACE_RE)) {
        if (word.length > 3) {
          contextWords.add(word);
        }
      }
    }

    // Score each candidate
    const scored = candidates.map((candidate) => {
      let score = 0;

      // Keyword overlap between task context and insight context
      for (const value of Object.values(candidate.context)) {
        for (const word of value.toLowerCase().split(WHITESPACE_RE)) {
          if (contextWords.has(word)) {
            score += 2;
          }
        }
      }

      // Keyword overlap in the insight text itself
      for (const word of candidate.insight.toLowerCase().split(WHITESPACE_RE)) {
        if (contextWords.has(word)) {
          score += 1;
        }
      }

      // Recency bonus (insights from last hour get +3, last day +1)
      const ageMs = Date.now() - new Date(candidate.createdAt).getTime();
      if (ageMs < 3_600_000) {
        score += 3;
      } else if (ageMs < 86_400_000) {
        score += 1;
      }

      return { insight: candidate, score };
    });

    // Sort by score descending, then by date descending
    scored.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return b.insight.createdAt.localeCompare(a.insight.createdAt);
    });

    const results = scored.slice(0, limit).map((s) => s.insight);

    // Increment retrieval counts
    for (const r of results) {
      r.retrievalCount += 1;
    }

    logger.debug(
      { forAgent, resultCount: results.length, limit },
      "Retrieved relevant insights"
    );

    return results;
  }

  /**
   * Explicitly transfer all insights of a given category from one agent
   * to another. Returns a summary of what was transferred.
   */
  transferKnowledge(
    fromAgent: string,
    toAgent: string,
    category: InsightCategory
  ): TransferResult {
    const agentInsightIds = this.byAgent.get(fromAgent);
    const categoryInsightIds = this.byCategory.get(category);

    if (!(agentInsightIds && categoryInsightIds)) {
      return { count: 0, fromAgent, toAgent, insightIds: [] };
    }

    // Intersection: insights from the source agent in the given category
    const matchingIds: string[] = [];
    for (const id of agentInsightIds) {
      if (categoryInsightIds.has(id)) {
        matchingIds.push(id);
      }
    }

    // Increment retrieval counts on transferred insights
    for (const id of matchingIds) {
      const insight = this.insights.get(id);
      if (insight) {
        insight.retrievalCount += 1;
      }
    }

    logger.info(
      { fromAgent, toAgent, category, count: matchingIds.length },
      "Transferred knowledge between agents"
    );

    return {
      count: matchingIds.length,
      fromAgent,
      toAgent,
      insightIds: matchingIds,
    };
  }

  /**
   * Get all insights for a given agent.
   */
  getInsightsByAgent(agent: string): LearningInsight[] {
    const ids = this.byAgent.get(agent);
    if (!ids) {
      return [];
    }
    const results: LearningInsight[] = [];
    for (const id of ids) {
      const insight = this.insights.get(id);
      if (insight) {
        results.push(insight);
      }
    }
    return results;
  }

  /**
   * Get all insights in a given category.
   */
  getInsightsByCategory(category: InsightCategory): LearningInsight[] {
    const ids = this.byCategory.get(category);
    if (!ids) {
      return [];
    }
    const results: LearningInsight[] = [];
    for (const id of ids) {
      const insight = this.insights.get(id);
      if (insight) {
        results.push(insight);
      }
    }
    return results;
  }

  /**
   * Serialize the store to a plain object for persistence.
   */
  serialize(): LearningInsight[] {
    return Array.from(this.insights.values());
  }

  /**
   * Restore the store from a previously serialized array.
   */
  deserialize(data: LearningInsight[]): void {
    this.insights.clear();
    this.byAgent.clear();
    this.byCategory.clear();

    for (const record of data) {
      this.insights.set(record.id, record);

      const agentSet = this.byAgent.get(record.fromAgent) ?? new Set();
      agentSet.add(record.id);
      this.byAgent.set(record.fromAgent, agentSet);

      const catSet = this.byCategory.get(record.category) ?? new Set();
      catSet.add(record.id);
      this.byCategory.set(record.category, catSet);
    }

    logger.info({ insightCount: data.length }, "Deserialized learning store");
  }

  /**
   * Return the total number of stored insights.
   */
  get size(): number {
    return this.insights.size;
  }
}
