/**
 * Smart Context Window Management — Intelligent context prioritization
 * and compression to maximize the value within token budget constraints.
 *
 * Tracks what the agent has seen, detects approaching limits, and
 * automatically summarizes old context to make room for new information.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:smart-context");

/* -------------------------------------------------------------------------- */
/*  Constants                                                                  */
/* -------------------------------------------------------------------------- */

/** Approximate characters per token for estimation. */
const CHARS_PER_TOKEN = 4;

/** Utilization threshold to trigger automatic summarization. */
const HIGH_UTILIZATION_THRESHOLD = 0.8;

/** Maximum summary length in characters. */
const MAX_SUMMARY_LENGTH = 500;

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

export type ContextPriority =
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "background";

const PRIORITY_WEIGHTS: Record<ContextPriority, number> = {
  critical: 100,
  high: 75,
  medium: 50,
  low: 25,
  background: 10,
};

export type ContextCategory =
  | "current_task"
  | "recent_changes"
  | "related_files"
  | "conversation"
  | "documentation"
  | "historical";

const CATEGORY_BASE_PRIORITY: Record<ContextCategory, ContextPriority> = {
  current_task: "critical",
  recent_changes: "high",
  related_files: "medium",
  conversation: "medium",
  documentation: "low",
  historical: "background",
};

export interface ContextItem {
  /** When this item was added. */
  addedAt: number;
  /** Category of this context. */
  category: ContextCategory;
  /** The actual content. */
  content: string;
  /** Unique identifier for this context item. */
  id: string;
  /** Whether this item has been summarized (compressed). */
  isSummarized: boolean;
  /** When the agent last referenced this item. */
  lastAccessedAt: number;
  /** Optional metadata. */
  metadata?: Record<string, unknown>;
  /** Original token count before summarization. */
  originalTokens?: number;
  /** Priority override (defaults to category-based priority). */
  priority: ContextPriority;
  /** Estimated token count. */
  tokenEstimate: number;
}

interface ContextWindow {
  items: ContextItem[];
  totalTokens: number;
  utilization: number;
  wasTruncated: boolean;
}

interface ContextStats {
  highUtilization: boolean;
  itemCount: number;
  summarizedCount: number;
  totalTokens: number;
  utilization: number;
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function summarizeText(text: string): string {
  // Extract key information: first sentence, function signatures, key terms
  const lines = text.split("\n").filter((l) => l.trim().length > 0);

  // Prioritize: headings, function signatures, type definitions, first lines
  const importantLines: string[] = [];
  let charCount = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    const isImportant =
      trimmed.startsWith("#") ||
      trimmed.startsWith("export") ||
      trimmed.startsWith("interface") ||
      trimmed.startsWith("type") ||
      trimmed.startsWith("class") ||
      trimmed.startsWith("function") ||
      trimmed.startsWith("const") ||
      trimmed.startsWith("/**");

    if (isImportant || importantLines.length < 3) {
      if (charCount + trimmed.length > MAX_SUMMARY_LENGTH) {
        break;
      }
      importantLines.push(trimmed);
      charCount += trimmed.length;
    }
  }

  if (importantLines.length === 0) {
    return text.slice(0, MAX_SUMMARY_LENGTH);
  }

  return `[Summary] ${importantLines.join(" | ")}`;
}

/* -------------------------------------------------------------------------- */
/*  Smart Context Manager                                                      */
/* -------------------------------------------------------------------------- */

export class SmartContextManager {
  private readonly items: Map<string, ContextItem> = new Map();
  private readonly maxTokenBudget: number;

  constructor(maxTokenBudget = 128_000) {
    this.maxTokenBudget = maxTokenBudget;
  }

  /**
   * Add a context item with priority weighting.
   * Automatically triggers summarization if utilization is high.
   */
  addContext(
    id: string,
    content: string,
    category: ContextCategory,
    priority?: ContextPriority,
    metadata?: Record<string, unknown>
  ): ContextItem {
    const effectivePriority = priority ?? CATEGORY_BASE_PRIORITY[category];
    const tokenEstimate = estimateTokens(content);
    const now = Date.now();

    const item: ContextItem = {
      id,
      content,
      category,
      priority: effectivePriority,
      addedAt: now,
      lastAccessedAt: now,
      tokenEstimate,
      isSummarized: false,
      metadata,
    };

    this.items.set(id, item);

    logger.debug(
      {
        id,
        category,
        priority: effectivePriority,
        tokens: tokenEstimate,
      },
      "Context item added"
    );

    // Check if we need to make room
    const currentTokens = this.getTotalTokens();
    if (currentTokens > this.maxTokenBudget * HIGH_UTILIZATION_THRESHOLD) {
      logger.info(
        {
          currentTokens,
          budget: this.maxTokenBudget,
          utilization: (currentTokens / this.maxTokenBudget) * 100,
        },
        "High utilization detected — triggering summarization"
      );
      this.summarizeOldContext();
    }

    return item;
  }

  /**
   * Mark a context item as recently accessed (boosts its retention priority).
   */
  touchContext(id: string): void {
    const item = this.items.get(id);
    if (item) {
      item.lastAccessedAt = Date.now();
    }
  }

  /**
   * Remove a specific context item.
   */
  removeContext(id: string): boolean {
    return this.items.delete(id);
  }

  /**
   * Get an optimized context window that fits within the token budget.
   * Items are sorted by effective priority (considering recency decay).
   */
  getContextWindow(maxTokens?: number): ContextWindow {
    const budget = maxTokens ?? this.maxTokenBudget;
    const now = Date.now();

    // Score each item: priority weight + recency bonus
    const scored = [...this.items.values()].map((item) => {
      const priorityScore = PRIORITY_WEIGHTS[item.priority];
      const ageMs = now - item.lastAccessedAt;
      const ageHours = ageMs / (1000 * 60 * 60);
      // Recency bonus: items accessed within last hour get a boost
      const recencyBonus = Math.max(0, 20 - ageHours * 2);
      const effectiveScore = priorityScore + recencyBonus;
      return { item, score: effectiveScore };
    });

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    // Fill the context window greedily
    const selectedItems: ContextItem[] = [];
    let totalTokens = 0;
    let wasTruncated = false;

    for (const { item } of scored) {
      if (totalTokens + item.tokenEstimate <= budget) {
        selectedItems.push(item);
        totalTokens += item.tokenEstimate;
      } else {
        wasTruncated = true;
      }
    }

    return {
      items: selectedItems,
      totalTokens,
      utilization: totalTokens / budget,
      wasTruncated,
    };
  }

  /**
   * Compress old, low-priority items into summaries to free up token budget.
   * Targets items that are: old, low-priority, not recently accessed.
   */
  summarizeOldContext(): number {
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;
    let tokensSaved = 0;

    // Find candidates for summarization: old + low priority + not already summarized
    const candidates = [...this.items.values()]
      .filter(
        (item) =>
          !item.isSummarized &&
          item.lastAccessedAt < oneHourAgo &&
          PRIORITY_WEIGHTS[item.priority] < PRIORITY_WEIGHTS.high
      )
      .sort(
        (a, b) =>
          PRIORITY_WEIGHTS[a.priority] - PRIORITY_WEIGHTS[b.priority] ||
          a.lastAccessedAt - b.lastAccessedAt
      );

    for (const item of candidates) {
      const originalTokens = item.tokenEstimate;
      const summary = summarizeText(item.content);
      const newTokens = estimateTokens(summary);

      if (newTokens < originalTokens * 0.5) {
        item.content = summary;
        item.tokenEstimate = newTokens;
        item.originalTokens = originalTokens;
        item.isSummarized = true;
        tokensSaved += originalTokens - newTokens;

        logger.debug(
          {
            id: item.id,
            savedTokens: originalTokens - newTokens,
            ratio: (newTokens / originalTokens).toFixed(2),
          },
          "Context item summarized"
        );
      }

      // Stop if we've freed enough space
      const currentTokens = this.getTotalTokens();
      if (currentTokens < this.maxTokenBudget * 0.6) {
        break;
      }
    }

    if (tokensSaved > 0) {
      logger.info(
        { tokensSaved, remainingTokens: this.getTotalTokens() },
        "Context summarization complete"
      );
    }

    return tokensSaved;
  }

  /**
   * Get statistics about the current context state.
   */
  getStats(): ContextStats {
    const totalTokens = this.getTotalTokens();
    return {
      itemCount: this.items.size,
      totalTokens,
      utilization: totalTokens / this.maxTokenBudget,
      highUtilization:
        totalTokens > this.maxTokenBudget * HIGH_UTILIZATION_THRESHOLD,
      summarizedCount: [...this.items.values()].filter((i) => i.isSummarized)
        .length,
    };
  }

  /**
   * Clear all context items.
   */
  clear(): void {
    this.items.clear();
  }

  /* ── Private helpers ──────────────────────────────────────────────── */

  private getTotalTokens(): number {
    let total = 0;
    for (const item of this.items.values()) {
      total += item.tokenEstimate;
    }
    return total;
  }
}
